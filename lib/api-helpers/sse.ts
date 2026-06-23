/**
 * SSE (Server-Sent Events) helpers — generate route'unda kullanılır.
 * Next.js'e bağımlılığı yoktur, pure fonksiyonlardır.
 */

import type { GenerateStreamChunk } from '@/types/index'

/**
 * SSE formatında bir chunk encode eder.
 * Çıktı: `data: <JSON>\n\n`
 */
export function encodeChunk(chunk: GenerateStreamChunk): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)
}

/**
 * SSE chunk string'ini decode eder (test yardımcısı).
 * `data: {...}\n\n` formatından GenerateStreamChunk çıkarır.
 */
export function decodeChunk(raw: Uint8Array): GenerateStreamChunk | null {
  const text = new TextDecoder().decode(raw)
  const match = text.match(/^data: (.+)\n\n$/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as GenerateStreamChunk
  } catch {
    return null
  }
}
