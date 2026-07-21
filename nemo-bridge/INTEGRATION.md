# NemoClaw Bridge — Entegrasyon Kılavuzu

Mevcut MomTest AI harness/loop sistemiyle NemoClaw (Hermes Agent) arasında kurulan minimal API köprüsü.

**Mimari ilke:** Mevcut TypeScript stack'e dokunulmaz. NemoClaw dışarıdan bir mikroservis gibi çağrılır.

---

## Klasör Yapısı

```
nemo-bridge/
├── config.yaml              # Backend seçimi, rate limit, token ayarları
├── nemo_bridge.py           # Python wrapper — tek import noktası
├── skills/
│   └── doc-format-rules.md  # Hermes Skill: statik kuralların metin karşılığı
└── INTEGRATION.md           # Bu dosya
```

---

## Gereksinimler

```bash
pip install requests pyyaml
```

Python 3.10+ önerilir (`match` ve `|` union type syntax kullanılmıyor, 3.8+ çalışır).

---

## Seçenek A — NVIDIA NIM API (Hızlı Başlangıç, Docker gerekmez)

**1. API key al**

[https://integrate.api.nvidia.com](https://integrate.api.nvidia.com) → hesap oluştur → API key kopyala.

**2. `.env.local` güncelle**

```bash
NVCF_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxx
```

**3. `config.yaml` içinde modu değiştir**

```yaml
backend:
  local_mode: false
```

**4. Test et**

```bash
cd nemo-bridge
python nemo_bridge.py --doc ../lib/evals/fixtures/brief-input.json --pretty
```

Beklenen çıktı:
```json
{
  "doc_type": "brief",
  "is_valid": true,
  "violation_count": 0,
  "violations": [],
  "warnings": [...],
  "quality_notes": [...],
  "summary": "Research Brief tüm zorunlu alanları karşılıyor."
}
```

---

## Seçenek B — Lokal Docker (Tam izole test ortamı)

> NGC API key gerektirir: [https://org.ngc.nvidia.com/setup/api-key](https://org.ngc.nvidia.com/setup/api-key)

**1. `.env.local` güncelle**

```bash
NGC_API_KEY=your-ngc-key-here
```

**2. Sadece NemoClaw servisini başlat**

```bash
# Mevcut postgres'i etkilemez — profile flag ile izole edilmiş
docker compose --profile nemo up nemo-agent
```

Container sağlık kontrolü geçene kadar bekle (~60 saniye):
```bash
docker compose logs -f nemo-agent
# "health check passed" görününce devam et
```

**3. `config.yaml` içinde modu doğrula**

```yaml
backend:
  local_mode: true   # zaten varsayılan
```

**4. Test et**

```bash
cd nemo-bridge
python nemo_bridge.py --doc ../lib/evals/fixtures/brief-input.json --pretty
```

---

## Python'dan Doğrudan Import

`run-evals.ts` eşdeğeri olarak Python'dan da çalıştırılabilir:

```python
from nemo_bridge import load_config, validate_document

cfg = load_config("nemo-bridge/config.yaml")

# Research Brief doğrulama
with open("lib/evals/fixtures/brief-input.json") as f:
    import json
    brief = json.load(f)

result = validate_document(brief, cfg)

if result.is_valid:
    print(f"✓ {result.summary}")
else:
    for v in result.violations:
        print(f"✗ {v.field}: {v.rule} (bulundu: {v.found})")
```

---

## Mevcut TypeScript Harness ile Bağlantı

`demo-loop.ts` ve `run-evals.ts` doğrudan değiştirilmez. İki entegrasyon yolu:

### Yol 1 — Paralel çalıştırma (öneri)

TypeScript harness normal akışında çalışmaya devam eder. Python bridge ayrı bir test komutu olarak çalışır:

```bash
# Terminal 1 — mevcut harness
npx tsx lib/evals/run-evals.ts

# Terminal 2 — NemoClaw bridge testi
cd nemo-bridge && python nemo_bridge.py --doc ../lib/evals/fixtures/brief-input.json
```

### Yol 2 — `package.json` script entegrasyonu

`package.json`'a eklenebilir:

```json
{
  "scripts": {
    "eval:nemo": "cd nemo-bridge && python nemo_bridge.py --doc ../lib/evals/fixtures/brief-input.json --pretty"
  }
}
```

```bash
npm run eval:nemo
```

### Yol 3 — TypeScript'ten `child_process` ile çağırma

Mevcut harness içinden bridge'i tetiklemek gerekirse `run-evals.ts`'ye şu blok eklenebilir:

```typescript
import { execSync } from 'child_process'

function runNemoBridgeCheck(fixturePath: string): void {
  try {
    const output = execSync(
      `python nemo-bridge/nemo_bridge.py --doc ${fixturePath}`,
      { encoding: 'utf-8' }
    )
    const result = JSON.parse(output) as {
      is_valid: boolean
      violation_count: number
      summary: string
    }
    if (result.is_valid) {
      console.log(`[NemoBridge] ✓ ${result.summary}`)
    } else {
      console.warn(`[NemoBridge] ✗ ${result.violation_count} ihlal — ${result.summary}`)
    }
  } catch (err) {
    // Fire-and-forget — bridge hatası ana eval'ı durdurmaz
    console.warn('[NemoBridge] Bridge çağrısı başarısız (ana eval devam ediyor):', err)
  }
}
```

Bu yöntemde Make webhook pattern'i uygulanır: bridge başarısız olsa ana harness durdurulamaz.

---

## BridgeResult Yapısı

```typescript
// TypeScript eşdeğer tip (bilgi amaçlı)
interface BridgeResult {
  doc_type: 'brief' | 'script' | 'unknown'
  is_valid: boolean
  violation_count: number
  violations: Array<{ field: string; rule: string; found: string }>
  warnings: Array<{ field: string; message: string }>
  quality_notes: string[]
  summary: string
}
```

---

## Exit Kodları (CI Entegrasyonu)

| Kod | Anlam |
|-----|-------|
| `0` | Döküman geçerli (`is_valid: true`) |
| `1` | Kural ihlali var (`is_valid: false`) |
| `2` | Bridge hatası (dosya yok, bağlantı hatası, JSON parse hatası) |

GitHub Actions veya benzeri CI'da:

```yaml
- name: NemoClaw Bridge Check
  run: |
    cd nemo-bridge
    python nemo_bridge.py --doc ../lib/evals/fixtures/brief-input.json
  env:
    NVCF_API_KEY: ${{ secrets.NVCF_API_KEY }}
```

---

## Sorun Giderme

**`ConnectionError: Bağlantı hatası`**
→ Docker container çalışmıyor. `docker compose --profile nemo up nemo-agent` deneyin.
→ Veya `config.yaml` içinde `local_mode: false` yapıp NIM API'ye geçin.

**`EnvironmentError: NVCF_API_KEY env var tanımlanmamış`**
→ `.env.local` dosyasına `NVCF_API_KEY=nvapi-...` satırını ekleyin.
→ Python script `.env.local`'ı otomatik okumaz — terminalde `export NVCF_API_KEY=...` yapın veya `python-dotenv` ekleyin.

**`ValueError: Agent geçerli JSON döndürmedi`**
→ `config.yaml`'da `log_raw_response: true` yaparak ham yanıtı inceleyin.
→ Model temperature'ı düşürün (`temperature: 0.0`).

**`FileNotFoundError: Skill dosyası bulunamadı`**
→ `config.yaml` içindeki `skill_file` yolunu kontrol edin. Yol `config.yaml`'a görelidir.

---

## Neye Bağlanır, Neye Dokunmaz

```
┌─────────────────────────────────────────────────────┐
│  MomTest AI (Next.js + TypeScript)                  │
│                                                     │
│  demo-loop.ts   ──→  OpenAI/Groq API                │
│  run-evals.ts   ──→  OpenAI/Groq API                │
│  brief-validator.ts  (statik TS kurallar)           │
│                         │                           │
│                    değişmez ↕                       │
└─────────────────────────────────────────────────────┘
              ↕ tamamen bağımsız
┌─────────────────────────────────────────────────────┐
│  nemo-bridge/  (Python mikroservis köprüsü)         │
│                                                     │
│  nemo_bridge.py  ──→  NemoClaw (Docker :8000)       │
│                   veya NIM API (https://...)        │
│                                                     │
│  Skill: doc-format-rules.md                         │
│  (brief-validator.ts kurallarının metin hali)       │
└─────────────────────────────────────────────────────┘
```

Mevcut PostgreSQL, Drizzle ORM, Supabase auth ve Next.js route'larına hiçbir değişiklik yapılmamıştır.
