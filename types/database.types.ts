/**
 * Supabase veritabanı için otomatik üretilmiş tip tanımlamaları.
 * Bu dosya schema.sql yapısını yansıtır.
 * Gerçek projede: `npx supabase gen types typescript --local > types/database.types.ts`
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      projects: {
        Row: {
          id: string
          user_id: string
          product_idea: string
          research_brief: Json | null
          interview_script: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          product_idea: string
          research_brief?: Json | null
          interview_script?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          product_idea?: string
          research_brief?: Json | null
          interview_script?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      interviews: {
        Row: {
          id: string
          project_id: string
          participant_name: string
          participant_role: string | null
          status: 'pending' | 'ongoing' | 'completed'
          transcript: Json | null
          signal_score: Json | null
          evidence_report: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          participant_name: string
          participant_role?: string | null
          status?: 'pending' | 'ongoing' | 'completed'
          transcript?: Json | null
          signal_score?: Json | null
          evidence_report?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          participant_name?: string
          participant_role?: string | null
          status?: 'pending' | 'ongoing' | 'completed'
          transcript?: Json | null
          signal_score?: Json | null
          evidence_report?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          interview_id: string
          sender: 'agent' | 'participant'
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          interview_id: string
          sender: 'agent' | 'participant'
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          interview_id?: string
          sender?: 'agent' | 'participant'
          content?: string
          created_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

// Kısayol tipleri — yaygın kullanım için
export type Profile  = Database['public']['Tables']['profiles']['Row']
export type Project  = Database['public']['Tables']['projects']['Row']
export type Interview = Database['public']['Tables']['interviews']['Row']
export type Message  = Database['public']['Tables']['messages']['Row']

export type ProjectInsert  = Database['public']['Tables']['projects']['Insert']
export type InterviewInsert = Database['public']['Tables']['interviews']['Insert']
export type MessageInsert  = Database['public']['Tables']['messages']['Insert']
