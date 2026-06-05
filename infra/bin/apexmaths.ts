#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { ApexMathsStack } from "../lib/apexmaths-stack"

const app = new cdk.App()

// Region is fixed to eu-west-2 (London). Account is taken from the deploying
// environment (CDK_DEFAULT_ACCOUNT) so no account id is hard-coded in the repo.
new ApexMathsStack(app, "ApexMathsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-west-2",
  },
  description: "ApexMaths infrastructure: Cognito, Aurora PostgreSQL (Data API), and a least-privilege IAM user for Vercel.",
})

app.synth()
