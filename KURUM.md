# Kurulum Talimatları

Bu proje Podman ile containerize edilmiştir. Tüm bileşenler (Next.js uygulaması + PostgreSQL) tek komutla ayağa kalkar.

## Ön Gereksinimler

- **Podman Desktop** — https://podman-desktop.io/
  - Windows'ta WSL2 backend ile birlikte gelir
  - Kurulumdan sonra Podman machine'in çalıştığından emin olun: `podman machine start`
- **Git** — Versiyon kontrolü

> Docker Desktop kullanıcıları için: `podman compose` yerine `docker compose` komutlarını kullanabilirsiniz, tüm dosyalar uyumludur.

---

## Hızlı Başlangıç

### 1. Projeyi Klonlayın

```bash
git clone <repo-url>
cd momtest-ai
```

### 2. Environment Variables'ı Yapılandırın

```bash
cp .env.example .env.local
```

`.env.local` dosyasını açın ve şu değişkenleri doldurun:

```bash
# OpenAI API Key — https://platform.openai.com/account/api-keys
OPENAI_API_KEY=sk-proj-...

# Opsiyonel — Make.com webhook URL'leri
MAKE_WEBHOOK_INTERVIEW_URL=
MAKE_WEBHOOK_ANALYSIS_URL=
```

> `DATABASE_URL` **doldurmayın** — container içinde otomatik ayarlanır.

### 3. Container'ları Başlatın

```bash
podman compose up --build -d
```

Bu komut:
- PostgreSQL 16 container'ı başlatır ve sağlık kontrolü yapar
- Next.js uygulamasını derler (ilk seferinde ~1-2 dakika sürer)
- Drizzle migrasyonlarını otomatik çalıştırır
- http://localhost:3000 adresinde uygulamayı başlatır

### 4. Windows'ta Port Erişimi (sadece ilk kurulumda)

Podman WSL backend kullandığı için Windows'tan erişmek üzere port proxy kurulması gerekir. **Admin PowerShell** açın:

```powershell
# WSL IP'sini öğren
$wslIp = podman machine ssh "ip -4 addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}'"

# Port proxy kur
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=3000 connectaddress=$wslIp connectport=3000
```

> **Not:** PC restart sonrası WSL IP değişebilir. Değişirse eski kuralı silip yeniden ekleyin:
> ```powershell
> netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=3000
> ```

---

## Günlük Kullanım

### Container'ları başlat/durdur

```powershell
# Başlat (rebuild olmadan)
podman compose up -d

# Durdur (veriler korunur)
podman compose down

# Logları izle
podman logs momtest2-app-1 -f
```

### Sıfırdan rebuild (kod değişikliği sonrası)

```powershell
podman compose down
podman compose up --build -d
```

### Ya da hazır scripti kullan

```powershell
# Windows
.\podman-start.ps1          # başlat
.\podman-start.ps1 down     # durdur
.\podman-start.ps1 rebuild  # sıfırdan build
.\podman-start.ps1 logs     # logları izle
```

```bash
# Linux / macOS
./podman-start.sh           # başlat
./podman-start.sh down      # durdur
./podman-start.sh rebuild   # sıfırdan build
```

---

## Environment Variables

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI API anahtarı |
| `DATABASE_URL` | ❌ | Container içinde otomatik ayarlanır — elle girmeyin |
| `MAKE_WEBHOOK_INTERVIEW_URL` | ❌ | Mülakat tamamlandığında tetiklenir |
| `MAKE_WEBHOOK_ANALYSIS_URL` | ❌ | Analiz tamamlandığında tetiklenir |
| `DEMO_MODE` | ❌ | `true` yapılırsa OpenAI key olmadan mock cevaplarla çalışır |

---

## LLM Provider Yapılandırması

`mom-test-customer-discovery/agents/openai.yaml` dosyasını düzenleyin:

```yaml
model:
  provider: "openai"
  name: "gpt-4o-mini"
  base_url: "https://api.openai.com/v1"
  temperature: 0.7
  max_tokens: 1024
```

Groq, Google AI Studio veya OpenAI-compatible herhangi bir provider desteklenir.
Değişiklik sonrası rebuild gerekmez — sadece restart yeterli.

---

## Veritabanı

Veriler `momtest2_postgres_data` adlı Podman volume'unda kalıcı olarak saklanır.
`podman compose down` yapılsa bile veriler silinmez.

Veriyi tamamen sıfırlamak için:
```powershell
podman compose down
podman volume rm momtest2_postgres_data
podman compose up --build -d
```

---

## Sorun Giderme

**Port 3000'e bağlanılamıyor:**
- Admin PowerShell'de port proxy kurulduğundan emin olun (yukarıdaki adım 4)
- `podman ps` ile container'ların çalıştığını kontrol edin

**Container başlamıyor:**
```powershell
podman logs momtest2-app-1 --tail 50
```

**Podman machine çalışmıyor:**
```powershell
podman machine start
```
