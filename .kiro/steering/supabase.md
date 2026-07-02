---
inclusion: fileMatch
fileMatchPattern: ['**/*.ts', '**/*.tsx']
---

# Database Usage Standards

## Client Instantiation

Always use the Drizzle client exported from `lib/db/index.ts`. Never instantiate a database connection inline.

```typescript
import { db } from '@/lib/db/index'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
```

Never call `new Pool(...)` or `drizzle(...)` directly in route handlers or components.

## Querying

Use Drizzle's query builder for all database access. Wrap every query in `try/catch`.

```typescript
try {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  const project = rows[0]
  if (!project) {
    return NextResponse.json({ data: null, error: 'Proje bulunamadı.' }, { status: 404 })
  }
  return project
} catch (err) {
  console.error('[Route] DB query failed:', err)
  throw err
}
```

Rules:
- Log format: `[Route] <context> failed: ${err}`
- Never use a result before checking that the array is non-empty
- Never silently swallow errors — always log before re-throwing

## Authentication

Authentication has been removed. There are no session checks, no `auth.getUser()` calls, and no ownership filters in queries. Do not add auth guards to route handlers without a corresponding schema change (`user_id` column + RLS or equivalent).

## Type Safety

- Database row types are derived via Drizzle `InferSelectModel` and live in `types/database.types.ts`
- JSONB columns (`research_brief`, `interview_script`, `signal_score`) are typed as `unknown` — narrow them with type guards before use
- Application-level types (API responses, AI prompt mappings) go in `types/index.ts` or a co-located `types.ts`
- `any` is forbidden — all query results must be explicitly typed
