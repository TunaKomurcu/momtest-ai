#!/bin/bash
# =============================================================================
# MomTest AI — Podman başlatma scripti (Linux / macOS)
# =============================================================================
set -e

# Renk kodları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}==> MomTest AI — Podman Başlatma${NC}"

# .env.local kontrolü
if [ ! -f ".env.local" ]; then
  echo -e "${YELLOW}⚠  .env.local bulunamadı. .env.example'dan kopyalanıyor...${NC}"
  cp .env.example .env.local
  echo -e "${RED}✖  Lütfen .env.local dosyasını düzenleyin (OPENAI_API_KEY, vb.) ve tekrar çalıştırın.${NC}"
  exit 1
fi

# podman-compose kontrolü
if ! command -v podman-compose &> /dev/null; then
  echo -e "${RED}✖  podman-compose bulunamadı. Kurulum: pip install podman-compose${NC}"
  # podman kendi compose eklentisini destekliyorsa onu dene
  if podman compose version &> /dev/null 2>&1; then
    COMPOSE_CMD="podman compose"
  else
    echo -e "${RED}   Alternatif: docker compose kullanın.${NC}"
    exit 1
  fi
else
  COMPOSE_CMD="podman-compose"
fi

echo -e "${GREEN}==> Kullanılan komut: ${COMPOSE_CMD}${NC}"

# Argüman kontrolü
ACTION=${1:-up}

case "$ACTION" in
  up)
    echo -e "${GREEN}==> Container'lar başlatılıyor (build dahil)...${NC}"
    $COMPOSE_CMD up --build -d
    echo -e "${GREEN}✔  Uygulama çalışıyor: http://localhost:3000${NC}"
    echo -e "${GREEN}   Logları görmek için: ${COMPOSE_CMD} logs -f app${NC}"
    ;;
  down)
    echo -e "${YELLOW}==> Container'lar durduruluyor...${NC}"
    $COMPOSE_CMD down
    ;;
  logs)
    $COMPOSE_CMD logs -f app
    ;;
  rebuild)
    echo -e "${YELLOW}==> Sıfırdan build alınıyor...${NC}"
    $COMPOSE_CMD down
    $COMPOSE_CMD build --no-cache
    $COMPOSE_CMD up -d
    echo -e "${GREEN}✔  Uygulama çalışıyor: http://localhost:3000${NC}"
    ;;
  *)
    echo "Kullanım: ./podman-start.sh [up|down|logs|rebuild]"
    exit 1
    ;;
esac
