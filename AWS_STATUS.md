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

Additional EC2 verification:
- Repository synchronized successfully to commit `a06dbdf`
- `Dockerfile`, `aws/start-momtest-runtime.sh`, and `aws/momtest-ai-secrets-policy.json` are present on EC2
- Runtime script completed in `mock` mode
- Runtime environment file permissions are `600` at `/run/momtest-ai/app.env`
- Docker container `momtest-db` is running from `postgres:16-alpine`
- PostgreSQL `pg_isready` returned `accepting connections`
- Database connection succeeded for database `momtest` as user `postgres`

Next step:
- Step 3: create the two Secrets Manager entries, attach an exact-ARN read-only policy, and use the runtime startup script to load values without committing secrets.

### Step 3 — Secrets Manager
Status: Resources, exact-ARN policy, secret values, and live runtime secret loading complete.

Prepared files:
- `aws/start-momtest-runtime.sh` fetches `momtest-ai/OPENAI_API_KEY` and `momtest-ai/DATABASE_URL` at runtime through the EC2 role and writes only an ephemeral `/run/momtest-ai/app.env` file.
- `aws/momtest-ai-secrets-policy.json` contains the exact ARNs returned by AWS; no wildcard resource is permitted.
- Both files were committed and pushed to `origin/feature/add-aws-podman` in commit `4e85482`.

Created resources:
- `momtest-ai/OPENAI_API_KEY`: `arn:aws:secretsmanager:eu-central-1:820140266422:secret:momtest-ai/OPENAI_API_KEY-6b4xda`
- `momtest-ai/DATABASE_URL`: `arn:aws:secretsmanager:eu-central-1:820140266422:secret:momtest-ai/DATABASE_URL-1nPOHU`
- IAM policy: `arn:aws:iam::820140266422:policy/MomtestAiSecretsReadOnly`, attached to `MomtestAiEc2Role`
- Secret values were entered by the user and verified as present without exposing their contents; they are not present in the repository.

Security rules:
- Secret values are not present in the repository or committed `.env` files.
- The script defaults to `live` mode now that mock deployment has succeeded and `OPENAI_API_KEY` is stored. Pass `mock` explicitly when a mock-only run is needed.
- The database URL remains a secret and will be updated to the RDS endpoint during Step 7.

Tests performed:
- `momtest-ai/DATABASE_URL` value present; content was not printed
- `momtest-ai/OPENAI_API_KEY` value present; content was not printed
- Exact-ARN policy remains attached to `MomtestAiEc2Role`

Next step:
- Live mode is verified on EC2. Step 4 database migration and Step 5-6 deployment validation are recorded below; Step 7 RDS migration remains gated by approval.

#### Live LLM Mode Verified
Date: 2026-08-23

What worked:
- EC2 IAM role successfully read `momtest-ai/OPENAI_API_KEY` through `aws secretsmanager get-secret-value`; the key was redirected to `/dev/null` and was not printed.
- `start-momtest-runtime.sh live` completed successfully and produced `/run/momtest-ai/app.env` with permission `600`.
- `momtest-app` was restarted with the live runtime environment on the existing `app-net` network.
- Test project created: `b547c9eb-7bc3-4fbd-9e2b-31f266224e2a`.
- Live endpoint tested once: `POST /api/intake/b547c9eb-7bc3-4fbd-9e2b-31f266224e2a`.
- Response was a context-specific follow-up question: `What specific challenges do you face when coordinating interviews through spreadsheets and chat?`
- Response did not contain the mock marker `Mock mode is active`, and `LIVE_CHECK=passed_non_mock_reply` was returned.

Commit/runtime note:
- The production app image used for this test was built from commit `89ee5d3`.
- The later live-default script commit is `e154669`; EC2 could not checkout that commit because the existing local script had uncommitted changes. The explicit `live` invocation nevertheless succeeded, so no secret was copied into the repository or image.

Cost estimate:
- One live intake request was made. The endpoint uses `gpt-4o-mini` with `max_tokens=1024`.
- Exact token usage was not returned by this route, so the cost cannot be measured exactly from the response. Using the configured model's typical pricing as an estimate and approximately 330 input tokens plus 13 output tokens, the request is approximately `$0.00006` (well below one cent). Confirm the exact amount in the OpenAI usage dashboard.

Next step:
- Live mode is verified. Do not switch the database yet in the same validation step. Await approval before starting Step 7 RDS migration and first create the required `pg_dump` backup of the current Docker database.

### Step 4 — Postgres DB container and migration
Status: Complete on EC2. PostgreSQL container, secret URL authentication, migrations, and table verification passed.

Required EC2 terminal sequence:
- Create or reuse the Docker `app-net` network with the existing `172.18.0.0/16` design.
- Start the PostgreSQL 16 container as `momtest-db` with the existing `momtest` credentials and a named persistent volume.
- Copy and run `aws/start-momtest-runtime.sh mock` to create the runtime environment file.
- Run Drizzle migrations against the DB container hostname and verify `projects`, `interviews`, and `messages`.
- The app container must use `DATABASE_URL` from the Secrets Manager-loaded runtime file, not a committed `.env` value.

Execution note:
- Remote execution from this local AWS user remains unavailable because `ssm:SendCommand` is denied, but the user successfully ran the commands through the interactive EC2 SSM terminal.
- Database readiness is verified, but the first migration attempt failed before connecting to PostgreSQL.
- Cause: `npm ci` inherited `NODE_ENV=production` from `/run/momtest-ai/app.env` and omitted the dev dependency `drizzle-kit`; `npx` then used a temporary package that could not load `drizzle.config.ts`.
- No relations were created; `\dt` confirmed the database is still empty.

Correction:
- Run the migration helper with `npm ci --include=dev` so the repository's pinned `drizzle-kit` dependency is installed before `npx drizzle-kit push`.
- The direct migration attempt showed `DATABASE_HOST=db` but PostgreSQL rejected user `momtest` because the container was initialized with `POSTGRES_USER=postgres`.
- This is an authentication-configuration mismatch, not a network failure. The database currently has no application relations, and the repair must preserve the existing volume rather than recreate it.

Next repair:
- Create or update the `momtest` database role to match the username/password already stored in the `DATABASE_URL` secret, then rerun the committed SQL migrations.
- The first role-repair command produced no success output and did not resolve authentication; subsequent migration attempts still failed with `password authentication failed for user "momtest"`.
- Before the clean reset, `\dt` and `\d interviews` showed no application relations; no migration data was created or lost.
- The next connection test used `psql "$DATABASE_URL"` directly on the EC2 host; the host shell expanded the unset variable before Docker, so `psql` attempted the local Unix socket. The secret value must be expanded inside the temporary PostgreSQL container.
- The corrected inner-container connection test reached `db (172.18.0.2)` but still failed authentication for `momtest`.
- The user confirmed that the current database contains no application data; `\dt` returned no relations. A clean DB volume reset is therefore authorized before retrying Step 4.

Clean reset plan:
- Stop and remove only the empty `momtest-db` container and its `momtest-postgres-data` volume.
- Recreate PostgreSQL with user `momtest` and the password extracted from the existing `DATABASE_URL` secret, preserving the `app-net` network and `db` alias.
- Verify the secret URL connection, then run both committed SQL migration files.

### Step 5 — App container build and run
Status: Complete on EC2 in mock mode; live mode was subsequently verified above.

Observed EC2 failure:
- `docker build -t momtest-ai:step5 .` reached `next build` but failed because `@tailwindcss/postcss` was unavailable.
- Cause: the disposable `deps` stage used `npm ci --omit=dev`, while the production build requires build-time dev dependencies.

Fix:
- `Dockerfile` now uses `npm ci` in the build dependency stage. The final standalone runner image remains production-focused and does not copy the full build-stage `node_modules` directory.
- The fix was published to `feature/add-aws-podman` in commit `89ee5d3`.

EC2 build verification:
- EC2 checkout reached commit `89ee5d3` successfully.
- `sudo docker build -t momtest-ai:step5 .` completed successfully through all 20 build stages.
- Production image `momtest-ai:step5` was created successfully.
- App container `momtest-app` started successfully from `momtest-ai:step5`.
- Container is attached to `app-net` and publishes host port `80` to container port `3000`.
- Container logs reported Next.js `16.2.9` ready on port `3000`.
- EC2-local `curl http://127.0.0.1/api/projects` returned HTTP `200 OK` with `{"data":[],"error":null}` in mock mode.

Next step:
- Step 5 local and Step 6 external validation are complete. Live LLM mode is also verified; Step 7 RDS migration remains pending.

### Step 6 — Dışarıdan erişim doğrulama
Status: Complete. The application is reachable through the EC2 public IP on port 80.

Tests performed:
- External request to `http://18.184.5.221/api/projects` returned HTTP `200`.
- Response body was `{"data":[],"error":null}`.
- No ALB or domain was used, as required for this stage.

Next step:
- Step 7: before creating RDS, verify the current Docker PostgreSQL volume and take a `pg_dump` backup. The current application data is empty, but the backup must still be created before changing the database target.

Completed EC2 verification:
- The empty `momtest-postgres-data` volume was reset as authorized; no application data was lost.
- PostgreSQL was recreated with the `momtest` username and the password from the loaded `DATABASE_URL` secret.
- Secret URL connection succeeded: database `momtest`, current user `momtest`.
- Migration `0000_loud_micromax.sql` completed: three `CREATE TABLE` statements and the project foreign key succeeded.
- Migration `0001_add_injection_count_to_interviews.sql` completed: `ALTER TABLE` succeeded.
- `\dt` confirmed `projects`, `interviews`, and `messages` owned by `momtest`.
- `\d interviews` confirmed the `injection_count` integer column with default `0`.

Next step:
- Step 5: build and run the production app container on `app-net` in mock mode, publishing host port 80 to container port 3000, then validate `/api/projects` from EC2.
