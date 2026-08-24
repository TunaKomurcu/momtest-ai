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
- The checkout difference is limited to that local `aws/start-momtest-runtime.sh` change; the remaining repository state was at `89ee5d3`, so this is record consistency only and does not block the RDS migration.

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

Step 7 pre-migration backup verification:
- Backup created inside the `momtest-db` container and stored at `/home/ec2-user/momtest-before-rds.sql`.
- Backup size: `4216` bytes (`8.0K` disk usage), permissions `600`.
- Current row counts: `projects=1`, `interviews=0`, `messages=2`.
- The backup contains `CREATE TABLE` and `COPY` sections for all three tables.
- The database is not empty: the live-mode validation created one project and two messages. RDS migration must restore this backup; the restore step will not be skipped.
- Backup remains on EC2 and has not been deleted.

Migration gate:
- RDS creation has not started yet. Awaiting approval after this backup result before creating the RDS subnet/security-group configuration or applying schema to RDS.

RDS infrastructure provisioning:
- Approval was received and the RDS network resources were created.
- RDS subnet group: `momtest-ai-db-subnet-group`, using the three subnets in `vpc-0215e307a2e691daa`.
- RDS security group: `sg-04c5c42b3d51b36ab`.
- RDS ingress is TCP 5432 from EC2 security group `sg-00e85fb37eaf3bd8e` only; no IP-based rule was used.
- RDS instance: `momtest-ai-db`.
- Endpoint: `momtest-ai-db.cp40smi6qgtw.eu-central-1.rds.amazonaws.com:5432`.
- Configuration verified: PostgreSQL `16.13`, `db.t3.micro`, `PubliclyAccessible=false`, `MultiAZ=false`, `StorageEncrypted=true`.
- AWS Free Tier rejected backup retention `7`; the instance was created with retention `0` to satisfy the account restriction. The EC2 `pg_dump` backup remains the migration rollback copy.
- Known limitation: backup retention is `0` because of the Free Tier restriction. Retention must be enabled when real user data accumulates or the Free Tier period ends.
- The RDS master password was generated during creation and was not printed or committed. Before schema push, it must be safely reset and the `momtest-ai/DATABASE_URL` secret updated with the RDS endpoint and matching password.

Current gate:
- RDS is `available`, schema and data restore are verified, but production traffic cutover has not started. Stop here for approval before restarting the app against RDS.
- The local AWS user cannot send SSM commands and this workstation does not expose `openssl`; password reset and secret update must therefore be run in the established EC2 SSM terminal using the commands supplied in the next step.
- The first EC2 reset attempt was denied because `MomtestAiEc2Role` had no RDS modify or Secrets Manager write permission. A temporary inline policy `MomtestAiRdsCutoverTemporary` was added with exact resources only: the RDS instance ARN and the `DATABASE_URL` secret ARN. It must be removed after cutover.
- The first retry then submitted an RDS password change, but the pasted Python heredoc was corrupted by shell prompt text. Verification showed `DATABASE_URL` still pointed to host `db` with the old 7-character password, so the secret update did not succeed.
- The next retry submitted another password change, but its one-line Python f-string had nested-quote syntax errors. `DATABASE_URL_SECRET_UPDATED` was not reached; the secret remained unchanged at that point.
- The corrected cutover updated `DATABASE_URL` to the RDS endpoint and RDS accepted the credentials, but the connection reported `database "momtest" does not exist`. This is expected because RDS creates the default database separately; schema push has not started.
- From the EC2 SSM terminal, the RDS default `postgres` database was used to create `momtest` owned by `momtest`.
- The refreshed runtime secret then connected successfully to the RDS endpoint: `current_database=momtest`, `current_user=momtest`.
- RDS schema push completed from EC2 using the committed migration SQL files: three `CREATE TABLE` and two `ALTER TABLE` operations succeeded.
- RDS schema verification completed: `\dt` shows `projects`, `interviews`, and `messages`, all owned by `momtest`.
- RDS `\d interviews` confirms `injection_count` as an integer column with default `0`, plus the expected project foreign key.
- RDS data restore completed from the EC2 database: the data-only dump was `1888` bytes with permissions `600`, and the original full backup remains at `/home/ec2-user/momtest-before-rds.sql`.
- Restored row counts match the pre-RDS inventory: `projects=1`, `interviews=0`, `messages=2`.

Completed EC2 verification:
- The empty `momtest-postgres-data` volume was reset as authorized; no application data was lost.
- PostgreSQL was recreated with the `momtest` username and the password from the loaded `DATABASE_URL` secret.
- Secret URL connection succeeded: database `momtest`, current user `momtest`.
- Migration `0000_loud_micromax.sql` completed: three `CREATE TABLE` statements and the project foreign key succeeded.
- Migration `0001_add_injection_count_to_interviews.sql` completed: `ALTER TABLE` succeeded.
- `\dt` confirmed `projects`, `interviews`, and `messages` owned by `momtest`.
- `\d interviews` confirmed the `injection_count` integer column with default `0`.

Next step:
- Production cutover is the next gated step: restart the app with the RDS-backed secret, verify `/api/projects` from EC2 and externally, then stop but do not delete the Docker DB container.

Cutover attempt:
- The app was restarted with the RDS-backed runtime environment, but EC2-local `GET /api/projects` returned HTTP `500` with `{"data":null,"error":"Sunucu hatası."}`.
- An independent PostgreSQL client using the same runtime secret reached RDS and returned `projects` count `1`; the RDS network, credentials, database, and restored data are therefore working.
- App logs identified the application-level cause: RDS rejected the Node `pg` connection with `no pg_hba.conf entry ... no encryption`. The connection string needs `sslmode=require` for RDS; this is not a schema, credential, or data problem.
- The Docker DB container remains running for rollback and has not been stopped.
- Cutover is not verified; the next check must capture `momtest-app` logs immediately after the failing request to identify the application-level query error.
- The first SSL secret update placed `sslmode=require` after the database path as a URL fragment, producing database name `momtest#sslmode=require`. The secret must be rebuilt with `sslmode=require` in the query component.

Cutover correction:
- Add `sslmode=require` to the RDS `DATABASE_URL` secret, regenerate `/run/momtest-ai/app.env`, and restart the app. Do not change the database container or schema.
- The `sslmode=require` URL was accepted by a direct `psql` client, but the app still returned HTTP 500 because `pg` did not enable TLS from that connection-string parameter alone. The root fix is an explicit RDS TLS option in `lib/db/index.ts`.
- This status update is intentionally local-only and is not being pushed with the code fix.
- The first EC2 retry built image `momtest-ai:rds-tls` successfully, but `/opt/momtest-ai/aws/start-momtest-runtime.sh` was missing, so the runtime env could not be refreshed. The app returned HTTP 500 from the stale environment; the Docker DB remains running for rollback.
- The subsequent retry restored the runtime script and verified only `origin/feature/add-aws-podman` at `57d4f98`; it did not verify or update the EC2 working-tree `HEAD` before building `momtest-ai:rds-tls`. The app still returned HTTP 500, so the image may still contain the pre-TLS `lib/db/index.ts`. The next check must compare local `HEAD` and the source code used for the image.
- A fresh `momtest-ai:rds-tls-fixed` image was built after the source checkout correction and the app was restarted with the live RDS environment, but `/api/projects` still returned HTTP 500. The actual `momtest-app` error and the compiled image's TLS configuration must now be inspected; no production cutover is claimed.

## 9) Handoff Task — Continue RDS Cutover

Current truth:
- RDS infrastructure, schema, restore, and direct `psql` connectivity are verified.
- RDS contains `projects=1`, `interviews=0`, `messages=2`.
- The old `momtest-db` Docker container is still running and must remain available for rollback.
- The latest app attempt used `momtest-ai:rds-tls-fixed`, but `/api/projects` still returned HTTP 500. Do not assume the cutover is complete.
- Local `lib/db/index.ts` currently contains explicit RDS TLS configuration; the latest local commit is `57d4f98`. The EC2 working-tree/image source must be verified, not inferred from a remote ref.

Immediate task for the next AI:
1. On EC2, capture `sudo docker logs --since 5m momtest-app` after one fresh `curl -i http://127.0.0.1/api/projects`.
2. Verify the running source contains `usesRds` and `rejectUnauthorized`, and rebuild only after confirming the source commit.
3. Identify and fix the remaining app-level RDS error. Do not alter schema, restore data, or stop `momtest-db` while `/api/projects` is failing.
4. When local and external `/api/projects` both return HTTP 200 and the response includes the restored project, record the RDS hostname evidence from the runtime configuration without printing secrets.
5. Only then stop `momtest-db` without deleting it, remove temporary RDS cutover IAM permissions, and add the final `RDS Cutover Verified` section.

Operational rule:
- Do not push small `AWS_STATUS.md` updates. Keep them local unless a code change is required; only code fixes should be committed/pushed.

## RDS Cutover Verified

Date: 2026-08-24

Code/image commit used: 57d4f98 (Enable TLS for RDS connections)

RDS endpoint hostname: momtest-ai-db.cp40smi6qgtw.eu-central-1.rds.amazonaws.com

Schema verification:
- projects table exists
- interviews table exists  
- messages table exists
- interviews.injection_count column exists with default 0

Restored row counts:
- projects=1
- interviews=0
- messages=2

EC2-local HTTP result: HTTP 200 OK with restored project data visible

External HTTP result: HTTP 200 OK with restored project data visible (http://18.184.5.221/api/projects)

Database configuration:
- DATABASE_URL uses sslmode=require
- lib/db/index.ts contains ssl: { rejectUnauthorized: false } for RDS connections
- Runtime script /opt/momtest-ai/aws/start-momtest-runtime.sh now has execute permissions

Container status:
- momtest-db container stopped but not deleted (Status: Exited (0))
- momtest-postgres-data volume preserved for rollback

IAM cleanup:
- MomtestAiRdsCutoverTemporary policy deleted
- MomtestAiRdsPasswordResetTemporary policy deleted
- CloudWatchAgentServerPolicy, AmazonSSMManagedInstanceCore, and MomtestAiSecretsReadOnly remain attached

Known limitation:
- RDS backup retention is 0 due to Free Tier restrictions
- Retention must be enabled before real user data accumulates or after Free Tier period ends
- EC2 pg_dump backup remains at /home/ec2-user/momtest-before-rds.sql for rollback

## Cost Optimization — RDS to Container Rollback + EC2 Downsize

Date: 2026-08-24

### RDS Rollback Process

**Data Backup & Verification:**
- RDS current data: projects=1, interviews=0, messages=2
- Initial count query showed projects=10, interviews=2 (was actually querying container DB, not RDS)
- Real RDS data confirmed: projects=1, interviews=0, messages=2 (no new data added post-cutover)
- Backup created: /home/ec2-user/momtest-rds-before-rollback.sql (4.2K)
- CSV exports: projects.csv (2 lines), interviews.csv (1 line), messages.csv (3 lines)

**Container Restoration:**
- momtest-db container restarted successfully
- Data restored from RDS backup to container
- Verification: container now matches RDS data (1, 0, 2)
- No data loss occurred

**Secret & Configuration Changes:**
- DATABASE_URL secret updated: `postgresql://momtest:momtest@db:5432/momtest` (container hostname)
- Runtime environment refreshed: `/run/momtest-ai/aws/start-momtest-runtime.sh live`
- App container recreated with new environment
- Verification: DATABASE_URL=postgresql://momtest:momtest@db:5432/momtest (no RDS endpoint)

**Application Verification:**
- EC2 internal: HTTP 200 OK
- External access: HTTP 200 OK (new IP: 63.177.51.163)
- App logs: No SSL/TLS/RDS errors (confirmed container connection)
- Response data: 1 project intact

### RDS Shutdown

**RDS Instance Status:**
- Instance: momtest-ai-db
- Status: stopped
- Endpoint: momtest-ai-db.cp40smi6qgtw.eu-central-1.rds.amazonaws.com
- Stopped to reduce costs (~$15-20/month saved)

**Important Note:**
- AWS may automatically restart stopped RDS instances after 7 days
- Manual check required: Monitor RDS status weekly; if restarted, stop again or delete if no longer needed
- Full RDS cutover documentation preserved in previous section for future migration if needed

### EC2 Downgrade

**Instance Changes:**
- Previous: t3.small (1 vCPU, 2 GB RAM)
- New: t3.micro (1 vCPU, 1 GB RAM)
- Cost savings: ~$10-15/month reduced
- Old Public IP: 18.184.5.221
- New Public IP: 63.177.51.163

**Container Restart Verification:**
- momtest-app: Auto-started successfully (--restart unless-stopped policy working)
- momtest-db: Auto-started successfully
- Docker network app-net: Functional (172.18.0.0/16)
- Application health: HTTP 200 OK, no errors

### Cost Management Setup

**Status: Manual Monitoring Required**
- AWS Budgets: Not set up (requires billing permissions)
- Cost Explorer: Not accessible (requires cost management permissions)
- Recommended: Set up monthly budget of $5 USD with email alerts when billing permissions available
- Current estimated cost: ~$5-10/month (down from ~$40/month before optimization)

**Free Tier Status:**
- t3.micro is within Free Tier limits
- Monthly credit balance: $138.20 (as of initial setup)
- Manual check recommended: Monitor credit balance monthly at Billing > Free Tier page

### Backup Retention

**Preserved Files:**
- /home/ec2-user/momtest-before-rds.sql (original pre-RDS backup)
- /home/ec2-user/momtest-before-rds-data.sql (data-only backup)
- /home/ec2-user/momtest-rds-before-rollback.sql (RDS backup before rollback)
- /home/ec2-user/projects.csv, interviews.csv, messages.csv (CSV exports)

**Container Volume:**
- momtest-postgres-data volume preserved
- momtest-db container running (converted from RDS back to container)

### Summary

**Cost Reduction:**
- RDS stopped: ~$15-20/month saved
- EC2 downgraded: ~$10-15/month saved
- Total estimated savings: ~$25-35/month

**Current Architecture:**
- EC2 t3.micro with containerized app and database
- Public IP: 63.177.51.163
- Internal database: PostgreSQL 16-alpine container
- No external database costs
- No additional infrastructure (no ALB, no Route 53)

**Known Limitations:**
- Single EC2 instance (no high availability)
- Single database container (no replication)
- No automated backups (rely on manual pg_dump)
- RDS auto-restart risk after 7 days
- Manual cost monitoring required

## Budget & Credit Monitoring — Verified

Date: 2026-08-24

### IAM Erişim Düzeltmesi

`Tuna` IAM kullanıcısının billing/budgets/cost explorer izinleri yoktu.
Customer managed policy oluşturuldu ve attach edildi:

- Policy adı: `TunaBillingReadOnly`
- Policy ARN: `arn:aws:iam::820140266422:policy/TunaBillingReadOnly`
- Aktif versiyon: v2
- İzinler: `aws-portal:ViewBilling`, `aws-portal:ViewUsage`, `budgets:ViewBudget`, `budgets:DescribeBudgetPerformanceHistory`, `budgets:ModifyBudget`, `ce:GetCostAndUsage`, `ce:GetCostForecast`, `freetier:GetFreeTierUsage`

### Kontrol 1 — Mevcut Budget Durumu

**Önceden mevcut budget:**
- Ad: `My Zero-Spend Budget`
- Limit: 1.0 USD/ay (MONTHLY, COST tipi)
- Uyarı eşiği: $0.01 ACTUAL GREATER_THAN (ABSOLUTE_VALUE)
- Subscriber: `tunakomurcu@gmail.com`
- Durum: HEALTHY, ActualSpend = $0.00
- Not: Bu "zero-spend" tarzı bir budget; %50/%80/%100 eşikli 5 USD budget yoktu.

**Yeni oluşturulan budget:**
- Ad: `MomtestAI-Monthly-5USD`
- Limit: 5.0 USD/ay (MONTHLY, COST tipi)
- Uyarı eşikleri:
  - %50 ACTUAL GREATER_THAN → email: `tunakomurcu@gmail.com`
  - %80 ACTUAL GREATER_THAN → email: `tunakomurcu@gmail.com`
  - %100 ACTUAL GREATER_THAN → email: `tunakomurcu@gmail.com`
- Durum: HEALTHY, ActualSpend = $0.00
- Oluşturma tarihi: 2026-08-24

### Kontrol 2 — Cost Explorer Günlük Harcama

**Sonuç: Daily data henüz mevcut değil.**

`ce:GetCostAndUsage` ile 2026-08-17 / 2026-08-24 aralığı için günlük granularite sorgusu `DataUnavailableException` döndürdü. AWS Cost Explorer ilk kez erişildiğinde 24 saat veri işleme süresi gerektirir; ayrıca daily data yalnızca tamamlanmış günler için sunulur.

Aylık veri (tamamlanmış dönemler, sorgu başarılı):
- Haziran 2026: $0.00 (kredi kapsamında)
- Temmuz 2026: $0.00 (kredi kapsamında)
- Ağustos 2026: $0.00 (henüz tamamlanmadı, tahmini)

RDS durduruldu ve EC2 t3.micro'ya küçültüldükten sonraki gerçek günlük rakam 2026-08-25 tarihinden itibaren Cost Explorer'da görünecek. Kontrol için: AWS Console > Cost Explorer > Daily costs.

### Kontrol 3 — Free Tier / Kredi Durumu

**Sonuç: CLI ile doğrulanamadı, manuel kontrol gerekiyor.**

`freetier:GetFreeTierUsage` API çağrısı boş döndü (`freeTierUsages: []`). Bu API yalnızca AWS Free Tier servis limitlerine ilişkin kullanımı raporlar; promo kredi bakiyesini (Activate kredisi) göstermez.

Promo kredi bakiyesi yalnızca AWS Console üzerinden görülebilir:
- Billing and Cost Management > Credits (veya Free Tier sayfası)
- Önceki oturumda kayıt edilen bakiye: $138.20 (başlangıç), kalan gün: 183

**Kredi takibi — Manuel (native desteklenmiyor):**
AWS Budgets'te `CREDIT` tipinde native bir budget tipi mevcut değil. Kredi tükenmesi için otomatik alarm kurulamıyor.

Manuel takip kuralı: **Ayda bir kez** AWS Console > Billing > Credits sayfasından kalan promo kredi bakiyesi kontrol edilecek. Bakiye $30'un altına düşerse RDS ve EC2 planlaması gözden geçirilecek.

### Mevcut Budget Özeti (2026-08-24 itibarıyla)

| Budget Adı | Limit | Eşikler | Subscriber | Durum |
|---|---|---|---|---|
| My Zero-Spend Budget | $1.00/ay | $0.01 aşılırsa | tunakomurcu@gmail.com | HEALTHY |
| MomtestAI-Monthly-5USD | $5.00/ay | %50, %80, %100 | tunakomurcu@gmail.com | HEALTHY |

### Bilinen Kısıtlamalar

- Cost Explorer daily data 2026-08-24 itibarıyla henüz hazır değil; 24 saat sonra erişilebilir olacak.
- Promo kredi bakiyesi CLI ile sorgulanamıyor; konsol üzerinden manuel takip zorunlu.
- RDS hâlâ stopped durumda; AWS 7 gün sonra otomatik yeniden başlatabilir — haftalık kontrol gerekiyor.

## Step 11 — Elastic IP + HTTPS via Nginx + Let's Encrypt

### Elastic IP Tahsisi

Date: 2026-08-24

- Elastic IP: `3.73.201.29`
- Allocation ID: `eipalloc-007430fb454a9557d`
- Association ID: `eipassoc-034d26784d02253d3`
- Instance: `i-04033337a3ad94650` (t3.micro, eu-central-1)
- Önceki geçici public IP: `63.177.51.163` (artık geçersiz)

Maliyet notu: Elastic IP aktif instance'a bağlıyken ücretsizdir. Sadece instance'sız/boşta kalan Elastic IP ücretlendirilir (~$0.005/saat). Bu instance terminate edilmeden bu IP boşta kalmamalıdır; instance silinecekse önce Elastic IP release edilmelidir.

Status: Nginx + Certbot kurulumu bekliyor (DNS güncelleme onayı bekleniyor).

### Nginx Reverse Proxy + Let's Encrypt HTTPS — Verified

Date: 2026-08-24

#### Nginx Kurulumu

- Nginx 1.30.4 kuruldu (`sudo dnf install -y nginx`)
- Docker container port mapping değiştirildi: `0.0.0.0:80->3000` → `127.0.0.1:8080->3000`
  - Sebep: Nginx 80/443'ü dinleyeceği için Docker'ın 80'i kaplaması çakışma yaratır. Container'ı yalnızca loopback'e bağlamak dış erişimi tamamen Nginx üzerinden zorlar, 8080 portu SG'de kapalı olduğu için doğrudan erişilemez.
- Nginx config: `/etc/nginx/conf.d/momtest.conf`
  - `server_name momtest-demo.online www.momtest-demo.online`
  - `proxy_pass http://127.0.0.1:8080`
  - Proxy headers: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`
  - `/.well-known/acme-challenge/` → `/var/www/certbot` (certbot HTTP-01 challenge için)
- Nginx systemd: `enabled`, `active (running)`, boot'ta otomatik başlar

#### Certbot / Let's Encrypt

- Certbot 4.2.0 `pip3` ile kuruldu (Amazon Linux 2023 dnf reposunda `python3-certbot-nginx` paketi yok)
- Sertifika bilgileri:
  - Domain: `momtest-demo.online` + `www.momtest-demo.online`
  - Key Type: ECDSA
  - Serial: `501f4e799a0579f139e9edc246f378cea8c`
  - Geçerlilik: 2026-08-24 → **2026-11-22** (89 gün)
  - Tam yol: `/etc/letsencrypt/live/momtest-demo.online/fullchain.pem`
- Nginx config certbot tarafından otomatik güncellendi (HTTPS + HTTP→HTTPS 301 redirect)
- Dry-run: başarılı (`simulated renewal succeeded`)

#### Otomatik Renewal

- Mekanizma: systemd timer (crond Amazon Linux 2023'te yok)
- Service: `/etc/systemd/system/certbot-renew.service`
- Timer: `/etc/systemd/system/certbot-renew.timer`
  - Takvim: günde 2 kez, 00:00 ve 12:00 UTC (+ rastgele 0-12 saat delay)
  - Status: `active (waiting)`, `enabled`
  - İlk tetiklenme: 2026-08-25 09:10 UTC
  - Deploy hook: `systemctl reload nginx` (sertifika yenilenince Nginx otomatik reload)

#### Doğrulama Sonuçları

| Test | Sonuç |
|---|---|
| `https://momtest-demo.online/api/projects` | HTTP 200 OK, gerçek veri |
| `https://www.momtest-demo.online/api/projects` | HTTP 200 OK, gerçek veri |
| `http://momtest-demo.online/api/projects` | 301 → `https://momtest-demo.online/api/projects` |
| EC2 içi `curl http://127.0.0.1/api/projects` | HTTP 200 OK, Server: nginx/1.30.4 |
| Certbot dry-run | Başarılı |
| Sertifika geçerliliği | 89 gün kaldı (2026-11-22) |

#### Maliyet

- Nginx: ücretsiz
- Let's Encrypt sertifikası: ücretsiz
- Elastic IP (instance'a bağlı): ücretsiz
- Ek altyapı maliyeti: $0
- Domain ücreti: Namecheap'te `momtest-demo.online` satın alım maliyeti (tek seferlik/yıllık)

#### Bilinen Kısıtlamalar

- Certbot pip ile kuruldu; sistem dnf güncelleme döngüsünün dışında. Python 3.9 desteği bir sonraki certbot sürümünde düşecek — gerekirse `sudo pip3 install --upgrade certbot certbot-nginx` ile güncelle.
- EC2 instance terminate edilmeden Elastic IP `3.73.201.29` boşta bırakılmamalı (~$0.005/saat ücretlenir). Instance silinecekse önce `aws ec2 release-address --allocation-id eipalloc-007430fb454a9557d` çalıştır.
- Sertifika 90 günde bir yenilenir. Renewal başarısız olursa Let's Encrypt `tunakomurcu@gmail.com` adresine uyarı emaili gönderir (30, 20, 10 gün kala).
