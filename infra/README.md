# ApexMaths Infrastructure (AWS CDK)

Provisions the AWS resources ApexMaths needs, in **eu-west-2 (London)**:

- **Amazon Cognito** User Pool + app client (no client secret) — identity.
- **Amazon Aurora PostgreSQL** (Serverless v2) with the **RDS Data API** enabled,
  plus an auto-generated credentials secret in **Secrets Manager**.
- A least-privilege **IAM role** for Vercel, assumed via **OIDC federation**
  (Data API + Secrets read + Bedrock Claude Sonnet 4.6 invoke + Cognito AdminDeleteUser).
- A **Vercel OIDC identity provider** so deployments can assume that role with
  short-lived credentials instead of long-lived access keys.

Compute runs on **Vercel**, not AWS — so there are no Lambdas here, just the
backing infrastructure the Next.js app talks to.

## Secret-handling policy

This stack is designed so **no secret value is ever leaked**:

- The **database password** is generated inside Secrets Manager (not in code or
  the template). Only its **ARN** is output.
- The **Cognito app client has no secret** (removes that vector entirely).
- **No IAM access keys exist at all** — Vercel assumes an IAM role through OIDC
  federation and receives short-lived, auto-expiring credentials. There is no
  long-lived AWS secret to store, rotate, or leak.

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
  `AuroraClusterArn`, `AuroraSecretArn`, `AuroraDatabaseName`, `VercelRoleArn`.

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
| `AURORA_SECRET_ARN`     | `AuroraSecretArn` output                |
| `AURORA_DATABASE`       | `AuroraDatabaseName` output (`apex`)    |

Stripe vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) come from Stripe, not this stack.

## Apply the database schema + seed

From the repo root, with the same AWS credentials and the Aurora env vars
exported (the migration runner uses the Data API):

```bash
export AURORA_CLUSTER_ARN=<AuroraClusterArn>
export AURORA_SECRET_ARN=<AuroraSecretArn>
export AURORA_DATABASE=apex
export AWS_REGION=eu-west-2
node scripts/migrate.mjs
```

This applies `scripts/sql/001_schema.sql`, then seeds the question bank from
`data/questions.json` (both handled by `scripts/migrate.mjs`).

## Tear down

```bash
cd infra
npx cdk destroy
```

(The DB and user pool use `RemovalPolicy.DESTROY` for easy hackathon cleanup —
review before any production use.)
