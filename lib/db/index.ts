import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL ortam değişkeni tanımlı değil.')
}

const usesRds = process.env.DATABASE_URL.includes('.rds.amazonaws.com')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ...(usesRds ? { 
    ssl: {
      rejectUnauthorized: false,
      // Force SSL connection for RDS
      mode: 'require'
    }
  } : {}),
})

export const db = drizzle(pool, { schema })
