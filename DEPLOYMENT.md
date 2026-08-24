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
