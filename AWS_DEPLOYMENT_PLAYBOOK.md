# AWS deployment playbook for MomTest AI

## Goal

Learn AWS in a low-risk way with a real project, while keeping cost and operational risk low.

## Phase 1: mock deploy (first deployment)

This is the default first step.

### Required behavior

- App runs without a real LLM key
- `APP_LLM_MODE=mock` disables live model calls
- PostgreSQL is still required, but it can be containerized locally or in EC2
- the app should be reachable via the EC2 public IP

### Why this phase matters

It teaches:
- how EC2 instances work
- how Docker Compose runs the app
- how ports and security groups are configured
- how to verify health from the browser and terminal

## Phase 2: move database to AWS

When the app is healthy in mock mode:

- create an RDS PostgreSQL instance
- update `DATABASE_URL` to the RDS endpoint
- set subnet, security group, and VPC rules carefully
- verify the app connects and runs migrations

## Phase 3: add real API key securely

- store `OPENAI_API_KEY` in AWS Secrets Manager or SSM Parameter Store
- inject it at runtime
- never commit the key into source control
- keep the value empty in local mock mode

## Phase 4: budget protection

Before enabling live LLM calls:

- set a billing alert in AWS Budgets
- choose a low value such as $5 or $10
- monitor usage daily until traffic stabilizes

## Phase 5: optional CI/CD

After successful mock and live deployment:

- add GitHub Actions workflow
- trigger on push to main
- deploy to EC2 with SSH or a CodeDeploy-style pattern

## Recommended service choice for this project

For this specific project, the best first choice is:

- EC2 + Docker Compose

Reason:
- the app is a full-stack Next.js app with a Postgres dependency
- the app uses streaming / SSE behavior that is awkward for a pure serverless first pass
- this setup is easier to learn and observe than Lambda or Elastic Beanstalk for the initial AWS learning goal

## Minimal production env

APP_LLM_MODE=live
DATABASE_URL=postgresql://user:password@host:5432/dbname
OPENAI_API_KEY=secret-from-aws
NODE_ENV=production

## Success criteria for phase 1

- EC2 instance is running
- Docker app container is running
- app responds on port 3000
- project routes return successfully
- no live LLM API is invoked
