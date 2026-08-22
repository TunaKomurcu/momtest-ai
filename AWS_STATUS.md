# AWS / Local Podman Status Summary

This document captures the current state of the project before any actual AWS console or EC2 work begins.

## 1) Project status

The app is a Next.js 16 project with:
- App Router and TypeScript
- PostgreSQL via Drizzle ORM
- local mock-safe LLM mode for early deployment validation
- AWS provisioning is now in progress; Step 1 resources are recorded in section 8

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

This is not yet a complete AWS deployment. Step 1 EC2 resources now exist; application and database deployment have not started.

We have not created:
- application/database containers on EC2
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
- EC2, security group, and IAM provisioning completed for Step 1

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
- Step 1 AWS resources are provisioned and verified
- application deployment and remaining AWS services are intentionally deferred until each ordered step is approved

This keeps the process low-risk and keeps the local validation evidence clear.

## 8) AWS Provisioning Log

### Step 1 — EC2 instance
Status: Complete for EC2, network, and CloudWatch role setup. Secrets Manager policy remains intentionally deferred to Step 3.

What worked:
- AWS CLI identity verified: account `820140266422`, IAM user `Tuna`
- Region verified: `eu-central-1`
- Default VPC: `vpc-0215e307a2e691daa`
- Default public subnet: `subnet-00f525589d86d7c37` in `eu-central-1b`
- Dedicated security group created: `sg-00e85fb37eaf3bd8e`
- IAM role created: `MomtestAiEc2Role`
- Instance profile created and attached: `MomtestAiEc2InstanceProfile`
- `CloudWatchAgentServerPolicy` attached to the role
- EC2 instance launched: `i-04033337a3ad94650`
- Instance type: `t3.small`
- Amazon Linux 2023 AMI: `ami-070722d1cfd0ddeec`
- Public IP: `18.184.5.221`
- Private IP: `172.31.43.93`
- Root volume: 30 GB encrypted gp3, `vol-010c5b50b7735a4bf`
- IMDSv2 enforced with `HttpTokens=required`

Security group validation:
- TCP 22 allowed only from `85.153.205.28/32`
- TCP 80 allowed from `0.0.0.0/0`
- TCP 443 allowed from `0.0.0.0/0`
- TCP 3000 has no internet ingress rule

Secrets policy note:
- A temporary wildcard-suffixed Secrets Manager policy was created during provisioning but immediately detached and deleted.
- No wildcard Secrets Manager policy remains attached.
- The exact project-scoped read-only policy will be created after Step 3 creates `momtest-ai/OPENAI_API_KEY` and `momtest-ai/DATABASE_URL`, so the policy can use their exact ARNs without wildcard resources.

Tests performed:
- `aws sts get-caller-identity` returned account `820140266422`
- EC2 waiter returned instance state `running`
- Security group inspection confirmed only the requested 22/80/443 ingress rules
- Volume inspection confirmed `Size=30`, `Type=gp3`, `Encrypted=true`, `State=in-use`
- Metadata options inspection confirmed `HttpTokens=required`

Next step:
- Step 2: connect to the running EC2 instance, install Podman, clone the repository, and preserve the `app-net` network design.

t3.medium note:
- If production build or runtime memory is insufficient on `t3.small`, resize the instance to `t3.medium` and record the change here before continuing.

### Step 2 — Podman kurulumu ve repo clone
Status: Complete on EC2. Docker 25.0.14 is used because Podman is not available in the Amazon Linux 2023 repositories used on this instance.

What was previously tested:
- The instance role includes `AmazonSSMManagedInstanceCore`
- The user-reported interactive SSM Session Manager connection is available
- An `AWS-RunShellScript` command was prepared to install Podman and Git, clone `https://github.com/TunaKomurcu/momtest-ai.git` to `/opt/momtest-ai`, and create/verify the `app-net` Podman network
- `aws ssm send-command` was attempted for `i-04033337a3ad94650`

Verified EC2 output:
- Container engine: Docker `25.0.14`
- Repository HEAD: `8d1f0c1`
- Network: `app-net`
- Network ID: `6088afca240ca7c8e754b30ee40ac5ff326d2c9de2e4eca9049c10919e75c748`
- Network driver: `bridge`
- Network subnet: `172.18.0.0/16`
- Network gateway: `172.18.0.1`

Security decision:
- No broad or wildcard SSM permission was added
- The existing SSM interactive session remains usable, so the bootstrap can be pasted into that session; alternatively, grant the AWS user a narrowly scoped `ssm:SendCommand` permission for this instance and the `AWS-RunShellScript` document, then retry this step

Next step:
- Step 3: create the two Secrets Manager entries, attach an exact-ARN read-only policy, and use the runtime startup script to load values without committing secrets.

### Step 3 — Secrets Manager
Status: Resources, exact-ARN policy, and secret values complete; runtime mock validation is pending on EC2.

Prepared files:
- `aws/start-momtest-runtime.sh` fetches `momtest-ai/OPENAI_API_KEY` and `momtest-ai/DATABASE_URL` at runtime through the EC2 role and writes only an ephemeral `/run/momtest-ai/app.env` file.
- `aws/momtest-ai-secrets-policy.json` contains the exact ARNs returned by AWS; no wildcard resource is permitted.

Created resources:
- `momtest-ai/OPENAI_API_KEY`: `arn:aws:secretsmanager:eu-central-1:820140266422:secret:momtest-ai/OPENAI_API_KEY-6b4xda`
- `momtest-ai/DATABASE_URL`: `arn:aws:secretsmanager:eu-central-1:820140266422:secret:momtest-ai/DATABASE_URL-1nPOHU`
- IAM policy: `arn:aws:iam::820140266422:policy/MomtestAiSecretsReadOnly`, attached to `MomtestAiEc2Role`
- Secret values were entered by the user and verified as present without exposing their contents; they are not present in the repository.

Security rules:
- Secret values are not present in the repository or committed `.env` files.
- The script defaults to `mock` mode for the first EC2 validation. `live` mode is enabled only after the mock deployment succeeds and `OPENAI_API_KEY` has been stored.
- The database URL remains a secret and will be updated to the RDS endpoint during Step 7.

Tests performed:
- `momtest-ai/DATABASE_URL` value present; content was not printed
- `momtest-ai/OPENAI_API_KEY` value present; content was not printed
- Exact-ARN policy remains attached to `MomtestAiEc2Role`

Next step:
- Copy `aws/start-momtest-runtime.sh` to EC2, run it in `mock` mode, and continue with Step 4 database setup and migration validation.

### Step 4 — Postgres DB container and migration
Status: Ready to execute on EC2, but remote execution is blocked because the local IAM user lacks `ssm:SendCommand`.

Required EC2 terminal sequence:
- Create or reuse the Docker `app-net` network with the existing `172.18.0.0/16` design.
- Start the PostgreSQL 16 container as `momtest-db` with the existing `momtest` credentials and a named persistent volume.
- Copy and run `aws/start-momtest-runtime.sh mock` to create the runtime environment file.
- Run Drizzle migrations against the DB container hostname and verify `projects`, `interviews`, and `messages`.
- The app container must use `DATABASE_URL` from the Secrets Manager-loaded runtime file, not a committed `.env` value.

Execution blocker:
- `aws ssm send-command` returned `AccessDeniedException` for `ssm:SendCommand` on `i-04033337a3ad94650`.
- No Step 4 command was executed by this session; no migration or EC2 health result is claimed yet.
