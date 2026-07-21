"""
nemo_bridge.py — NemoClaw / Hermes Agent API Köprüsü

Kullanım:
    python nemo_bridge.py --doc path/to/brief.json
    python nemo_bridge.py --doc path/to/script.json --config ./config.yaml

    Veya doğrudan import ederek:
        from nemo_bridge import validate_document, BridgeConfig

Gereksinimler:
    pip install requests pyyaml
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
import yaml

# ---------------------------------------------------------------------------
# .env.local otomatik yükleyici (python-dotenv gerekmez)
# ---------------------------------------------------------------------------

def _load_dotenv_local() -> None:
    """
    Proje kökündeki .env.local dosyasını okur, os.environ'a yükler.
    Zaten set edilmiş değerlerin üzerine yazmaz.
    """
    env_path = Path(__file__).parent.parent / ".env.local"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_dotenv_local()

# ---------------------------------------------------------------------------
# Logging — demo-loop.ts ile aynı prefix stili
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("[NemoBridge]")

# ---------------------------------------------------------------------------
# Veri yapıları
# ---------------------------------------------------------------------------


@dataclass
class BackendConfig:
    local_mode: bool
    local_base_url: str
    local_chat_path: str
    nim_base_url: str
    nim_chat_path: str
    nim_model: str
    nim_api_key_env: str


@dataclass
class RateLimitConfig:
    requests_per_minute: int
    retry_on_429: bool
    retry_delay_seconds: int
    max_retries: int


@dataclass
class BridgeConfig:
    skill_file: str
    response_format: str
    max_tokens: int
    temperature: float
    backend: BackendConfig
    rate_limit: RateLimitConfig
    log_raw_response: bool


@dataclass
class ValidationViolation:
    field: str
    rule: str
    found: str


@dataclass
class ValidationWarning:
    field: str
    message: str


@dataclass
class BridgeResult:
    """Harness loop'un beklediği standart response yapısı."""
    doc_type: str           # "brief" | "script" | "unknown"
    is_valid: bool
    violation_count: int
    violations: list[ValidationViolation]
    warnings: list[ValidationWarning]
    quality_notes: list[str]
    summary: str
    raw_response: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_type": self.doc_type,
            "is_valid": self.is_valid,
            "violation_count": self.violation_count,
            "violations": [v.__dict__ for v in self.violations],
            "warnings": [w.__dict__ for w in self.warnings],
            "quality_notes": self.quality_notes,
            "summary": self.summary,
        }


# ---------------------------------------------------------------------------
# Config yükleyici
# ---------------------------------------------------------------------------


def load_config(config_path: str | Path = "config.yaml") -> BridgeConfig:
    """config.yaml'ı okur, eksik env var varsa uyarır."""
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"[NemoBridge] config.yaml bulunamadı: {path.resolve()}")

    with open(path, encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f)

    agent = raw.get("agent", {})
    backend_raw = raw.get("backend", {})
    local_raw = backend_raw.get("local", {})
    nim_raw = backend_raw.get("nim_api", {})
    rl_raw = raw.get("rate_limit", {})
    log_raw = raw.get("logging", {})

    backend = BackendConfig(
        local_mode=backend_raw.get("local_mode", True),
        local_base_url=local_raw.get("base_url", "http://localhost:8000/v1"),
        local_chat_path=local_raw.get("chat_path", "/agent/chat"),
        nim_base_url=nim_raw.get("base_url", "https://integrate.api.nvidia.com/v1"),
        nim_chat_path=nim_raw.get("chat_path", "/chat/completions"),
        nim_model=nim_raw.get("model", "mistralai/mixtral-8x22b-instruct-v0.1"),
        nim_api_key_env=nim_raw.get("api_key_env", "NVCF_API_KEY"),
    )

    rate_limit = RateLimitConfig(
        requests_per_minute=rl_raw.get("requests_per_minute", 20),
        retry_on_429=rl_raw.get("retry_on_429", True),
        retry_delay_seconds=rl_raw.get("retry_delay_seconds", 3),
        max_retries=rl_raw.get("max_retries", 2),
    )

    # Skill dosyasını config.yaml'ın yanına göre çöz
    skill_relative = agent.get("skill_file", "./skills/doc-format-rules.md")
    skill_abs = (path.parent / skill_relative).resolve()

    return BridgeConfig(
        skill_file=str(skill_abs),
        response_format=agent.get("response_format", "json"),
        max_tokens=agent.get("max_tokens", 2000),
        temperature=agent.get("temperature", 0.1),
        backend=backend,
        rate_limit=rate_limit,
        log_raw_response=log_raw.get("log_raw_response", False),
    )


# ---------------------------------------------------------------------------
# Skill yükleyici
# ---------------------------------------------------------------------------


def load_skill(skill_path: str) -> str:
    """Hermes Skill markdown dosyasını system prompt olarak döner."""
    path = Path(skill_path)
    if not path.exists():
        raise FileNotFoundError(f"[NemoBridge] Skill dosyası bulunamadı: {path}")
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# HTTP istek — fire-and-forget değil, sonucu bekler
# ---------------------------------------------------------------------------


def _build_request_payload(
    system_prompt: str,
    document_json: str,
    config: BridgeConfig,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    """
    (url, headers, body) üçlüsü döner.
    local_mode=True  → NemoClaw local endpoint
    local_mode=False → NVIDIA NIM API (OpenAI-compat)
    """
    b = config.backend

    if b.local_mode:
        url = f"{b.local_base_url.rstrip('/')}{b.local_chat_path}"
        headers = {"Content-Type": "application/json"}
        body: dict[str, Any] = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": document_json},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
        }
    else:
        api_key = os.environ.get(b.nim_api_key_env, "")
        if not api_key:
            raise EnvironmentError(
                f"[NemoBridge] {b.nim_api_key_env} env var tanımlanmamış. "
                ".env.local dosyanızı kontrol edin."
            )
        url = f"{b.nim_base_url.rstrip('/')}{b.nim_chat_path}"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": b.nim_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": document_json},
            ],
            # response_format kaldırıldı — NIM'de desteklemeyen modeller 400 döner
            # System prompt'ta JSON formatı zaten zorunlu kılınıyor
            "max_tokens": config.max_tokens,
            "temperature": config.temperature,
        }

    return url, headers, body


def _http_post_with_retry(
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    config: BridgeConfig,
) -> dict[str, Any]:
    """
    POST isteği atar, 429 durumunda retry uygular.
    api-routes standartlarına göre: 429 → 429, 500 → exception.
    """
    rl = config.rate_limit
    attempt = 0

    while attempt <= rl.max_retries:
        try:
            log.info("POST %s (deneme %d/%d)", url, attempt + 1, rl.max_retries + 1)
            response = requests.post(url, headers=headers, json=body, timeout=120)

            if response.status_code == 429:
                if rl.retry_on_429 and attempt < rl.max_retries:
                    log.warning(
                        "429 Rate limit — %d saniye bekleniyor...",
                        rl.retry_delay_seconds,
                    )
                    time.sleep(rl.retry_delay_seconds)
                    attempt += 1
                    continue
                else:
                    raise RuntimeError(
                        f"[NemoBridge] Rate limit aşıldı (429). "
                        f"Tüm {rl.max_retries + 1} deneme tükendi."
                    )

            if response.status_code >= 400:
                # Hata detayını logla
                try:
                    error_detail = response.json()
                    log.error("API hata detayı: %s", error_detail)
                except:
                    log.error("API ham hata: %s", response.text[:500])
            
            response.raise_for_status()
            return response.json()  # type: ignore[no-any-return]

        except requests.exceptions.ConnectionError as exc:
            raise ConnectionError(
                f"[NemoBridge] Bağlantı hatası: {url}\n"
                "NemoClaw container çalışıyor mu? "
                "`docker compose up nemo-agent` komutunu deneyin."
            ) from exc

        except requests.exceptions.Timeout as exc:
            raise TimeoutError(
                f"[NemoBridge] İstek zaman aşımına uğradı (30s): {url}"
            ) from exc

    # Buraya normalde ulaşılmaz
    raise RuntimeError("[NemoBridge] Beklenmeyen retry döngüsü sonu.")


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------


def _parse_agent_response(raw: dict[str, Any], config: BridgeConfig) -> BridgeResult:
    """
    NemoClaw veya NIM API'den gelen ham yanıtı BridgeResult'a dönüştürür.
    local ve NIM iki farklı sarmalama yapısı döndürebilir.
    """
    # NIM/OpenAI-compat yanıt yapısı: choices[0].message.content
    content_str: str | None = None

    if "choices" in raw:
        # OpenAI-compat format
        content_str = (
            raw.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
    elif "response" in raw:
        # NemoClaw local format (agent gateway)
        content_str = raw.get("response", "")
    elif "content" in raw:
        content_str = raw.get("content", "")
    else:
        # Direkt JSON object olarak döndürdüyse
        content_str = json.dumps(raw)

    if not content_str:
        raise ValueError("[NemoBridge] Agent yanıtı boş geldi.")

    if config.log_raw_response:
        log.debug("Ham yanıt: %s", content_str[:500])

    # JSON parse
    try:
        parsed: dict[str, Any] = json.loads(content_str)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"[NemoBridge] Agent geçerli JSON döndürmedi: {content_str[:200]}"
        ) from exc

    # violations listesi
    violations: list[ValidationViolation] = []
    for v in parsed.get("violations", []):
        violations.append(ValidationViolation(
            field=v.get("field", ""),
            rule=v.get("rule", ""),
            found=v.get("found", ""),
        ))

    # warnings listesi
    warnings: list[ValidationWarning] = []
    for w in parsed.get("warnings", []):
        warnings.append(ValidationWarning(
            field=w.get("field", ""),
            message=w.get("message", ""),
        ))

    return BridgeResult(
        doc_type=parsed.get("doc_type", "unknown"),
        is_valid=bool(parsed.get("is_valid", False)),
        violation_count=int(parsed.get("violation_count", len(violations))),
        violations=violations,
        warnings=warnings,
        quality_notes=parsed.get("quality_notes", []),
        summary=parsed.get("summary", ""),
        raw_response=raw,
    )


# ---------------------------------------------------------------------------
# Ana public fonksiyon — harness loop'tan çağrılır
# ---------------------------------------------------------------------------


def validate_document(
    document: dict[str, Any] | list[Any] | str,
    config: BridgeConfig | None = None,
    config_path: str | Path = "config.yaml",
) -> BridgeResult:
    """
    Ham dökümanı (Research Brief veya Interview Script) NemoClaw'a gönderir,
    kural kontrolü yapılmış BridgeResult döner.

    Args:
        document:    Doğrulanacak JSON dökümanı (dict veya JSON string)
        config:      BridgeConfig nesnesi (None ise config_path'ten yüklenir)
        config_path: config.yaml dosyasının yolu

    Returns:
        BridgeResult: { is_valid, violations, warnings, summary, ... }

    Örnek kullanım (run-evals.ts eşdeğeri):
        cfg = load_config("nemo-bridge/config.yaml")
        result = validate_document(parsed_brief, cfg)
        if not result.is_valid:
            print(result.summary)
    """
    if config is None:
        config = load_config(config_path)

    # Dökümanı string'e çevir — API her zaman string content bekler
    if isinstance(document, dict):
        document_str = json.dumps(document, ensure_ascii=False, indent=2)
    elif isinstance(document, list):
        document_str = json.dumps(document, ensure_ascii=False, indent=2)
    else:
        document_str = str(document)

    # Skill / system prompt yükle
    system_prompt = load_skill(config.skill_file)

    # İstek payload'ını hazırla
    url, headers, body = _build_request_payload(system_prompt, document_str, config)

    # HTTP POST (retry dahil)
    raw_response = _http_post_with_retry(url, headers, body, config)

    # Yanıtı parse et
    result = _parse_agent_response(raw_response, config)

    # Loglama — demo-loop.ts'deki ok/bad stili
    status_icon = "✓" if result.is_valid else "✗"
    log.info(
        "%s [%s] %d ihlal, %d uyarı — %s",
        status_icon,
        result.doc_type,
        result.violation_count,
        len(result.warnings),
        result.summary[:80],
    )

    return result


# ---------------------------------------------------------------------------
# Harness loop entegrasyonu — run-evals.ts'e TypeScript'te bağlanmak yerine
# doğrudan Python'dan çağrı örneği
# ---------------------------------------------------------------------------


def run_harness_check(
    doc_path: str | Path,
    config_path: str | Path = "config.yaml",
) -> BridgeResult:
    """
    Dosya yolundan JSON dökümanı okur, validate_document'a iletir.
    run-evals.ts'deki loadFixture() eşdeğeri.
    """
    path = Path(doc_path)
    if not path.exists():
        raise FileNotFoundError(f"[NemoBridge] Döküman bulunamadı: {path}")

    with open(path, encoding="utf-8") as f:
        raw = json.load(f)  # dict veya list olabilir

    config = load_config(config_path)
    return validate_document(raw, config)


# ---------------------------------------------------------------------------
# CLI — doğrudan çalıştırma için
# ---------------------------------------------------------------------------


def _cli() -> None:
    """
    python nemo_bridge.py --doc brief.json [--config config.yaml]
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="NemoClaw Bridge — Döküman format doğrulayıcısı"
    )
    parser.add_argument(
        "--doc",
        required=True,
        help="Doğrulanacak JSON dosyasının yolu (brief veya script)",
    )
    parser.add_argument(
        "--config",
        default="config.yaml",
        help="config.yaml dosyasının yolu (varsayılan: config.yaml)",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Sonucu girintili JSON olarak yazdır",
    )
    args = parser.parse_args()

    # config.yaml'ın bulunduğu dizini belirle
    script_dir = Path(__file__).parent
    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = script_dir / config_path

    try:
        result = run_harness_check(args.doc, config_path)

        output = result.to_dict()
        indent = 2 if args.pretty else None
        print(json.dumps(output, ensure_ascii=False, indent=indent))

        # CI uyumlu exit kodu
        sys.exit(0 if result.is_valid else 1)

    except (FileNotFoundError, ConnectionError, TimeoutError, ValueError) as exc:
        log.error("Hata: %s", exc)
        sys.exit(2)


if __name__ == "__main__":
    _cli()
