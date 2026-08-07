#!/bin/sh
set -e

echo "==> Veritabanının hazır olması bekleniyor..."
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => { console.log('DB hazir'); c.end(); process.exit(0); })
  .catch(() => process.exit(1));
" 2>/dev/null; do
  echo "    DB henüz hazır değil, 2 saniye bekleniyor..."
  sleep 2
done

echo "==> Drizzle migrasyonları çalıştırılıyor..."
node migrate.js

echo "==> Next.js başlatılıyor..."
exec node server.js
