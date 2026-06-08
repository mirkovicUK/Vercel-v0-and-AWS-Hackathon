import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as rds from "aws-cdk-lib/aws-rds"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as iam from "aws-cdk-lib/aws-iam"

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
 *  - We do NOT create IAM access keys in CloudFormation. Generating them here
 *    would place the secret access key in CloudFormation outputs/state in
 *    plaintext. Instead we create only the IAM user + least-privilege policy;
 *    the key is minted once via the AWS CLI after deploy (see README) and pasted
 *    straight into Vercel — so it never touches the template, logs, or this repo.
 *
 * Every CfnOutput below is a non-sensitive identifier or ARN.
 */
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
    // IAM user for Vercel — least privilege. NO access keys created here
    // (see secret-handling policy above; keys are minted via CLI post-deploy).
    // ---------------------------------------------------------------------
    const vercelUser = new iam.User(this, "VercelUser", {
      userName: "apexmaths-vercel",
    })

    // Data API access + read of the DB credentials secret (scoped to this cluster).
    cluster.grantDataApiAccess(vercelUser)

    // Cognito admin: delete a user on GDPR account erasure so the email is freed
    // for re-registration (AdminDeleteUser). This is the ONLY Cognito admin API
    // the app uses — normal auth (SignUp/InitiateAuth/etc.) is client-credential
    // based and needs no IAM. Scoped to this single user pool.
    vercelUser.addToPolicy(
      new iam.PolicyStatement({
        sid: "CognitoAdminDeleteUser",
        actions: ["cognito-idp:AdminDeleteUser"],
        resources: [userPool.userPoolArn],
      }),
    )

    // Bedrock: invoke Amazon Nova 2 Lite (and stream) for the AI tutor/report.
    // Nova 2 is invoked via inference profiles (global./us. prefixes), which in
    // turn invoke the underlying foundation model — so we grant both the
    // inference-profile ARNs and the foundation-model ARNs they fan out to.
    vercelUser.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeNova2Lite",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          // Foundation model (this region + the regions an inference profile routes to).
          `arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0`,
          // Inference profiles for Nova 2 Lite (global + cross-region), in this account.
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/global.amazon.nova-2-lite-v1:0`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*.amazon.nova-2-lite-v1:0`,
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
      description: "Set as AURORA_SECRET_ARN in Vercel. (ARN only; retrieve the value via the AWS CLI when running migrations.)",
    })
    new cdk.CfnOutput(this, "AuroraDatabaseName", {
      value: "apex",
      description: "Set as AURORA_DATABASE in Vercel.",
    })
    new cdk.CfnOutput(this, "VercelIamUserName", {
      value: vercelUser.userName,
      description: "Mint an access key for this user with: aws iam create-access-key --user-name <name>. Paste the key into Vercel; never commit it.",
    })
  }
}
