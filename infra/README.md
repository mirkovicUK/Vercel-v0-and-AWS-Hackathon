# ApexMaths Infrastructure (AWS CDK)

Provisions the AWS resources ApexMaths needs, in **eu-west-2 (London)**:

- **Amazon Cognito** User Pool + app client (no client secret) — identity.
- **Amazon Aurora PostgreSQL** (Serverless v2) with the **RDS Data API** enabled,
  plus an auto-generated credentials secret in **Secrets Manager**.
- A least-privilege **IAM user** for Vercel (Data API + Secrets read + Bedrock
  Nova 2 Lite invoke).

Compute runs on **Vercel**, not AWS — so there are no Lambdas here, just the
backing infrastructure the Next.js app talks to.

## Secret-handling policy

This stack is designed so **no secret value is ever leaked**:

- The **database password** is generated inside Secrets Manager (not in code or
  the template). Only its **ARN** is output.
- The **Cognito app client has no secret** (removes that vector entirely).
- **No IAM access keys are created by CloudFormation** — doing so would write the
  secret access key into stack outputs/state in plaintext. You mint the key once
  via the CLI (below); it shows only in your terminal and goes straight to Vercel.

All `CfnOutput`s are non-sensitive (ids and ARNs only). An ARN is an address, not
a credential.

## Prerequisites

- AWS CLI configured with admin-ish credentials for the target account
  (`aws configure` / SSO). These stay in `~/.aws`, never in this repo.
- Node 22+, and Docker not required.
- One-time per account/region: `npx cdk bootstrap aws://<ACCOUNT_ID>/eu-west-2`
- In the Bedrock console (eu-west-2), request **model access to Amazon Nova 2 Lite**.

## Deploy

```bash
cd infra
npm install
export CDK_DEFAULT_REGION=eu-west-2
npx cdk deploy
```

The stack prints these outputs (all safe to read):

- `AWSRegion`, `CognitoUserPoolId`, `CognitoClientId`,
  `AuroraClusterArn`, `AuroraSecretArn`, `AuroraDatabaseName`, `VercelIamUserName`.

> Aurora can take ~10–15 minutes to come up on first deploy. Don't leave this to
> the last hour before a deadline.

## Mint the Vercel access key (one-off, secret-safe)

CloudFormation does not create the key. Create it via CLI — the secret is shown
**once**, in your terminal only:

```bash
aws iam create-access-key --user-name apexmaths-vercel
```

Copy `AccessKeyId` and `SecretAccessKey` directly into Vercel env vars
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Do not paste them into any file in
this repo. If you ever lose the secret, delete the key and create a new one.

## Vercel environment variables

From the stack outputs and the key above:

| Vercel env var          | Source                                  |
|-------------------------|-----------------------------------------|
| `AWS_REGION`            | `AWSRegion` output (`eu-west-2`)        |
| `AWS_ACCESS_KEY_ID`     | from `create-access-key`                |
| `AWS_SECRET_ACCESS_KEY` | from `create-access-key`                |
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

This applies `scripts/sql/001_schema.sql` and `002_seed_questions.sql`.

## Tear down

```bash
cd infra
npx cdk destroy
```

(The DB and user pool use `RemovalPolicy.DESTROY` for easy hackathon cleanup —
review before any production use.)
