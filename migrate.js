// migrate.js — sadece `pg` ile SQL migration runner
// Next.js standalone içinde pg paketi mevcuttur.
// drizzle-orm'e bağımlılık yok.

const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL tanımlı değil.')
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  console.log('[migrate] Veritabanına bağlanıldı.')

  // __drizzle_migrations tablosunu oluştur (yoksa)
  await client.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `)

  const migrationsDir = path.join(__dirname, 'drizzle', 'migrations')
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of sqlFiles) {
    const hash = file.replace('.sql', '')
    const existing = await client.query(
      'SELECT id FROM __drizzle_migrations WHERE hash = $1',
      [hash]
    )
    if (existing.rows.length > 0) {
      console.log(`[migrate] Atlandı (zaten uygulanmış): ${file}`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    // Drizzle'ın --> statement-breakpoint marker'larını handle et
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    console.log(`[migrate] Uygulanıyor: ${file} (${statements.length} statement)`)
    for (const stmt of statements) {
      await client.query(stmt)
    }

    await client.query(
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [hash, Date.now()]
    )
    console.log(`[migrate] Tamamlandı: ${file}`)
  }

  await client.end()
  console.log('[migrate] Tüm migrasyonlar tamamlandı.')
}

main().catch((err) => {
  console.error('[migrate] Hata:', err)
  process.exit(1)
})
