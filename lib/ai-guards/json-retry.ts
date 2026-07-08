import OpenAI from 'openai'
import type { ValidationResult } from '@/types/index'

// ---------------------------------------------------------------------------
// parseAndClean
// ---------------------------------------------------------------------------

/**
 * Ham LLM çıktısından ```json fences ve çevreleyen prose'u temizler,
 * ardından JSON.parse yapar. Başarısızsa null döner.
 *
 * Export edilmiştir — doğrudan test edilebilir.
 */
export function parseAndClean<T>(raw: string): T | null {
  const cleaned = raw
    // ```json ... ``` veya ``` ... ``` bloklarını içeriğiyle birlikte al
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    // Başındaki ve sonundaki boşlukları temizle
    .trim()

  // İlk { veya [ karakterinden itibaren JSON başlıyor olabilir —
  // LLM bazen "Sure! Here is the JSON:" gibi bir ön cümle ekler.
  const jsonStart = cleaned.search(/[{[]/)
  if (jsonStart === -1) return null

  const jsonSlice = cleaned.slice(jsonStart)

  try {
    return JSON.parse(jsonSlice) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// callWithJsonRetry
// ---------------------------------------------------------------------------

/**
 * LLM'i çağırır, çıktıyı JSON olarak parse eder ve validate eder.
 * Parse veya validation başarısız olursa hata mesajıyla retry yapar.
 * maxRetries tükenirse null döner — her adım console.warn ile loglanır.
 *
 * @param openai     - Mevcut OpenAI client instance
 * @param params     - Non-streaming chat completion parametreleri
 * @param validate   - Parse edilmiş objeyi doğrulayan fonksiyon
 * @param context    - Log prefix (örn. "[Generate/brief]")
 * @param maxRetries - Toplam retry sayısı (default: 2)
 */
export async function callWithJsonRetry<T>(
  openai: OpenAI,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  validate: (parsed: T) => ValidationResult<T>,
  context: string,
  maxRetries = 2
): Promise<T | null> {
  // Retry döngüsünde mesaj geçmişini biriktirmek için kopyasını al
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [...params.messages]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // --- LLM çağrısı ---
    let rawOutput: string
    try {
      const completion = await openai.chat.completions.create({
        ...params,
        messages,
        stream: false,
      })
      rawOutput = completion.choices[0]?.message?.content?.trim() ?? ''
    } catch (err) {
      console.warn(`${context} LLM çağrısı başarısız (attempt ${attempt + 1}/${maxRetries + 1}):`, err)
      // API hatası — retry prompt eklemeden tekrar dene (ağ hatası vs.)
      if (attempt < maxRetries) continue
      return null
    }

    if (!rawOutput) {
      console.warn(`${context} LLM boş yanıt döndürdü (attempt ${attempt + 1}/${maxRetries + 1})`)
      if (attempt < maxRetries) {
        messages.push(
          { role: 'assistant', content: '' },
          {
            role: 'user',
            content: 'Your previous response was empty. Output ONLY a valid JSON object, no markdown, no prose.',
          }
        )
        continue
      }
      return null
    }

    // --- JSON parse ---
    const parsed = parseAndClean<T>(rawOutput)

    if (parsed === null) {
      console.warn(
        `${context} JSON parse başarısız (attempt ${attempt + 1}/${maxRetries + 1}). Ham çıktı: ${rawOutput.slice(0, 300)}`
      )
      if (attempt < maxRetries) {
        messages.push(
          { role: 'assistant', content: rawOutput },
          {
            role: 'user',
            content: `Your previous output could not be parsed as JSON. Raw output was:\n${rawOutput.slice(0, 300)}\n\nOutput ONLY a valid JSON object, no markdown, no prose.`,
          }
        )
        continue
      }
      return null
    }

    // --- Validation ---
    const result = validate(parsed)

    if (!result.ok) {
      console.warn(
        `${context} Validation başarısız (attempt ${attempt + 1}/${maxRetries + 1}). Eksik alanlar: ${result.issues.join(', ')}`
      )
      if (attempt < maxRetries) {
        messages.push(
          { role: 'assistant', content: rawOutput },
          {
            role: 'user',
            content: `Your output was missing required fields:\n${result.issues.map((i) => `- ${i}`).join('\n')}\n\nRe-generate with all fields complete. Output ONLY a valid JSON object.`,
          }
        )
        continue
      }
      return null
    }

    // --- Başarılı ---
    if (attempt > 0) {
      console.warn(`${context} ${attempt} retry sonrası başarılı.`)
    }
    return result.value
  }

  // Teorik olarak buraya ulaşılmamalı
  return null
}
