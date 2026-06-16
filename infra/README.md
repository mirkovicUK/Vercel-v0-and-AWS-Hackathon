# ApexMaths Infrastructure (AWS CDK)

Provisions the AWS resources ApexMaths needs, in **eu-west-2 (London)**:

- **Amazon Cognito** User Pool + app client (no client secret) — identity.
- **Amazon Aurora PostgreSQL** (Serverless v2) with the **RDS Data API** enabled,
  plus an auto-generated **master** credentials secret in **Secrets Manager**.
- A second, **least-privilege `app_user` DB secret** — the role the running app
  authenticates as (DML only; no DDL/ownership). The master secret is used only
  for migrations.
- A least-privilege **IAM role** for Vercel, assumed via **OIDC federation**
  (Data API + read of the `app_user` secret only + Bedrock Claude Sonnet 4.6
  invoke + Cognito AdminDeleteUser).
- A **Vercel OIDC identity provider** so deployments can assume that role with
  short-lived credentials instead of long-lived access keys.

Compute runs on **Vercel**, not AWS — so there are no Lambdas here, just the
backing infrastructure the Next.js app talks to.

## Secret-handling policy

This stack is designed so **no secret value is ever leaked**:

- The **database password** is generated inside Secrets Manager (not in code or
  the template). Only its **ARN** is output.
- **Two DB roles, least privilege.** The master role (`apexadmin`) owns the
  schema and runs DDL — used only by migrations. The app authenticates as a
  separate `app_user` role with DML-only grants, so a runtime compromise cannot
  drop tables or alter the schema. The `app_user` password is generated in
  Secrets Manager and set on the role by `scripts/create-app-user.mjs` — it never
  appears in code or the template.
- The **Cognito app client has no secret** (removes that vector entirely).
- **No IAM access keys exist at all** — Vercel assumes an IAM role through OIDC
  federation and receives short-lived, auto-expiring credentials. There is no
  long-lived AWS secret to store, rotate, or leak. That role can read **only** the
  `app_user` secret, not the master — so the app cannot even fetch owner creds.

All `CfnOutput`s are non-sensitive (ids and ARNs only). An ARN is an address, not
a credential.

## Prerequisites

- AWS CLI configured with admin-ish credentials for the target account
  (`aws configure` / SSO). These stay in `~/.aws`, never in this repo.
- Node 22+, and Docker not required.
- One-time per account/region: `npx cdk bootstrap aws://<ACCOUNT_ID>/eu-west-2`
- In the Bedrock console (eu-west-2), request **model access to Anthropic Claude Sonnet 4.6**.

## Deploy

```bash
cd infra
npm install
export CDK_DEFAULT_REGION=eu-west-2
npx cdk deploy
```

The stack prints these outputs (all safe to read):

- `AWSRegion`, `CognitoUserPoolId`, `CognitoClientId`,
  `AuroraClusterArn`, `AuroraSecretArn` (master — migrations only),
  `AppUserSecretArn` (least-privilege runtime secret), `AuroraDatabaseName`,
  `VercelRoleArn`.

> Aurora can take ~10–15 minutes to come up on first deploy. Don't leave this to
> the last hour before a deadline.

## Connect Vercel via OIDC (no access keys)

The CDK stack already created the Vercel OIDC identity provider and the role —
there is **nothing to do in the AWS console**. You only:

1. **Enable OIDC for the Vercel project**: Vercel dashboard → Project → Settings →
   **Secure Backend Access (OIDC)** → ensure it's enabled with the **Team** issuer
   mode (issuer `https://oidc.vercel.com/aurora75-s-projects`).
2. Set `AWS_ROLE_ARN` in the project's env vars to the `VercelRoleArn` output.
3. Set `AWS_REGION` to `eu-west-2` explicitly (Vercel's runtime sets `AWS_REGION`
   to its own execution region, which can drift; pinning it keeps calls in-region).

The trust policy allows any project in the `aurora75-s-projects` team on the
`production` and `preview` environments. To restrict to a single project, tighten
the `:sub` condition in `lib/apexmaths-stack.ts` to that project name.

## Vercel environment variables

From the stack outputs and the key above:

| Vercel env var          | Source                                  |
|-------------------------|-----------------------------------------|
| `AWS_REGION`            | `AWSRegion` output (`eu-west-2`)        |
| `AWS_ROLE_ARN`          | `VercelRoleArn` output (assumed via OIDC) |
| `COGNITO_USER_POOL_ID`  | `CognitoUserPoolId` output              |
| `COGNITO_CLIENT_ID`     | `CognitoClientId` output                |
| `AURORA_CLUSTER_ARN`    | `AuroraClusterArn` output               |
| `AURORA_SECRET_ARN`     | **`AppUserSecretArn`** output (least-privilege runtime role — NOT the master) |
| `AURORA_DATABASE`       | `AuroraDatabaseName` output (`apex`)    |

Stripe vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) come from Stripe, not this stack.

## Apply the database schema + seed

From the repo root, with admin AWS creds and the Aurora env vars exported. Note
this uses the **master** secret (`AuroraSecretArn`) — migrations run DDL, which
only the schema owner may do:

```bash
export AURORA_CLUSTER_ARN=<AuroraClusterArn>
export AURORA_SECRET_ARN=<AuroraSecretArn>   # MASTER secret (apexadmin)
export AURORA_DATABASE=apex
export AWS_REGION=eu-west-2
node scripts/migrate.mjs
```

This applies `scripts/sql/001_schema.sql`, then seeds the question bank from
`data/questions.json` (both handled by `scripts/migrate.mjs`).

## Provision the least-privilege `app_user` role

Run ONCE after the schema exists (and re-run any time you add tables or want to
rotate the password — it's idempotent). It runs as the master, reads the
generated `app_user` password from Secrets Manager, and creates the role with
DML-only grants plus default privileges for future tables:

```bash
export AURORA_CLUSTER_ARN=<AuroraClusterArn>
export AURORA_SECRET_ARN=<AuroraSecretArn>        # MASTER secret (to run CREATE ROLE/GRANT)
export APP_USER_SECRET_ARN=<AppUserSecretArn>     # app_user secret (password source)
export AURORA_DATABASE=apex
export AWS_REGION=eu-west-2
node scripts/create-app-user.mjs        # or: pnpm db:create-app-user
```

Then point Vercel's `AURORA_SECRET_ARN` at **`AppUserSecretArn`** and redeploy.
Roll out to the **Preview** environment first, verify, then Production. To roll
back, set `AURORA_SECRET_ARN` back to the master ARN and redeploy.

## Tear down

```bash
cd infra
npx cdk destroy
```

(The DB and user pool use `RemovalPolicy.DESTROY` for easy hackathon cleanup —
review before any production use.)
