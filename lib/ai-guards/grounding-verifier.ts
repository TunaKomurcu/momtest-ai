/**
 * Grounding Verifier — LLM analiz alıntılarını transkriptte doğrular.
 *
 * Deterministik, sıfır LLM çağrısı — sadece string karşılaştırma.
 * Prefix: [Analyze/grounding]
 */

import type { StructuredAnalysis } from '@/types/index'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

/** Tek bir grounding sorunu */
export interface GroundingIssue {
  category: 'strong' | 'medium' | 'weak' | 'negative'
  index: number
  quote: string
  message_id: string
  reason: 'missing_message_id' | 'quote_not_found'
}

/** Grounding doğrulama için gereken minimal mesaj arayüzü */
export interface GroundingMessage {
  id: string
  content: string
}

// ---------------------------------------------------------------------------
// Normalize helper
// ---------------------------------------------------------------------------

/**
 * LLM alıntıları ile transkript metnini normalize eder.
 * Küçük/büyük harf, fazladan boşluk, noktalama farklarını tolere eder.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[""''„"]/g, '"')          // fancy tırnak → düz tırnak
    .replace(/[–—]/g, '-')              // em/en dash → kısa çizgi
    .replace(/[^\w\s'-]/g, ' ')         // noktalama kaldır (tırnak ve tire hariç)
    .replace(/\s+/g, ' ')               // çoklu boşluk → tek boşluk
    .trim()
}

/**
 * Normalize edilmiş quote'un, normalize edilmiş message content'inde
 * geçip geçmediğini kontrol eder.
 *
 * Fuzzy eşleşme stratejisi:
 * 1. Tam normalize includes kontrolü
 * 2. Başarısız olursa: quote'u kelimelerine böl, en az %70'i message'da varsa geçer
 *    (LLM parafraz yaptığında kısmi örtüşme yeterli)
 */
export function quoteFoundInContent(quote: string, content: string): boolean {
  const normQuote   = normalizeText(quote)
  const normContent = normalizeText(content)

  // 1. Tam (normalize) includes
  if (normContent.includes(normQuote)) return true

  // 2. Kısmi kelime örtüşmesi — kısa alıntılar için minimum 3 kelime şartı
  const quoteWords   = normQuote.split(' ').filter(w => w.length > 2)
  if (quoteWords.length < 3) return false

  const matchCount = quoteWords.filter(w => normContent.includes(w)).length
  const matchRatio = matchCount / quoteWords.length

  return matchRatio >= 0.70
}

// ---------------------------------------------------------------------------
// Ana fonksiyon
// ---------------------------------------------------------------------------

/**
 * LLM'in ürettiği StructuredAnalysis'teki tüm alıntıları transkripte karşı doğrular.
 *
 * @param analysis  LLM'den dönen analiz çıktısı
 * @param messages  Transkript mesajları (id + content)
 * @returns         Bulunan sorunların listesi — boşsa grounding tamam
 */
export function verifyGrounding(
  analysis: StructuredAnalysis,
  messages: GroundingMessage[]
): GroundingIssue[] {
  const issues: GroundingIssue[] = []

  // message_id → content hızlı arama için Map
  const messageMap = new Map<string, string>(
    messages.map(m => [m.id, m.content])
  )

  type EvidenceEntry = { quote: string; message_id: string }
  type Category = 'strong' | 'medium' | 'weak' | 'negative'

  const categories: Array<{ name: Category; entries: EvidenceEntry[] }> = [
    { name: 'strong',   entries: analysis.strongEvidence   },
    { name: 'medium',   entries: analysis.mediumEvidence   },
    { name: 'weak',     entries: analysis.weakEvidence     },
    { name: 'negative', entries: analysis.negativeEvidence },
  ]

  for (const { name, entries } of categories) {
    entries.forEach((entry, idx) => {
      // Boş message_id — bazı eski kayıtlarda olabilir, atla
      if (!entry.message_id) return

      const content = messageMap.get(entry.message_id)

      // 1. message_id transkriptte yok
      if (content === undefined) {
        issues.push({
          category:   name,
          index:      idx,
          quote:      entry.quote,
          message_id: entry.message_id,
          reason:     'missing_message_id',
        })
        console.warn(
          `[Analyze/grounding] message_id bulunamadı — category: ${name}[${idx}], id: ${entry.message_id}`
        )
        return
      }

      // 2. Alıntı mesaj içeriğinde geçmiyor
      if (!quoteFoundInContent(entry.quote, content)) {
        issues.push({
          category:   name,
          index:      idx,
          quote:      entry.quote,
          message_id: entry.message_id,
          reason:     'quote_not_found',
        })
        console.warn(
          `[Analyze/grounding] Alıntı mesajda bulunamadı — category: ${name}[${idx}], ` +
          `message_id: ${entry.message_id}, quote: "${entry.quote.slice(0, 60)}..."`
        )
      }
    })
  }

  if (issues.length === 0) {
    console.log(`[Analyze/grounding] Tüm alıntılar doğrulandı — ${messages.length} mesaj, sıfır sorun`)
  } else {
    console.warn(`[Analyze/grounding] ${issues.length} grounding sorunu bulundu`)
  }

  return issues
}

// ---------------------------------------------------------------------------
// Yardımcı: issues → groundingWarnings string[]
// ---------------------------------------------------------------------------

/**
 * GroundingIssue listesini analysis_json içine eklenecek
 * insan okunabilir string dizisine çevirir.
 */
export function issuesToWarnings(issues: GroundingIssue[]): string[] {
  return issues.map(issue => {
    const label = issue.reason === 'missing_message_id'
      ? `message_id bulunamadı (${issue.message_id})`
      : `alıntı transkriptte doğrulanamadı`
    return `[${issue.category}][${issue.index}] ${label}: "${issue.quote.slice(0, 80)}"`
  })
}
