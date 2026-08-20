# Next AWS Step Plan

This file is meant to hand off context to a new chat when continuing AWS work.

## 1) Current status

The project is locally validated in a Podman environment and is not yet deployed to AWS.

Validated locally:
- Podman installed and working
- app image built successfully
- custom Podman network created
- DB container started
- schema tables created
- app container started on same network
- health endpoint returned HTTP 200 OK

## 2) Important facts

- No AWS account actions were taken yet.
- No EC2 instance was created.
- No RDS, IAM, Security Group, or Secrets Manager setup was performed.
- The app is intentionally running in `APP_LLM_MODE=mock` for safe early validation.

## 3) Why we paused AWS

The goal was to keep the first deployment learning path low-risk and cost-free.

We intentionally deferred AWS Console work until:
- local runtime validation was proven
- network and DB issues were resolved
- the app’s API responded successfully locally

## 4) Last verified local setup

The last known working pattern was:

```powershell
podman network create app-net

podman run -d `
  --name db `
  --network app-net `
  -p 5432:5432 `
  -e POSTGRES_USER=momtest `
  -e POSTGRES_PASSWORD=momtest `
  -e POSTGRES_DB=momtest `
  -v momtest_pg:/var/lib/postgresql/data `
  postgres:16-alpine

podman build -t momtest-ai:mock -f Containerfile .

podman run -d `
  --name app `
  --network app-net `
  -p 3000:3000 `
  -e APP_LLM_MODE=mock `
  -e NODE_ENV=production `
  -e DATABASE_URL=postgresql://momtest:momtest@db:5432/momtest `
  localhost/momtest-ai:mock
```

Then the validation was:

```powershell
podman exec db psql -U momtest -d momtest -c "\dt"
curl.exe -sS -D - http://localhost:3000/api/projects -o NUL
```

Expected result:
- tables exist
- HTTP 200 OK

## 5) Next AWS step after access is available

1. Create EC2 instance
2. Install Podman on the host
3. Clone repo
4. Create app-net network
5. Start Postgres in Podman
6. Apply DB schema
7. Build image and start app
8. Validate /api/projects endpoint
9. Then consider real credentials and AWS-managed services

## 6) Hand-off note

The codebase itself is already in a good state for the next stage. The main pending work is not app logic but actual AWS environment provisioning and deployment execution.
