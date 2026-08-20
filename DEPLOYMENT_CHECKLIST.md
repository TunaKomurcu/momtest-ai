# AWS-first deployment checklist for MomTest AI

This project is intentionally prepared for a low-risk first deploy:
- LLM calls are disabled by default when APP_LLM_MODE=mock
- Docker Compose uses the mock mode by default for first deployment
- real secrets are never hardcoded into the repo

## Required environment variables

APP_LLM_MODE=mock
DATABASE_URL=postgresql://momtest:momtest@db:5432/momtest
OPENAI_API_KEY=
NVCF_API_KEY=
MAKE_WEBHOOK_INTERVIEW_URL=
MAKE_WEBHOOK_ANALYSIS_URL=
NODE_ENV=production

## First deploy mode

Use mock mode until the app is confirmed healthy in AWS.

## Later production mode

Set:
- APP_LLM_MODE=live
- OPENAI_API_KEY from AWS Secrets Manager or SSM
- DATABASE_URL to an AWS-hosted Postgres endpoint

## Security rules

- do not commit a real API key
- do not store secrets in Dockerfiles
- prefer AWS Secrets Manager / Systems Manager Parameter Store for production secrets
- keep a small budget alert in place before enabling live LLM calls
