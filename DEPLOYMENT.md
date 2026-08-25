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
| Reserved prefix | `reports/` — for future report exports, covered by the same IAM policy |
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

CloudWatch Agent tracks memory and swap usage (not covered by default EC2 metrics) and alerts via SNS when either exceeds 85% for 2 consecutive 5-minute periods.

| Resource | Value |
|----------|-------|
| Metrics namespace | `MomtestAI/EC2` |
| Metrics collected | `mem_used_percent`, `swap_used_percent` (60s interval) |
| Config | `aws/amazon-cloudwatch-agent.json` → deployed to `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json` |
| Swapfile | 1 GB, `/swapfile`, persisted in `/etc/fstab` (t3.micro has 1 GB RAM and no swap by default) |
| SNS topic | `momtest-ai-alerts` — email subscription requires a one-time confirmation click |
| Alarms | `MomtestAI-EC2-HighMemoryUsage`, `MomtestAI-EC2-HighSwapUsage` — threshold 85%, 2×5min periods |

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
