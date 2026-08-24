import type { InterviewLanguage } from '@/types/index'

// ---------------------------------------------------------------------------
// Retry döngüsü için "agresif" düzeltme direktifleri.
//
// Kök neden: Guard retry'ları önceden AYNI prompt'u değişmeden yeniden
// gönderiyordu. Model, "? Yani, ...?" gibi bir hata yaptığında, retry 1 ve
// retry 2'de de BİREBİR AYNI hatayı tekrarlıyordu — çünkü modele neyin yanlış
// olduğuna dair hiçbir geri bildirim verilmiyordu. Bu modül, retry öncesi
// başarısız cevabı (assistant turn olarak) + neyin düzeltilmesi gerektiğini
// (user turn olarak) conversation'a ekleyen mesajları üretir.
// ---------------------------------------------------------------------------

/**
 * Guard (kural filtresi / isolated check) reddettiğinde kullanılan düzeltme
 * direktifi — çoklu soru veya "Yani/In other words/Specifically" ile bağlanan
 * ikinci soru kalıbını hedefler (production'da gözlemlenen asıl hata deseni).
 */
export const CONTENT_VIOLATION_CORRECTION =
  "ERROR: Your previous response contained multiple questions or a 'Yani/In other words' clarification. You must rewrite the response to contain EXACTLY ONE single question sentence with EXACTLY ONE question mark (?). Do not add any preamble, explanation, or follow-up question."

/** Dil uyumsuzluğu nedeniyle retry tetiklendiğinde kullanılan düzeltme direktifi. */
export function buildLanguageCorrection(lang: InterviewLanguage): string {
  const label = lang === 'tr' ? 'Turkish' : 'English'
  return `ERROR: Your previous response was not written in the required language. Rewrite it completely, fluently, and natively in ${label}. Do not mix languages or explain the correction — just answer in ${label}.`
}
