# Kodlama ve İsimlendirme Standartları (Conventions)

## 1. Klasör Yapısı (Folder Structure)
Proje Next.js App Router mimarisine uygun olarak şu yapıda genişleyecektir:
- `app/`: Sayfa yönlendirmeleri, layout'lar ve API rotaları (App Router).
  - `app/api/`: Tüm backend API servisleri.
  - `app/interview/`: Kamusal mülakat arayüzü sayfası.
- `components/`: UI bileşenleri (Atomic Design prensibine göre ayrılmış atom, molekül yapılar).
- `lib/`: Üçüncü parti servislerin (Supabase, OpenAI) istemci ve sunucu konfigürasyonları.
- `types/`: Global TypeScript tip tanımlamaları.
- `mom-test-customer-discovery/`: Mentörün referans dökümanları (Değiştirilmez, salt okunur kaynak).

## 2. İsimlendirme Kuralları (Naming Conventions)
- **Klasör ve Dosya Adları:** Küçük harf ve tire işareti ile (`kebab-case`) yazılacaktır. (Örn: `research-brief-generator.ts`, `api-routes.md`).
- **Bileşenler (Components):** Büyük CamelCase (`PascalCase`) kullanılacaktır. (Örn: `InterviewChat.tsx`, `SidebarDashboard.tsx`).
- **Değişkenler ve Fonksiyonlar:** Küçük camelCase kullanılacaktır. (Örn: `generateScript`, `projectData`).
- **SQL Tablo ve Sütun Adları:** Küçük harf ve alt çizgi (`snake_case`) kullanılacaktır. (Örn: `product_idea`, `signal_score`).

## 3. TypeScript Interface ve Tip Lokasyonları
- Supabase tarafından otomatik üretilen veritabanı tipleri `types/database.types.ts` altında saklanacaktır.
- Uygulamaya özel ara katman tipleri (Örn: API response yapıları, AI prompt mapping yapıları) `types/index.ts` veya ilgili modülün kendi klasöründeki `types.ts` dosyasında açıkça tanımlanacaktır. `any` tipi kesinlikle kullanılmayacaktır.