# AWS RDS Cutover Handoff Task

Continue from the existing deployment. Do not restart the architecture or recreate already verified resources.

## Current State

- AWS account: `820140266422`
- Region: `eu-central-1`
- EC2: `i-04033337a3ad94650`
- EC2 public IP: `18.184.5.221`
- EC2 security group: `sg-00e85fb37eaf3bd8e`
- RDS instance: `momtest-ai-db`
- RDS endpoint: `momtest-ai-db.cp40smi6qgtw.eu-central-1.rds.amazonaws.com`
- RDS security group: `sg-04c5c42b3d51b36ab`
- RDS is private, encrypted, PostgreSQL 16.13, `db.t3.micro`, Multi-AZ disabled
- RDS ingress is TCP 5432 from EC2 security group `sg-00e85fb37eaf3bd8e` only
- RDS database: `momtest`
- RDS schema verified: `projects`, `interviews`, `messages`; `interviews.injection_count` exists
- RDS restored data verified: `projects=1`, `interviews=0`, `messages=2`
- Original backup remains at `/home/ec2-user/momtest-before-rds.sql`
- Data-only backup remains at `/home/ec2-user/momtest-before-rds-data.sql`
- Old rollback DB container `momtest-db` is still running. Do not stop or delete it until final cutover succeeds.
- Secrets Manager names: `momtest-ai/DATABASE_URL` and `momtest-ai/OPENAI_API_KEY`
- `DATABASE_URL` now points to the RDS endpoint and includes `sslmode=require`; never print its value.
- Code fix commit: `57d4f98`, `lib/db/index.ts` explicitly uses `{ ssl: { rejectUnauthorized: false } }` when the URL contains `.rds.amazonaws.com`.
- Latest app image attempt: `momtest-ai:rds-tls-fixed`; `/api/projects` still returned HTTP 500.

## Important History

The EC2 checkout initially failed because `/opt/momtest-ai/aws/start-momtest-runtime.sh` had local uncommitted changes. The EC2 remote ref was later verified, but the complete working-tree `HEAD` and image source must always be checked explicitly. This was a repository consistency issue, not an RDS data issue.

The first RDS app failure was:

```text
no pg_hba.conf entry for host "172.31.43.93", user "momtest", database "momtest", no encryption
```

The direct `psql` client succeeded after adding `sslmode=require`, but the Node app still returned 500. The latest app log has not yet been supplied. Do not guess the remaining cause.

## Required Next Actions

Run these on the EC2 SSM terminal. Do not paste prompts such as `sh-5.2$` or `[root@...]` into commands.

### 1. Capture the actual latest app error

```bash
curl -sS -o /tmp/projects-response.json -w 'HTTP_STATUS=%{http_code}\n' http://127.0.0.1/api/projects
cat /tmp/projects-response.json
sudo docker logs --since 5m momtest-app
sudo docker inspect momtest-app --format 'STATUS={{.State.Status}} HEALTH={{.State.Health.Status}} RESTARTS={{.RestartCount}}'
```

Do not proceed based only on the generic JSON error. The `cause` section in the app log controls the next diagnosis.

### 2. Verify source and rebuilt image

```bash
cd /opt/momtest-ai
sudo git rev-parse --short HEAD
sudo grep -n 'usesRds\|rejectUnauthorized' lib/db/index.ts
sudo docker rm -f momtest-app 2>/dev/null || true
sudo docker build --no-cache -t momtest-ai:rds-tls-fixed .
```

The source must contain both `usesRds` and `rejectUnauthorized` before treating the image as the TLS-fixed image. If it does not, synchronize the complete working tree to the code commit rather than restoring only one file.

### 3. Refresh runtime env and restart app

```bash
sudo /opt/momtest-ai/aws/start-momtest-runtime.sh live

sudo docker run -d \
  --name momtest-app \
  --network app-net \
  --network-alias app \
  --restart unless-stopped \
  --env-file /run/momtest-ai/app.env \
  -p 80:3000 \
  momtest-ai:rds-tls-fixed
```

Never print `/run/momtest-ai/app.env`.

### 4. Prove RDS-backed app behavior

```bash
sleep 5
curl -i http://127.0.0.1/api/projects
```

Expected:

```text
HTTP/1.1 200 OK
```

The response must include the restored project, not merely an empty `data` array. Separately verify the RDS count without printing credentials:

```bash
sudo docker run --rm \
  --network app-net \
  --env-file /run/momtest-ai/app.env \
  postgres:16-alpine \
  sh -c 'psql "$DATABASE_URL" -Atc "select count(*) from projects;"'
```

Expected:

```text
1
```

Then test externally from the operator workstation:

```text
http://18.184.5.221/api/projects
```

The app logs must show no `no encryption`, `password authentication`, or `relation does not exist` error. To document the target safely, print only the parsed hostname from the secret, never the URL:

```bash
current_url="$(aws secretsmanager get-secret-value --region eu-central-1 --secret-id momtest-ai/DATABASE_URL --query SecretString --output text)"
CURRENT_URL="$current_url" python3 -c 'import os; from urllib.parse import urlsplit; print("DATABASE_HOST=" + (urlsplit(os.environ["CURRENT_URL"]).hostname or ""))'
```

Expected:

```text
DATABASE_HOST=momtest-ai-db.cp40smi6qgtw.eu-central-1.rds.amazonaws.com
```

### 5. Finalize only after all tests pass

Only after EC2-local and external `/api/projects` return HTTP 200 and the restored project is visible:

```bash
sudo docker stop momtest-db
sudo docker ps -a --filter name=momtest-db
sudo docker volume inspect momtest-postgres-data
```

Do not run `docker rm` for `momtest-db`. Keep the original backup files.

Remove the temporary IAM cutover permissions from the AWS admin workstation, not from an unprivileged EC2 session:

```powershell
aws iam delete-role-policy --role-name MomtestAiEc2Role --policy-name MomtestAiRdsCutoverTemporary
aws iam delete-role-policy --role-name MomtestAiEc2Role --policy-name MomtestAiRdsPasswordResetTemporary
```

Verify that only the intended runtime policies remain attached. Do not remove `CloudWatchAgentServerPolicy`, `AmazonSSMManagedInstanceCore`, or `MomtestAiSecretsReadOnly`.

## Status Documentation Requirements

Update `AWS_STATUS.md` locally only. Do not commit or push small status-only changes.

Add a new section titled exactly:

```text
RDS Cutover Verified
```

Record:

- date
- code/image commit actually used
- RDS endpoint hostname only, never credentials
- schema verification
- restored row counts
- EC2-local HTTP result
- external HTTP result
- confirmation that `momtest-db` was stopped but not deleted
- temporary IAM policy cleanup
- known limitation: RDS backup retention is `0` because of Free Tier; enable retention before real user data accumulates or after Free Tier ends

Do not mark the cutover verified if any app log still shows a connection error or if only the direct `psql` test succeeds.