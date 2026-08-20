# AWS / Local Podman Status Summary

This document captures the current state of the project before any actual AWS console or EC2 work begins.

## 1) Project status

The app is a Next.js 16 project with:
- App Router and TypeScript
- PostgreSQL via Drizzle ORM
- local mock-safe LLM mode for early deployment validation
- no AWS resources created yet

Current local environment is set up to run in a low-risk way using Podman and a mock LLM mode.

## 2) What has been validated locally

### Podman setup
- Podman is installed and working
- App image was successfully built from the project root using the native Podman file
- A custom network named app-net was used for container-to-container name resolution

### Database layer
- PostgreSQL container was started in Podman
- DB hostname resolution was fixed by running both app and DB on the same custom network
- Schema tables were created in the database and verified

Verified tables:
- projects
- interviews
- messages

### App runtime
- The app container was started with:
  - APP_LLM_MODE=mock
  - NODE_ENV=production
  - DATABASE_URL=postgresql://momtest:momtest@db:5432/momtest
- The health endpoint was tested successfully

Success evidence:
- /api/projects returned HTTP 200 OK
- no EAI_AGAIN db resolution failure remained
- no relation "projects" does not exist error remained

## 3) Important constraint

This is not yet a real AWS deployment.

We have not created:
- EC2 instance
- security groups
- IAM roles
- RDS or Secrets Manager
- Route 53 or ALB
- any AWS-managed resources

Everything done so far is local-only runtime validation to reduce risk before touching AWS.

## 4) Why mock mode is still safe

The app is intentionally configured so that it can run without a live LLM API key during early validation.

This is useful for:
- local Podman testing
- deployment path learning
- avoiding unnecessary API costs
- validating container networking and app startup before real credentials are introduced

## 5) Actual technical state

The project is in this state:
- buildable in production mode
- runnable via Podman locally
- reachable on localhost:3000
- database-backed API route responding successfully
- no AWS console work started yet

## 6) Remaining work for real AWS

When AWS access is available, the next sequence is:
1. create EC2 instance
2. install Podman on EC2
3. clone repo
4. create network and DB container
5. build app image
6. run app container on same network
7. validate /api/projects again
8. add real environment values and secrets management
9. optionally move DB to RDS later

## 7) Current recommendation

Continue with the next chat using this exact baseline:
- local Podman path is working
- no AWS deploy yet
- no AWS account actions taken
- real EC2/AWS work is intentionally deferred until the environment is available

This keeps the process low-risk and keeps the local validation evidence clear.
