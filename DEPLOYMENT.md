# Deployment Guide — MomTest AI

## Stack

```
Browser → Nginx (reverse proxy)
            ↓
         Next.js 16 (App Router, port 8080)
            ├── PostgreSQL 16 (Docker container, app-net)
            ├── OpenAI API (via AWS Secrets Manager)
            └── Make.com Webhooks (fire-and-forget)
```

## Production Environment

| Resource | Value |
|----------|-------|
| EC2 | `i-04033337a3ad94650`, t3.micro, eu-central-1 |
| Public IP | `3.73.201.29` (Elastic IP) |
| Domain | `https://momtest-demo.online` |
| OS | Amazon Linux 2023 |
| Container runtime | Docker 25.x |
| Reverse proxy | Nginx 1.30.4 |
| SSL | Let's Encrypt (certbot, auto-renew via systemd timer) |

---

## Local Development

### Database only (recommended)

```bash
docker compose up db -d
```

Create `.env.local`:
```
DATABASE_URL=postgresql://momtest:momtest@localhost:5432/momtest
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o
OPENAI_FAST_MODEL=gpt-4o-mini
MAKE_WEBHOOK_INTERVIEW_URL=
MAKE_WEBHOOK_ANALYSIS_URL=
```

```bash
npx drizzle-kit push
npm run dev
```

App runs at `http://localhost:3000`.

---

## EC2 Production Deployment

Secrets are stored in AWS Secrets Manager and loaded at runtime — never committed to the repository.

### Runtime startup

```bash
# Load secrets and start containers
sudo /opt/momtest-ai/aws/start-momtest-runtime.sh live

sudo docker run -d \
  --name momtest-app \
  --network app-net \
  --env-file /run/momtest-ai/app.env \
  -p 127.0.0.1:8080:3000 \
  --restart unless-stopped \
  momtest-ai:latest
```

### Deploy updates

```bash
cd /opt/momtest-ai
sudo git pull origin feature/aws-deployment
sudo docker build -t momtest-ai:latest .
sudo docker stop momtest-app && sudo docker rm momtest-app
sudo /opt/momtest-ai/aws/start-momtest-runtime.sh live
sudo docker run -d \
  --name momtest-app \
  --network app-net \
  --env-file /run/momtest-ai/app.env \
  -p 127.0.0.1:8080:3000 \
  --restart unless-stopped \
  momtest-ai:latest
sudo docker image prune -f
```

### Health check

```bash
curl -i https://momtest-demo.online/api/projects
# Expected: HTTP 200, {"data":[...],"error":null}
```

### Backups

Daily automated PostgreSQL backups to S3 replace the need for RDS-managed backups.

| Resource | Value |
|----------|-------|
| S3 bucket | `momtest-ai-storage-820140266422` (eu-central-1, private, SSE-S3, all public access blocked) |
| Backup prefix | `backups/database/` |
| Retention | 14 days, via S3 Lifecycle Rule (`aws/s3-lifecycle-momtest-ai-storage.json`) — not script-side deletion |
| Script | `aws/backup-db-to-s3.sh` |
| Schedule | `momtest-backup.timer` (systemd), daily `03:00 UTC` — equivalent crontab: `0 3 * * *` |
| IAM policy | `MomtestAiS3BackupAccess`, attached to `MomtestAiEc2Role` (`aws/momtest-ai-s3-backup-policy.json`) |

This host (Amazon Linux 2023) has no `cron`/`crond` installed by default — the backup uses a systemd timer, the same pattern already used for `certbot-renew.timer`.

The script fetches `momtest-ai/DATABASE_URL` from Secrets Manager (the container requires password auth, not trust auth), pipes it into `docker exec momtest-db pg_dump --clean --if-exists` over stdin (never as a CLI argument, to avoid it appearing in `ps aux`), gzips the result, uploads to S3, verifies via `head-object`, and only then deletes the local temp file. Exit codes: `0` success, `1` env/dependency error, `2` dump failed, `4` upload failed, `5` verification failed.

Setup on the EC2 host:
```bash
chmod +x /opt/momtest-ai/aws/backup-db-to-s3.sh   # git doesn't track the executable bit on this repo
sudo cp aws/momtest-backup.service /etc/systemd/system/momtest-backup.service
sudo cp aws/momtest-backup.timer /etc/systemd/system/momtest-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now momtest-backup.timer
```

Verify:
```bash
sudo systemctl list-timers momtest-backup.timer
sudo systemctl start momtest-backup.service   # manual trigger, don't wait for 03:00
sudo journalctl -u momtest-backup.service --since today
tail -n 50 /var/log/momtest-backup.log
aws s3 ls s3://momtest-ai-storage-820140266422/backups/database/ --region eu-central-1
```

**Disaster recovery — restore the latest backup:**
```bash
LATEST_KEY=$(aws s3api list-objects-v2 \
  --bucket momtest-ai-storage-820140266422 --prefix backups/database/ \
  --query 'sort_by(Contents,&LastModified)[-1].Key' --output text --region eu-central-1)

aws s3 cp "s3://momtest-ai-storage-820140266422/${LATEST_KEY}" - --region eu-central-1 \
  | gunzip \
  | docker exec -i momtest-db psql -U momtest momtest
```
The dump uses `--clean --if-exists`, so it's safe to pipe directly into a live database — but this still overwrites current data. Treat it as a deliberate manual action: stop the `momtest-app` container first so nothing writes to the database mid-restore.

### Monitoring

CloudWatch Agent tracks memory, swap, and disk usage (none covered by default EC2 metrics) and alerts via SNS when any exceeds 85% (80% for disk) for 2 consecutive 5-minute periods.

| Resource | Value |
|----------|-------|
| Metrics namespace | `MomtestAI/EC2` |
| Metrics collected | `mem_used_percent`, `swap_used_percent`, `disk_used_percent` on `/` (60s interval) |
| Config | `aws/amazon-cloudwatch-agent.json` → deployed to `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json` |
| Swapfile | 1 GB, `/swapfile`, persisted in `/etc/fstab` (t3.micro has 1 GB RAM and no swap by default) |
| Root volume | 30 GB gp3 (see `AWS_STATUS.md`) |
| SNS topic | `momtest-ai-alerts` (eu-central-1) — email subscription requires a one-time confirmation click |
| Alarms | `MomtestAI-EC2-HighMemoryUsage`, `MomtestAI-EC2-HighSwapUsage` (85%, 2×5min), `MomtestAI-EC2-HighDiskUsage` (80%, 2×5min) |

Install and start the agent:
```bash
sudo dnf install -y amazon-cloudwatch-agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
sudo systemctl status amazon-cloudwatch-agent
```

`CloudWatchAgentServerPolicy` was already attached to `MomtestAiEc2Role` at initial provisioning — no new IAM policy is needed for the agent itself.

Verify metrics are flowing:
```bash
aws cloudwatch get-metric-statistics \
  --namespace "MomtestAI/EC2" --metric-name mem_used_percent \
  --dimensions Name=InstanceId,Value=i-04033337a3ad94650 \
  --start-time "$(date -u -d '-30 minutes' '+%Y-%m-%dT%H:%M:%S')" \
  --end-time "$(date -u '+%Y-%m-%dT%H:%M:%S')" \
  --period 60 --statistics Average --region eu-central-1
```

**Disk alarm — dimensions matter.** `drop_device: true` in the agent config drops the `device` dimension, but `path` (and usually `fstype`) are still published. Before creating the alarm, confirm the exact dimension set for this AMI:
```bash
aws cloudwatch list-metrics --namespace "MomtestAI/EC2" --metric-name disk_used_percent --region eu-central-1
```
Amazon Linux 2023's default root filesystem is XFS, so this is expected to be `InstanceId` + `path=/` + `fstype=xfs` — adjust if `list-metrics` shows otherwise:
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "MomtestAI-EC2-HighDiskUsage" \
  --alarm-description "momtest-demo EC2 root volume usage above 80% for 10 minutes" \
  --namespace "MomtestAI/EC2" --metric-name disk_used_percent \
  --dimensions Name=InstanceId,Value=i-04033337a3ad94650 Name=path,Value=/ Name=fstype,Value=xfs \
  --statistic Average --period 300 --evaluation-periods 2 --threshold 80 \
  --comparison-operator GreaterThanThreshold --treat-missing-data missing \
  --alarm-actions arn:aws:sns:eu-central-1:820140266422:momtest-ai-alerts \
  --ok-actions arn:aws:sns:eu-central-1:820140266422:momtest-ai-alerts \
  --region eu-central-1
```

### Billing Alerts

`EstimatedCharges` is only published in **us-east-1**, regardless of where your resources run, and requires a one-time manual step: **Billing preferences → check "Receive Billing Alerts" → Save** in the console (there is no CLI/API for this toggle). CloudWatch alarm actions must reference an SNS topic in the *same* region as the alarm, so this needs its own us-east-1 topic — the existing `momtest-ai-alerts` topic (eu-central-1) can't be reused here.

```bash
# One-time: enable "Receive Billing Alerts" in the console first (see above), then:

aws sns create-topic --name momtest-ai-billing-alerts --region us-east-1
# record TopicArn, e.g. arn:aws:sns:us-east-1:820140266422:momtest-ai-billing-alerts

aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:820140266422:momtest-ai-billing-alerts \
  --protocol email --notification-endpoint tunakomurcu@gmail.com \
  --region us-east-1
# Requires clicking the confirmation link AWS emails, same as the other topic.

aws cloudwatch put-metric-alarm \
  --alarm-name "MomtestAI-Billing-MonthlyCharges" \
  --alarm-description "Estimated AWS charges above \$2.00 this billing cycle" \
  --namespace "AWS/Billing" --metric-name EstimatedCharges \
  --dimensions Name=Currency,Value=USD \
  --statistic Maximum --period 21600 --evaluation-periods 1 --threshold 2 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:820140266422:momtest-ai-billing-alerts \
  --region us-east-1
```
`EstimatedCharges` only updates ~every 6 hours, hence `--period 21600` (6h) with a single evaluation period — a shorter period would just re-check stale data. This is a stricter, earlier tripwire than the existing `MomtestAI-Monthly-5USD` Budget (which alerts at 50/80/100% of $5, i.e. $2.50 earliest) — the two are complementary, not redundant.

---

### Object Storage (S3)

Interview audio/transcript uploads and generated report exports both live in the same backup bucket, under dedicated prefixes:

```
momtest-ai-storage-820140266422/
  backups/database/    daily pg_dump backups (see Backups above) — 14-day expiry
  uploads/audio/        client-uploaded interview audio/transcripts (temp staging) — 48h expiry
  exports/reports/      generated analysis report exports — transitions to Glacier after 90 days
```

Lifecycle rules live in `aws/s3-lifecycle-momtest-ai-storage.json` (apply the same way as before, via `put-bucket-lifecycle-configuration`). S3 lifecycle rules run in daily batches, not in real time — "48h expiry" means up to ~1 extra day of variance in practice, not an exact-to-the-hour deletion. A bucket-wide rule also aborts incomplete multipart uploads after 7 days, so an interrupted client upload doesn't quietly accumulate storage cost.

CORS (`aws/s3-cors.json`) allows the browser to `PUT`/`GET` directly against pre-signed URLs from the production domain and local dev:
```bash
aws s3api put-bucket-cors \
  --bucket momtest-ai-storage-820140266422 \
  --cors-configuration file://aws/s3-cors.json \
  --region eu-central-1
```

`lib/s3.ts` generates the pre-signed URLs (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`), using the default AWS credential provider chain — no access keys anywhere in the app. In production that means the SDK resolves credentials via the EC2 instance role over IMDS **from inside the `momtest-app` container**, which is new: until now, only the host (`start-momtest-runtime.sh`) ever talked to AWS directly. The existing `MomtestAiS3BackupAccess` IAM policy already grants `PutObject`/`GetObject` on the whole bucket (it was never prefix-restricted to backups), so no new IAM policy is needed — but IMDS reachability from the container has not been exercised before and should be verified once after deploying:
```bash
sudo docker exec momtest-app node -e "
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ region: 'eu-central-1' });
s3.send(new HeadBucketCommand({ Bucket: 'momtest-ai-storage-820140266422' }))
  .then(() => console.log('OK: IMDS credentials + S3 access working'))
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
"
```
This exercises both credential resolution *and* the IAM policy in one call — `HeadBucket` needs `s3:ListBucket`, which the policy already grants.
If this fails, the container's network path to `169.254.169.254` is blocked — on this default bridge-network setup (`--network app-net`) it should work out of the box, since Docker's default NAT rules don't block link-local IMDS traffic, but confirm rather than assume in production.

Usage from a route handler:
```ts
import { getAudioUploadUrl, getReportDownloadUrl } from '@/lib/s3'

const uploadUrl = await getAudioUploadUrl(`${interviewId}.webm`, 'audio/webm')
const downloadUrl = await getReportDownloadUrl(`${projectId}/summary.pdf`)
```

Both AWS SDK packages were added to `package.json` and `package-lock.json` was regenerated (`npm install`) in this change — no further `npm install` needed before the next `docker build`.

---

### Docker Disk Protection

Two independent protections against the 30 GB root volume filling up from container operation (separate from the CloudWatch disk alarm above, which only alerts after the fact):

**1. Bounded container logs.** `docker logs` on a long-running container with no log rotation is the single most common cause of silent disk starvation. `aws/docker-daemon.json` caps every container to 3 rotated 10 MB log files (30 MB max per container):
```bash
sudo cp aws/docker-daemon.json /etc/docker/daemon.json
sudo systemctl restart docker
```
Restarting the Docker daemon stops and restarts all containers — both `momtest-app` and `momtest-db` use `--restart unless-stopped`, so they come back automatically, but expect a few seconds of downtime. Do this during low-traffic time. This only bounds *future* log growth; if a container's log is already large, check with `docker inspect --format='{{.LogPath}}' momtest-app | xargs sudo du -h` and truncate manually (`sudo truncate -s 0 <path>`) if needed.

**2. Weekly automated cleanup.** `aws/cleanup-docker.sh` prunes stopped containers, unused images, and build cache older than 7 days — never volumes, so `momtest-postgres-data` is untouched by any command in this script:
```bash
chmod +x /opt/momtest-ai/aws/cleanup-docker.sh
sudo cp aws/momtest-docker-cleanup.service /etc/systemd/system/momtest-docker-cleanup.service
sudo cp aws/momtest-docker-cleanup.timer /etc/systemd/system/momtest-docker-cleanup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now momtest-docker-cleanup.timer
```
Verify: `sudo systemctl list-timers momtest-docker-cleanup.timer`, `tail /var/log/momtest-docker-cleanup.log`.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `OPENAI_MODEL` | ❌ | Primary conversational model (default: `gpt-4o`, see `lib/llm/config.ts`) |
| `OPENAI_FAST_MODEL` | ❌ | Guard/classifier model (default: `gpt-4o-mini`) |
| `MAKE_WEBHOOK_INTERVIEW_URL` | ❌ | Make.com webhook — interview completed event |
| `MAKE_WEBHOOK_ANALYSIS_URL` | ❌ | Make.com webhook — analysis completed event |
| `AWS_REGION` | ❌ | Region for `lib/s3.ts` (default: `eu-central-1`) |
| `S3_BUCKET_NAME` | ❌ | Bucket for `lib/s3.ts` (default: `momtest-ai-storage-820140266422`) |

To change the model, set `OPENAI_MODEL` — no code change or rebuild required. To point at a different OpenAI-compatible provider, update `base_url` in `mom-test-customer-discovery/agents/openai.yaml`.

---

## Architecture Decisions

### Multi-stage Dockerfile

Three-stage build (`deps → builder → runner`) keeps only compiled output and runtime dependencies in the shipped image (~200 MB vs ~900 MB single-stage).

### `output: "standalone"` in next.config.ts

Next.js standalone mode traces the actual `require()` graph at build time and copies only the needed modules into `.next/standalone/`. Required for the runner stage.

### Nginx as reverse proxy

Docker container binds to `127.0.0.1:8080` only (not publicly accessible). Nginx handles 80/443, terminates TLS, and proxies to port 8080. This keeps the container off the public interface and centralises SSL renewal.

### Secrets Manager over .env files

Runtime secrets (`OPENAI_API_KEY`, `DATABASE_URL`) live in AWS Secrets Manager. `aws/start-momtest-runtime.sh` fetches them at container startup and writes an ephemeral `/run/momtest-ai/app.env` (permissions 600, never committed).

### PostgreSQL in Docker over RDS

RDS costs ~$15-25/month and exceeds the current budget. PostgreSQL runs in a Docker container on the same EC2 instance with a named volume for persistence. Migrating to RDS later requires only updating the `DATABASE_URL` secret — no code changes.

### S3 + systemd timer over Lambda/RDS-automated-backups

Without RDS there's no built-in automated snapshot feature to rely on. Rather than add Lambda/SQS to orchestrate backups, a plain bash script (`aws/backup-db-to-s3.sh`) runs on the EC2 host itself via a systemd timer and uploads straight to S3. Retention is handled by an S3 Lifecycle Rule rather than script logic, so a bug or a skipped run can't leave old backups un-pruned or delete backups it shouldn't.

### Pre-signed URLs over routing uploads/downloads through the app

`lib/s3.ts` has the client `PUT`/`GET` directly against S3 using short-lived pre-signed URLs, rather than proxying audio uploads or report downloads through the Next.js server. On a t3.micro with 1 GB RAM, streaming large files through the app process is exactly the kind of load the memory/swap alarms above exist to catch — pre-signing avoids it entirely, and needs no AWS credentials in the app beyond the EC2 instance role it already runs under.

---

## Troubleshooting

**`next build` fails with "DATABASE_URL is not defined"**
The Dockerfile injects a dummy `DATABASE_URL` at build time. Export it first if building locally: `export DATABASE_URL=postgresql://build:build@localhost:5432/build`.

**App returns HTTP 500 after restart**
Check that the runtime env was refreshed before starting the container:
```bash
sudo /opt/momtest-ai/aws/start-momtest-runtime.sh live
sudo docker logs momtest-app --tail 50
```

**SSL certificate expired**
Verify the renewal timer is active:
```bash
sudo systemctl status certbot-renew.timer
sudo /usr/local/bin/certbot renew --dry-run
```
