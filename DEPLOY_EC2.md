# EC2 deployment notes for Podman

This document captures the EC2-side commands we will use later, without creating any AWS resources right now.

## 1) Install Podman on Amazon Linux 2023

```bash
sudo dnf update -y
sudo dnf install -y podman podman-docker
podman --version
```

Notes:
- `podman` is the native container runtime
- `podman-docker` provides a compatibility shim, but we still prefer native Podman commands
- we avoid Docker Compose and use `podman run` and `podman exec` directly

## 2) Clone the repository

```bash
mkdir -p /opt/momtest
cd /opt/momtest
git clone <your-repo-url> .
```

## 3) Create a local network

```bash
podman network create momtest-net
```

## 4) Run PostgreSQL in a Podman container

```bash
podman run -d \
  --name momtest-db \
  --network momtest-net \
  -e POSTGRES_USER=momtest \
  -e POSTGRES_PASSWORD=momtest \
  -e POSTGRES_DB=momtest \
  -v momtest_pg:/var/lib/postgresql/data \
  postgres:16-alpine
```

## 5) Build the app image locally on the EC2 host

```bash
podman build -t momtest-ai:mock -f Containerfile .
```

## 6) Run the app container

```bash
podman run -d \
  --name momtest-app \
  --network momtest-net \
  -p 3000:3000 \
  -e APP_LLM_MODE=mock \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://momtest:momtest@momtest-db:5432/momtest \
  momtest-ai:mock
```

## 7) Apply database schema

```bash
podman exec momtest-app npx drizzle-kit push
```

## 8) Health check

```bash
curl -f http://localhost:3000/api/projects
```

Expected behavior:
- app returns HTTP 200 or a JSON response
- no live LLM API call is made while `APP_LLM_MODE=mock`

## Differences from Docker

- Podman uses `podman build`, `podman run`, `podman exec`
- Podman can also use `podman-compose` or `podman play kube` if desired
- command structure is similar, but we intentionally avoid Docker-specific compose files in this path

## Later production switch

When real credentials are available:

```bash
podman run -d \
  --name momtest-app \
  --network momtest-net \
  -p 3000:3000 \
  -e APP_LLM_MODE=live \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://... \
  -e OPENAI_API_KEY=... \
  momtest-ai:mock
```

The app should be started with the real values from AWS Secrets Manager or SSM instead of a hardcoded key.
