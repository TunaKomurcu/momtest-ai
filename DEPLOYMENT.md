# Deployment Guide — MomTest AI

## Stack

```
Browser → Next.js 16 (App Router) → OpenAI API
                 │
                 ├── PostgreSQL 16 (Drizzle ORM)
                 └── Make.com Webhooks (fire-and-forget)

Environments:
  Local dev   →  npm run dev  +  docker compose up db
  Local full  →  docker compose --profile app up
  Kubernetes  →  minikube  +  kubectl apply -k k8s/
  Production  →  AWS EC2 t2.micro  +  Docker Compose
```

## Prerequisites

| Tool | Version | Required for |
|------|---------|-------------|
| Docker Desktop | ≥ 24.0 | All environments |
| Node.js | ≥ 20 LTS | Local dev |
| Minikube | ≥ 1.32 | Kubernetes |
| kubectl | ≥ 1.28 | Kubernetes |
| AWS CLI | ≥ 2.0 | AWS deployment |

---

## Local Development — Docker Compose

### Database only (recommended for active development)

```bash
docker compose up db -d
```

Create `.env.local`:
```
DATABASE_URL=postgresql://momtest:momtest@localhost:5432/momtest
OPENAI_API_KEY=sk-proj-...
NVCF_API_KEY=
MAKE_WEBHOOK_INTERVIEW_URL=
MAKE_WEBHOOK_ANALYSIS_URL=
```

```bash
npx drizzle-kit push
npm run dev
```

### Full Docker stack (integration testing)

```bash
export $(grep -v '^#' .env.local | xargs)
docker compose --profile app up --build -d
docker compose logs app -f
```

App runs at `http://localhost:3000`.

---

## Kubernetes — Minikube

### Install Minikube

**Windows:**
```powershell
winget install Kubernetes.minikube
winget install Kubernetes.kubectl
```

**macOS:**
```bash
brew install minikube kubectl
```

**Linux:**
```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube

curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl
```

### Start Minikube

```bash
minikube start --driver=docker --memory=2048 --cpus=2
minikube status
```

### Build image into Minikube

Minikube uses its own Docker daemon. Build directly into it:

```bash
# macOS/Linux
eval $(minikube docker-env)

# Windows PowerShell
& minikube -p minikube docker-env --shell powershell | Invoke-Expression

docker build -t momtest-app:latest .
```

### Create secrets

`k8s/secret.yaml` is git-ignored. Provision secrets via kubectl:

```bash
kubectl apply -f k8s/namespace.yaml

kubectl create secret generic momtest-secrets \
  --from-literal=OPENAI_API_KEY="sk-proj-..." \
  --from-literal=POSTGRES_PASSWORD="momtest" \
  --from-literal=NVCF_API_KEY="" \
  --from-literal=MAKE_WEBHOOK_INTERVIEW_URL="" \
  --from-literal=MAKE_WEBHOOK_ANALYSIS_URL="" \
  --namespace=momtest
```

### Deploy

```bash
kubectl apply -k k8s/
kubectl get all -n momtest -w
```

Expected state (after ~2-3 min):
```
pod/momtest-app-xxxx       1/1  Running
pod/momtest-postgres-xxxx  1/1  Running

service/momtest-app-service  NodePort   80:30080/TCP
service/momtest-postgres     ClusterIP  5432/TCP
```

### Run database migrations

```bash
POD=$(kubectl get pod -n momtest -l app=momtest-app -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n momtest $POD -- npx drizzle-kit push
```

### Access the app

```bash
minikube service momtest-app-service -n momtest
```

### Useful commands

```bash
# Stream logs
kubectl logs -n momtest -l app=momtest-app -f

# Shell into pod
kubectl exec -it -n momtest $POD -- sh

# Inspect probe status
kubectl describe pod -n momtest $POD

# Rollback
kubectl rollout undo deployment/momtest-app -n momtest

# Restart deployment
kubectl rollout restart deployment/momtest-app -n momtest

# Teardown
kubectl delete namespace momtest
```

---

## AWS — EC2 Production Deployment

### Instance setup (AWS Console)

| Field | Value |
|-------|-------|
| AMI | Amazon Linux 2023 (HVM) |
| Instance type | t2.micro (Free Tier) |
| Storage | 20 GB gp3 |
| User data | paste contents of `aws/ec2-user-data.sh` |

**Security Group inbound rules:**
```
SSH  (22)   → your IP only
HTTP (80)   → 0.0.0.0/0
TCP  (3000) → 0.0.0.0/0
```

### Connect and verify

```bash
chmod 400 momtest-key.pem
ssh -i momtest-key.pem ec2-user@EC2_PUBLIC_IP

sudo tail -f /var/log/cloud-init-output.log
```

### Set environment variables

```bash
sudo nano /opt/momtest/.env
```

```
OPENAI_API_KEY=sk-proj-...
NVCF_API_KEY=
MAKE_WEBHOOK_INTERVIEW_URL=
MAKE_WEBHOOK_ANALYSIS_URL=
```

### Start the application

```bash
cd /opt/momtest
export $(grep -v '^#' .env | xargs)
docker compose --profile app up --build -d
docker compose exec app npx drizzle-kit push
docker compose logs app -f
```

App runs at `http://EC2_PUBLIC_IP:3000`.

### Deploy updates

```bash
cd /opt/momtest
git pull
docker compose --profile app up --build -d
docker image prune -f
```

### Free Tier limits

| Service | Free allowance |
|---------|---------------|
| EC2 t2.micro | 750 hrs/month (first 12 months) |
| EBS | 30 GB |
| S3 | 5 GB + 20K GET requests |
| Data transfer out | 1 GB/month |

**Cost risks:** A second EC2 instance, RDS (~$15-25/mo), or ALB (~$20/mo) will exceed Free Tier immediately. Set a billing alert at $5 in AWS Budgets.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `OPENAI_API_KEY` | ✅ | LLM provider API key (OpenAI / Groq / Google) |
| `NVCF_API_KEY` | ❌ | NVIDIA NeMo bridge (leave empty if unused) |
| `MAKE_WEBHOOK_INTERVIEW_URL` | ❌ | Make.com webhook endpoint |
| `MAKE_WEBHOOK_ANALYSIS_URL` | ❌ | Make.com webhook endpoint |

To switch LLM providers, update `base_url` and `model.name` in `mom-test-customer-discovery/agents/openai.yaml`. No code changes required.

---

## Architecture Decisions

### Multi-stage Dockerfile

A single-stage build produces a ~900 MB image because TypeScript compiler, test framework, and all devDependencies end up in the final layer. The three-stage approach (`deps → builder → runner`) keeps only the compiled output and runtime dependencies in the shipped image, bringing it down to ~200 MB.

### `output: "standalone"` in next.config.ts

Next.js standalone mode traces the actual `require()` graph at build time and copies only the needed modules into `.next/standalone/`. This is a prerequisite for the runner stage — without it, the stage has nothing to copy.

### Liveness + Readiness + Startup probes

Three probes answer three distinct questions:

- **Startup** — did the process finish initialising? Prevents liveness from restarting a slow-booting container in an infinite loop.
- **Liveness** — is the process still healthy? Restarts the pod on failure (e.g. deadlock, unrecoverable error).
- **Readiness** — is the pod ready to receive traffic? Removes the pod from the Service endpoint list without restarting it (e.g. during a migration or warm-up).

`/api/projects` was chosen as the probe path because it executes a real database query, confirming both the app process and the DB connection are healthy.

### ConfigMap vs Secret

ConfigMap values are stored as plaintext in etcd and visible to anyone with `kubectl describe` access. Secrets are base64-encoded and can be encrypted at rest if etcd encryption is enabled. Rule applied here: non-sensitive config (ports, flags, DB host) → ConfigMap; credentials and API keys → Secret.

### EC2 + Docker Compose over RDS

RDS provides automated backups, patching, and high availability, but at ~$15-25/month it exceeds the Free Tier budget. Running PostgreSQL in a Docker container on the same EC2 instance keeps costs at zero while preserving the same `DATABASE_URL` interface — migrating to RDS later requires only an environment variable change.

### Lambda not used

Three blockers:
1. `/api/generate` uses SSE streaming; Next.js App Router + Lambda Response Streaming integration is fragile.
2. `lib/db/index.ts` manages a `max: 10` connection pool; Lambda's per-invocation model bypasses this, exhausting DB connections without RDS Proxy (~$18/mo).
3. LangGraph inference runs 2-5 seconds; adding Lambda cold start (~500 ms) degrades UX unnecessarily.

---

## Troubleshooting

**`next build` fails with "DATABASE_URL is not defined"**
The Dockerfile injects a dummy `DATABASE_URL` at build time. If you're building locally without Docker, export the variable first: `export DATABASE_URL=postgresql://build:build@localhost:5432/build`.

**Minikube pod stuck in `ImagePullBackOff`**
The image was not built inside Minikube's Docker daemon. Switch context and rebuild:
```bash
eval $(minikube docker-env)
docker build -t momtest-app:latest .
```

**Pod enters `CrashLoopBackOff`**
```bash
kubectl logs -n momtest $POD --previous
kubectl get secret momtest-secrets -n momtest -o yaml
```
Most common cause: `OPENAI_API_KEY` not set in the secret.

**EC2 app unreachable**
1. Verify Security Group allows TCP 3000 inbound.
2. `docker ps` — confirm containers are running.
3. `docker compose logs app` — check for startup errors.

**`drizzle-kit push` reports "relation already exists"**
Schema is already applied. Safe to ignore. To reset: `npx drizzle-kit drop` (destructive).
