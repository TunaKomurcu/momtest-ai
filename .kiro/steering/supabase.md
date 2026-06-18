---
inclusion: fileMatch
fileMatchPattern: ['**/*.ts', '**/*.tsx']
---

# Supabase Usage Standards

## Client Instantiation

Always use the factory functions from `lib/supabase/`. Never instantiate clients inline.

| Context | Import path | Notes |
|---|---|---|
| Client Components | `@/lib/supabase/client` | Synchronous |
| Server Components, Route Handlers, Server Actions | `@/lib/supabase/server` | `async` — must be awaited |

```typescript
// Client Component
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()

// Server Component / Route Handler / Server Action
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()
```

Never call `new SupabaseClient(...)` or `createClient(url, key)` directly anywhere in the app.

## Error Handling

Every Supabase query must check the returned `error` object before using `data`. Wrap in `try/catch` at the call site.

```typescript
try {
  const { data, error } = await supabase.from('projects').select('*')
  if (error) {
    console.error(`[Supabase Error] Fetching projects failed: ${error.message} (${error.code})`)
    throw new Error(error.message)
  }
  return data
} catch (err) {
  throw err
}
```

Rules:
- Log format: `[Supabase Error] <context>: ${error.message} (${error.code})`
- Never use `data` when `error` is non-null
- Never silently swallow errors — always log before re-throwing

## Session & Auth

The server client in `lib/supabase/server.ts` manages session persistence via `getAll`/`setAll` on the Next.js `cookies()` store. Do not bypass, re-wrap, or reimplement this cookie handling.

## Type Safety

- Database types are auto-generated and live in `types/database.types.ts` — use them to type all query results
- Application-level types (API responses, AI prompt mappings) go in `types/index.ts` or a co-located `types.ts`
- `any` is forbidden — prefer explicit return types on all functions that call Supabase
