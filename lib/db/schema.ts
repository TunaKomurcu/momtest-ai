import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export const projects = pgTable('projects', {
  id:              uuid('id').primaryKey().defaultRandom(),
  product_idea:    text('product_idea').notNull(),
  research_brief:  jsonb('research_brief'),
  interview_script: jsonb('interview_script'),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// interviews
// ---------------------------------------------------------------------------

export const interviews = pgTable('interviews', {
  id:               uuid('id').primaryKey().defaultRandom(),
  project_id:       uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  participant_name: text('participant_name').notNull(),
  participant_role: text('participant_role'),
  status:           text('status', { enum: ['pending', 'ongoing', 'completed'] })
    .notNull()
    .default('pending'),
  transcript:       jsonb('transcript'),
  signal_score:     jsonb('signal_score'),
  evidence_report:  text('evidence_report'),
  analysis_json:    jsonb('analysis_json'),
  analyzed_at:      timestamp('analyzed_at', { withTimezone: true }),
  created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

export const messages = pgTable('messages', {
  id:           uuid('id').primaryKey().defaultRandom(),
  interview_id: uuid('interview_id')
    .notNull(),
  // NOT: interview_id hem interviews.id hem de projects.id olabilir.
  // Intake mesajları projects.id ile, mülakat mesajları interviews.id ile kaydedilir.
  // FK constraint kasıtlı olarak kaldırılmıştır.
  sender:       text('sender', { enum: ['agent', 'participant'] }).notNull(),
  content:      text('content').notNull(),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
