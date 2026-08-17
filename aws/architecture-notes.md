# AWS Architecture — MomTest AI

## Deployment model: EC2 + Docker Compose

The application runs as a Docker Compose stack on a single EC2 t2.micro instance (Free Tier eligible). This keeps the architecture simple and observable while remaining consistent with the local development environment.

### Instance selection

| Instance | vCPU | RAM | Free Tier |
|----------|------|-----|-----------|
| t2.micro | 1 | 1 GB | ✅ Yes |
| t3.micro | 2 | 1 GB | ✅ Yes |
| t3.small | 2 | 2 GB | ❌ No |

t2.micro is sufficient for Next.js standalone + PostgreSQL. Add a 1 GB swap file as a buffer:
```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

AMI: **Amazon Linux 2023** (well-maintained, integrates cleanly with AWS tooling).

---

## S3

Not required for this project's current feature set. Applicable if:
- Static assets need CDN distribution
- User-generated uploads are added in the future
- Drizzle migration snapshots need off-instance backup

```bash
aws s3 mb s3://momtest-ai-assets --region eu-west-1
aws s3 sync public/ s3://momtest-ai-assets/public/
```

Free Tier: 5 GB storage, 20K GET requests, 2K PUT requests/month.

---

## Lambda — evaluation

Lambda is not suitable for this application. Three technical blockers:

**1. SSE streaming**
`/api/generate` streams tokens via Server-Sent Events. Lambda Response Streaming (2023) supports this in principle, but the integration with Next.js App Router requires a custom adapter and is not stable.

**2. Connection pool exhaustion**
`lib/db/index.ts` maintains a `max: 10` PostgreSQL connection pool. Lambda invocations are stateless and bypass the pool, opening a new connection on every request. This exhausts the database's connection limit under any non-trivial load. The fix (RDS Proxy) costs ~$18/month — outside Free Tier.

**3. Cold start latency**
LangGraph inference in `/api/analyze` and `/api/generate` takes 2-5 seconds. A Lambda cold start (~500 ms) adds to this on every inactive-period invocation.

Lambda would be appropriate for future async workloads — e.g. a background webhook processor or scheduled report delivery — where none of these constraints apply.

---

## Free Tier cost reference

| Service | Free allowance | Risk |
|---------|---------------|------|
| EC2 t2.micro | 750 hrs/month, first 12 months | Stops being free after 12 months |
| EBS gp2/gp3 | 30 GB | Exceeded if storage > 30 GB |
| S3 | 5 GB + 20K GET | Low risk for this project |
| Data transfer out | 1 GB/month | Low risk at current traffic |
| RDS | None (db.t2.micro is free tier eligible separately) | Not used — Docker Postgres instead |

**High-risk actions:** launching a second EC2 instance, enabling ALB (~$20/mo), using NAT Gateway (~$30/mo), or switching to RDS without checking instance class.

Set a billing alert: AWS Console → Billing → Budgets → Create budget → $5 threshold.
