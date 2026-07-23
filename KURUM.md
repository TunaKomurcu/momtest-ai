# Kurulum Talimatları

Bu proje şirket ortamında Bitbucket'a yüklenmek üzere hazırlanmıştır. Aşağıdaki adımları sırasıyla takip ederek geliştirme ortamını kurun.

## Ön Gereksinimler

- **Docker Desktop** - PostgreSQL container'ı için
- **Node.js 20+** - Runtime ortamı
- **npm** - Paket yöneticisi
- **Git** - Versiyon kontrolü

## Adım 1: Projeyi Klonlayın

```bash
git clone <bitbucket-repo-url>
cd momtest-ai
```

## Adım 2: Dependencies'leri Yükleyin

```bash
npm install
```

## Adım 3: PostgreSQL'i Başlatın

Docker Compose ile PostgreSQL container'ını başlatın:

```bash
docker compose up -d
```

Bu komut:
- PostgreSQL 16 image'ini çeker
- `momtest` kullanıcısı ve veritabanını oluşturur
- 5432 portunu açar
- Verileri `postgres_data` volume'unda saklar

## Adım 4: Environment Variables'ı Yapılandırın

Örnek environment dosyasını kopyalayın:

```bash
cp .env.example .env.local
```

`.env.local` dosyasını düzenleyin ve şu değişkenleri doldurun:

```bash
# PostgreSQL bağlantısı
DATABASE_URL=postgresql://momtest:momtest@localhost:5432/momtest

# LLM Provider API Key (Groq, OpenAI, vb.)
OPENAI_API_KEY=sk-proj-...

# Opsiyonel Webhook URL'leri
MAKE_WEBHOOK_INTERVIEW_URL=
MAKE_WEBHOOK_ANALYSIS_URL=
```

## Adım 5: Database Migrations'ı Çalıştırın

Drizzle ORM ile schema'yı veritabanına uygulayın:

```bash
npm run db:push
```

Bu komut `lib/db/schema.ts` dosyasındaki tablo tanımlarını PostgreSQL'e uygular:
- `projects` tablosu
- `interviews` tablosu
- `messages` tablosu

## Adım 6: LLM Provider'ı Yapılandırın (Opsiyonel)

Varsayılan ayarları değiştirmek isterseniz `mom-test-customer-discovery/agents/openai.yaml` dosyasını düzenleyin:

```yaml
model:
  provider: "groq"           # groq, openai, vb.
  name: "llama-3.3-70b-versatile"
  base_url: "https://api.groq.com/openai/v1"
  temperature: 0.7
  max_tokens: 1024
```

## Adım 7: Development Server'ı Başlatın

```bash
npm run dev
```

Server http://localhost:3000 adresinde başlar. Dashboard'a otomatik yönlendirilirsiniz (login gerekmez).
