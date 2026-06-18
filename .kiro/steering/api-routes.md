# API Route Standartları

## 1. Yapı
- Tüm API rotaları `app/api/` altında `route.ts` olarak tanımlanır.
- Her route dosyası yalnızca ilgili HTTP metodunu (GET, POST) export eder.
- İstek doğrulama route'un en başında yapılır, iş mantığına geçilmez.

## 2. Rate Limiting
- Public rotalar (örn: /api/interview): IP başına dakikada max 10 istek.
- Authenticated rotalar (örn: /api/intake, /api/generate): dakikada max 20 istek.
- Limit aşılırsa 429 status kodu döner.

## 3. Make Webhook Pattern
- Webhook çağrıları fire-and-forget'tir: başarısız olsa ana işlem durdurulamaz.
- Webhook URL'leri .env.local'dan okunur (MAKE_WEBHOOK_INTERVIEW_URL, MAKE_WEBHOOK_ANALYSIS_URL).
- Her webhook çağrısı try/catch içine alınır, hata sadece loglanır.

## 4. Response Formatı
- Başarı: { data: T, error: null }
- Hata: { data: null, error: string }
- HTTP status kodları semantik kullanılır (200, 201, 400, 401, 404, 429, 500).