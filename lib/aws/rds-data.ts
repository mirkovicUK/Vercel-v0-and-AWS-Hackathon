import "server-only"
import {
  RDSDataClient,
  ExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  RollbackTransactionCommand,
  type SqlParameter,
  type Field,
  type ColumnMetadata,
} from "@aws-sdk/client-rds-data"

/**
 * Thin, typed wrapper around the Aurora PostgreSQL Data API.
 *
 * We deliberately use the Data API (HTTPS) rather than a direct Postgres
 * connection so that Vercel's serverless functions can reach Aurora without a
 * VPC / NAT Gateway, without exposing the database publicly, and without
 * connection-pool exhaustion. Auth is IAM (the function's credentials) plus a
 * Secrets Manager secret that holds the DB password — the raw password never
 * touches this codebase or the environment.
 */

export interface RdsConfig {
  resourceArn: string
  secretArn: string
  database: string
  region: string
}

let cachedClient: RDSDataClient | null = null

function getConfig(): RdsConfig {
  const resourceArn = process.env.AURORA_CLUSTER_ARN
  const secretArn = process.env.AURORA_SECRET_ARN
  const database = process.env.AURORA_DATABASE ?? "apex"
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-west-2"

  if (!resourceArn || !secretArn) {
    throw new Error(
      "Aurora is not configured. Set AURORA_CLUSTER_ARN, AURORA_SECRET_ARN, AURORA_DATABASE and AWS credentials.",
    )
  }
  return { resourceArn, secretArn, database, region }
}

export function isAuroraConfigured(): boolean {
  return Boolean(process.env.AURORA_CLUSTER_ARN && process.env.AURORA_SECRET_ARN)
}

function getClient(region: string): RDSDataClient {
  if (cachedClient) return cachedClient
  cachedClient = new RDSDataClient({
    region,
    // Credentials are picked up from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
    // (the least-privilege IAM user) via the default provider chain.
  })
  return cachedClient
}

// ---- Parameter binding ----

export type ParamValue = string | number | boolean | null | Date | string[] | Record<string, unknown>

function toField(value: ParamValue): { field: Field; cast?: string } {
  if (value === null || value === undefined) return { field: { isNull: true } }
  if (typeof value === "boolean") return { field: { booleanValue: value } }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { field: { longValue: value } } : { field: { doubleValue: value } }
  }
  if (value instanceof Date) {
    // Aurora expects 'YYYY-MM-DD HH:MM:SS.FFF' for timestamp casts, paired with
    // the RDS Data API TIMESTAMP typeHint so it is not bound as plain text.
    return { field: { stringValue: value.toISOString().replace("T", " ").replace("Z", "") }, cast: "timestamptz" }
  }
  if (Array.isArray(value) || typeof value === "object") {
    return { field: { stringValue: JSON.stringify(value) }, cast: "jsonb" }
  }
  return { field: { stringValue: String(value) } }
}

function buildParameters(params: Record<string, ParamValue>): SqlParameter[] {
  return Object.entries(params).map(([name, raw]) => {
    const { field, cast } = toField(raw)
    const p: SqlParameter = { name, value: field }
    // Map our internal cast hints to RDS Data API typeHints so the server binds
    // the value as the right Postgres type instead of plain text.
    if (cast === "jsonb") p.typeHint = "JSON"
    else if (cast === "timestamptz") p.typeHint = "TIMESTAMP"
    return p
  })
}

// ---- Result mapping ----

function fieldToValue(field: Field): unknown {
  if (field.isNull) return null
  if (field.stringValue !== undefined) return field.stringValue
  if (field.booleanValue !== undefined) return field.booleanValue
  if (field.longValue !== undefined) return field.longValue
  if (field.doubleValue !== undefined) return field.doubleValue
  if (field.blobValue !== undefined) return field.blobValue
  if (field.arrayValue !== undefined) return field.arrayValue
  return null
}

function coerceByType(value: unknown, col: ColumnMetadata): unknown {
  if (value === null) return null
  const typeName = (col.typeName ?? "").toLowerCase()
  if (typeName === "jsonb" || typeName === "json") {
    try {
      return typeof value === "string" ? JSON.parse(value) : value
    } catch {
      return value
    }
  }
  if (typeName === "numeric" || typeName === "decimal") {
    return typeof value === "string" ? Number.parseFloat(value) : value
  }
  if (typeName === "bool" || typeName === "boolean") return Boolean(value)
  return value
}

function mapRecords<T>(
  records: Field[][] | undefined,
  columns: ColumnMetadata[] | undefined,
): T[] {
  if (!records || !columns) return []
  return records.map((row) => {
    const obj: Record<string, unknown> = {}
    row.forEach((field, i) => {
      const col = columns[i]
      const key = col?.label ?? col?.name ?? `col${i}`
      obj[key] = coerceByType(fieldToValue(field), col)
    })
    return obj as T
  })
}

// ---- Public query API ----

export interface QueryOptions {
  transactionId?: string
}

/** Execute a parameterised SQL statement and return mapped rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, ParamValue> = {},
  opts: QueryOptions = {},
): Promise<T[]> {
  const config = getConfig()
  const client = getClient(config.region)
  const res = await client.send(
    new ExecuteStatementCommand({
      resourceArn: config.resourceArn,
      secretArn: config.secretArn,
      database: config.database,
      sql,
      parameters: buildParameters(params),
      includeResultMetadata: true,
      transactionId: opts.transactionId,
    }),
  )
  return mapRecords<T>(res.records as Field[][] | undefined, res.columnMetadata)
}

/** Execute and return the first row, or null. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, ParamValue> = {},
  opts: QueryOptions = {},
): Promise<T | null> {
  const rows = await query<T>(sql, params, opts)
  return rows[0] ?? null
}

/** Run a set of statements inside a single transaction. */
export async function withTransaction<T>(
  fn: (tx: { query: typeof query; transactionId: string }) => Promise<T>,
): Promise<T> {
  const config = getConfig()
  const client = getClient(config.region)
  const begin = await client.send(
    new BeginTransactionCommand({
      resourceArn: config.resourceArn,
      secretArn: config.secretArn,
      database: config.database,
    }),
  )
  const transactionId = begin.transactionId!
  try {
    const scopedQuery = (<R = Record<string, unknown>>(
      sql: string,
      params: Record<string, ParamValue> = {},
    ) => query<R>(sql, params, { transactionId })) as typeof query
    const result = await fn({ query: scopedQuery, transactionId })
    await client.send(
      new CommitTransactionCommand({
        resourceArn: config.resourceArn,
        secretArn: config.secretArn,
        transactionId,
      }),
    )
    return result
  } catch (err) {
    await client
      .send(
        new RollbackTransactionCommand({
          resourceArn: config.resourceArn,
          secretArn: config.secretArn,
          transactionId,
        }),
      )
      .catch(() => undefined)
    throw err
  }
}
