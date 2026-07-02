/**
 * Drizzle ORM şemasından türetilen veritabanı tip tanımlamaları.
 * InferSelectModel / InferInsertModel kullanılır.
 */

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { projects, interviews, messages } from '@/lib/db/schema'

// ---------------------------------------------------------------------------
// Select (Row) tipleri
// ---------------------------------------------------------------------------

export type Project  = InferSelectModel<typeof projects>
export type Interview = InferSelectModel<typeof interviews>
export type Message  = InferSelectModel<typeof messages>

// ---------------------------------------------------------------------------
// Insert tipleri
// ---------------------------------------------------------------------------

export type ProjectInsert  = InferInsertModel<typeof projects>
export type InterviewInsert = InferInsertModel<typeof interviews>
export type MessageInsert  = InferInsertModel<typeof messages>

// ---------------------------------------------------------------------------
// Json yardımcı tip (JSONB alanları için)
// ---------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]
