#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SIGC-Motos — Build & Deploy Frontend en VPS
#  Uso: bash /opt/SIGH_MOTOS/scripts/deploy-frontend.sh
#
#  Qué hace:
#   1. Construye el frontend React/Vite dentro de un contenedor Docker
#      (no requiere Node.js instalado en el host del VPS)
#   2. El output queda en ./frontend/dist  (montado por nginx en docker-compose)
#   3. Recarga nginx sin downtime
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR=/opt/SIGH_MOTOS

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SIGC-Motos — Build & Deploy Frontend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$APP_DIR"

# ── 1. Construir frontend en contenedor temporal ──────────────────────────────
echo "[1/3] Construyendo frontend React/Vite en Docker..."

docker run --rm \
  --user root \
  -v "$APP_DIR/frontend":/app \
  -w /app \
  node:20-alpine \
  sh -c '
    set -e
    echo "  → Limpiando node_modules anteriores..."
    rm -rf node_modules

    echo "  → Instalando dependencias (npm ci)..."
    npm ci --silent

    echo "  → Compilando (tsc + vite build)..."
    # Si tsc falla por errores de tipos, compilar solo con vite
    npm run build 2>&1 || {
      echo "  ! tsc encontró errores, compilando solo con vite..."
      npx vite build
    }

    echo "  → Build finalizado."
  '

# ── 2. Verificar que index.html fue generado ──────────────────────────────────
echo "[2/3] Verificando build..."

if [ ! -f "$APP_DIR/frontend/dist/index.html" ]; then
  echo ""
  echo "ERROR: No se generó frontend/dist/index.html"
  echo "  Revisa los logs de build arriba para ver el error."
  exit 1
fi

TOTAL_FILES=$(find "$APP_DIR/frontend/dist" -type f | wc -l)
DIST_SIZE=$(du -sh "$APP_DIR/frontend/dist" | cut -f1)

echo "  → frontend/dist/index.html encontrado ✓"
echo "  → Total archivos: $TOTAL_FILES  |  Tamaño: $DIST_SIZE"

# ── 3. Recargar nginx sin downtime ────────────────────────────────────────────
echo "[3/3] Recargando nginx..."

if docker ps --filter "name=sigc_nginx" --filter "status=running" -q | grep -q .; then
  docker exec sigc_nginx nginx -t && docker exec sigc_nginx nginx -s reload
  echo "  → Nginx recargado ✓"
else
  echo "  ! Nginx no está corriendo. Iniciando..."
  docker compose --env-file .env.production up -d nginx
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Frontend desplegado correctamente"
echo "  URL: https://motos.quantacloud.co"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
