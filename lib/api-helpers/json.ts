/**
 * LLM JSON output helpers — generate ve analyze route'larında ortak kullanılır.
 * Next.js'e bağımlılığı yoktur, pure fonksiyonlardır.
 */

/**
 * LLM çıktısını JSON'a parse eder.
 * Model bazen ```json ... ``` fence ekleyebilir — temizlenir.
 * Parse başarısız olursa null döner.
 */
export function parseJsonOutput<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}
