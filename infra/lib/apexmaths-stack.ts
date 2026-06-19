import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as rds from "aws-cdk-lib/aws-rds"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as iam from "aws-cdk-lib/aws-iam"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"

/**
 * ApexMaths infrastructure.
 *
 * SECRET-HANDLING POLICY (this stack never leaks secrets):
 *  - The database password is generated *inside* AWS Secrets Manager, not in
 *    CDK/CloudFormation. It never appears in the synthesized template, in
 *    cdk.out, in stack outputs, or in deploy logs.
 *  - We output the Secrets Manager *ARN* (an address), never the secret value.
 *  - The Cognito app client is created WITHOUT a client secret, removing that
 *    leak vector entirely (the app supports the no-secret USER_PASSWORD_AUTH flow).
 *  - There are NO long-lived AWS access keys anywhere. Vercel reaches AWS via
 *    **OIDC federation**: each deployment presents a short-lived OIDC token that
 *    is exchanged (sts:AssumeRoleWithWebIdentity) for temporary credentials on
 *    the least-privilege role below. Nothing secret is stored in Vercel, the
 *    template, logs, or this repo — only the (non-secret) role ARN is shared.
 *
 * Every CfnOutput below is a non-sensitive identifier or ARN.
 */

// Vercel team namespace (from https://vercel.com/aurora75-s-projects). Used to
// build the OIDC issuer URL and the trust-policy claim conditions.
const VERCEL_TEAM_SLUG = "aurora75-s-projects"
const VERCEL_OIDC_ISSUER = `oidc.vercel.com/${VERCEL_TEAM_SLUG}`
const VERCEL_OIDC_AUDIENCE = `https://vercel.com/${VERCEL_TEAM_SLUG}`

export class ApexMathsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ---------------------------------------------------------------------
    // Networking — minimal, NAT-free VPC. Aurora lives in isolated subnets;
    // the RDS Data API is reached over AWS's service endpoint, so Vercel does
    // not need to be inside the VPC and we incur no NAT Gateway cost.
    // ---------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })

    // ---------------------------------------------------------------------
    // Aurora PostgreSQL (Serverless v2) with the Data API enabled.
    // Credentials.fromGeneratedSecret => Secrets Manager generates the password
    // server-side. The plaintext password is never in this code or the template.
    // ---------------------------------------------------------------------
    const dbCredentials = rds.Credentials.fromGeneratedSecret("apexadmin", {
      secretName: "apexmaths/db-credentials",
    })

    const cluster = new rds.DatabaseCluster(this, "Database", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_6,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      writer: rds.ClusterInstance.serverlessV2("writer"),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      enableDataApi: true, // REQUIRED — lib/aws/rds-data.ts uses the Data API.
      credentials: dbCredentials,
      defaultDatabaseName: "apex", // matches AURORA_DATABASE default in the app.
      storageEncrypted: true,
      // Hackathon-friendly teardown. Review before using in production.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    })

    // ---------------------------------------------------------------------
    // Least-privilege application DB credential.
    //
    // The cluster master secret (apexadmin) owns the schema and can run DDL; it
    // is used ONLY for migrations (run locally via scripts/migrate.mjs). The
    // running app must NOT connect as the owner. We therefore mint a SECOND
    // Secrets Manager secret for a dedicated `app_user` Postgres role that holds
    // only DML privileges (SELECT/INSERT/UPDATE/DELETE). The Postgres role and
    // its grants are created by scripts/create-app-user.mjs, which reads this
    // secret's generated password (so the password lives only in Secrets Manager
    // and the DB — never in code or the template).
    //
    // The Data API requires the secret JSON to contain `username` + `password`.
    // ---------------------------------------------------------------------
    const appUserSecret = new secretsmanager.Secret(this, "AppUserSecret", {
      secretName: "apexmaths/app-user-credentials",
      description: "Least-privilege application DB role (DML only) used by Vercel at runtime.",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "app_user" }),
        generateStringKey: "password",
        // Exclude chars that complicate SQL string literals / URLs / shells.
        excludeCharacters: "\"'`\\/@ {}[]:;",
        passwordLength: 32,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // hackathon-friendly teardown
    })

    // ---------------------------------------------------------------------
    // Cognito User Pool + app client (no client secret).
    // Password policy mirrors the app's Zod rules (min 8, upper/lower/number).
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "apexmaths-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: "apexmaths-web",
      authFlows: { userPassword: true }, // enables USER_PASSWORD_AUTH (used by the app)
      generateSecret: false, // no client secret => nothing sensitive to surface
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    // ---------------------------------------------------------------------
    // Vercel OIDC federation — identity provider + assumable role.
    // The provider trusts tokens issued by Vercel for this team. The role can
    // only be assumed by deployments of this team targeting the `production` or
    // `preview` environments (the `sub` condition); `development` (local) is
    // excluded, so local dev uses its own AWS profile instead.
    // ---------------------------------------------------------------------
    const vercelOidcProvider = new iam.OpenIdConnectProvider(this, "VercelOidcProvider", {
      url: `https://${VERCEL_OIDC_ISSUER}`,
      clientIds: [VERCEL_OIDC_AUDIENCE],
    })

    const vercelRole = new iam.Role(this, "VercelRole", {
      roleName: "apexmaths-vercel",
      description: "Assumed by Vercel deployments via OIDC federation (no static keys).",
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(vercelOidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          [`${VERCEL_OIDC_ISSUER}:aud`]: VERCEL_OIDC_AUDIENCE,
        },
        StringLike: {
          // Any project in this team, production or preview only.
          [`${VERCEL_OIDC_ISSUER}:sub`]: [
            `owner:${VERCEL_TEAM_SLUG}:project:*:environment:production`,
            `owner:${VERCEL_TEAM_SLUG}:project:*:environment:preview`,
          ],
        },
      }),
    })

    // Aurora Data API — least privilege on two axes:
    //  (1) DB layer: the app connects as `app_user` (DML only), never the owner.
    //  (2) AWS layer: the role may read ONLY the app_user secret, NOT the master
    //      secret. With the Data API the CALLER must hold GetSecretValue on the
    //      secret ARN it passes, so withholding the master secret means the app
    //      physically cannot authenticate as the schema owner — defense in depth.
    // (We deliberately do NOT use cluster.grantDataApiAccess(), which would also
    //  grant read of the master secret.)
    vercelRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AuroraDataApi",
        actions: [
          "rds-data:BatchExecuteStatement",
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:ExecuteStatement",
          "rds-data:RollbackTransaction",
        ],
        resources: [cluster.clusterArn],
      }),
    )
    // GetSecretValue (and DescribeSecret) on the app_user secret ONLY.
    appUserSecret.grantRead(vercelRole)

    // Cognito admin: delete a user on GDPR account erasure so the email is freed
    // for re-registration (AdminDeleteUser). This is the ONLY Cognito admin API
    // the app uses — normal auth (SignUp/InitiateAuth/etc.) is client-credential
    // based and needs no IAM. Scoped to this single user pool.
    vercelRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CognitoAdminDeleteUser",
        actions: ["cognito-idp:AdminDeleteUser"],
        resources: [userPool.userPoolArn],
      }),
    )

    // Bedrock: invoke Anthropic Claude Sonnet 4.6 (and stream) — the single model
    // powering the AI tutor, per-session review, and the parent progress report.
    // It is invoked via the EU regional cross-Region inference profile
    // (`eu.anthropic.claude-sonnet-4-6`), which routes to the underlying foundation
    // model within EU Regions — so we grant the EU inference-profile ARN plus the
    // foundation-model ARNs (region wildcard covers the EU Regions it routes to).
    vercelRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeClaudeModels",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          // Foundation model in any commercial Region the profile routes to.
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6`,
          // EU regional cross-Region inference profile (what the app calls).
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/eu.anthropic.claude-sonnet-4-6`,
        ],
      }),
    )

    // NOTE on Cognito permissions: the app's auth flows (SignUp, ConfirmSignUp,
    // InitiateAuth USER_PASSWORD_AUTH, ForgotPassword, GlobalSignOut, etc.) are
    // unauthenticated Cognito APIs invoked with the app client id — they do NOT
    // use IAM/SigV4. The Vercel IAM user therefore needs no cognito-idp
    // permissions, which keeps this policy minimal.

    // ---------------------------------------------------------------------
    // Outputs — ALL non-sensitive (identifiers + ARNs only). No secret values.
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "AWSRegion", {
      value: this.region,
      description: "Set as AWS_REGION in Vercel.",
    })
    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId,
      description: "Set as COGNITO_USER_POOL_ID in Vercel.",
    })
    new cdk.CfnOutput(this, "CognitoClientId", {
      value: userPoolClient.userPoolClientId,
      description: "Set as COGNITO_CLIENT_ID in Vercel. (No client secret is used.)",
    })
    new cdk.CfnOutput(this, "AuroraClusterArn", {
      value: cluster.clusterArn,
      description: "Set as AURORA_CLUSTER_ARN in Vercel.",
    })
    new cdk.CfnOutput(this, "AuroraSecretArn", {
      // ARN only — this is the address of the secret, NOT the secret value.
      value: cluster.secret?.secretArn ?? "ERROR_NO_SECRET",
      description:
        "MASTER (apexadmin) secret ARN. Use ONLY for migrations locally (AURORA_SECRET_ARN when running scripts/migrate.mjs). Do NOT put this in Vercel.",
    })
    new cdk.CfnOutput(this, "AppUserSecretArn", {
      // ARN only — the address of the least-privilege app_user secret.
      value: appUserSecret.secretArn,
      description:
        "Least-privilege app_user secret ARN. Set as AURORA_SECRET_ARN in Vercel (runtime). Provision the role first with scripts/create-app-user.mjs.",
    })
    new cdk.CfnOutput(this, "AuroraDatabaseName", {
      value: "apex",
      description: "Set as AURORA_DATABASE in Vercel.",
    })
    new cdk.CfnOutput(this, "VercelRoleArn", {
      value: vercelRole.roleArn,
      description:
        "Set as AWS_ROLE_ARN in Vercel. Vercel assumes this role via OIDC; no access keys needed.",
    })
  }
}
