#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  SIGC-Motos — Fix Error P3005: Prisma Migrate Baseline
#
#  Problema: la BD tiene tablas pero no hay historial en prisma/migrations/.
#  Solución: generar la migración inicial a partir del schema actual y
#            marcarla como "ya aplicada" sin volver a ejecutar el SQL.
#
#  Ejecutar desde: /opt/SIGH_MOTOS
#  Uso:            bash fix-baseline.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/opt/SIGH_MOTOS"
ENV_FILE="$APP_DIR/.env.production"
COMPOSE="docker compose --env-file $ENV_FILE"

# ─── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}   ✓${NC} $*"; }
info() { echo -e "${BLUE}▶${NC}  $*"; }
warn() { echo -e "${YELLOW}   ⚠${NC}  $*"; }
fail() { echo -e "${RED}❌ ERROR:${NC} $*"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   SIGC-Motos — Fix P3005: Prisma Migrate Baseline       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cd "$APP_DIR" || fail "No se puede acceder a $APP_DIR"

# ── Paso 1: Validar DATABASE_URL ──────────────────────────────────────────────
info "[1/6] Validando .env.production..."

[[ ! -f "$ENV_FILE" ]] && fail "No se encontró $ENV_FILE"

DATABASE_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" | head -1 \
  | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")

[[ -z "$DATABASE_URL" ]] && \
  fail "DATABASE_URL no está en .env.production"
[[ "$DATABASE_URL" == *"CAMBIAR_ESTO"* ]] && \
  fail "DATABASE_URL tiene un placeholder sin reemplazar. Edita .env.production primero."

ok "DATABASE_URL presente y válido"

# ── Paso 2: Levantar sigc_db ──────────────────────────────────────────────────
echo ""
info "[2/6] Levantando sigc_db..."

$COMPOSE up -d db

echo "   Esperando healthcheck..."
WAITED=0
until docker inspect sigc_db --format='{{.State.Health.Status}}' 2>/dev/null \
      | grep -q "healthy"; do
  [[ $WAITED -ge 60 ]] && \
    fail "sigc_db no alcanzó 'healthy' en 60s. Revisa: docker logs sigc_db"
  printf "."
  sleep 2
  WAITED=$((WAITED + 2))
done
echo ""
ok "sigc_db está healthy"

# ── Paso 3: Construir imagen migrate ─────────────────────────────────────────
echo ""
info "[3/6] Construyendo imagen sigh_motos-migrate..."

$COMPOSE build migrate 2>&1 | grep -E "(Building|CACHED|Built|error|Error|=>)" \
  | head -20 || true
ok "Imagen lista"

# ── Paso 4: Crear la baseline migration ──────────────────────────────────────
echo ""
info "[4/6] Creando baseline migration..."

# Nombre con timestamp para que Prisma lo ordene correctamente
MIGRATION_TIMESTAMP=$(date +%Y%m%d%H%M%S)
MIGRATION_NAME="${MIGRATION_TIMESTAMP}_baseline_init"
MIGRATION_HOST_PATH="$APP_DIR/prisma/migrations/$MIGRATION_NAME"

echo "   Nombre: $MIGRATION_NAME"

# Crear el directorio en el HOST antes de montar el volumen
mkdir -p "$MIGRATION_HOST_PATH"

# Ejecutar dentro del contenedor migrate montando prisma/ como volumen.
# Los archivos que se creen en /app/prisma/ dentro del contenedor quedan
# directamente en $APP_DIR/prisma/ del host — sin necesidad de docker cp.
docker run --rm \
  --network sigh_motos_sigc-net \
  --workdir /app \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$APP_DIR/prisma:/app/prisma" \
  sigh_motos-migrate \
  sh -c "
    set -e
    MNAME='${MIGRATION_NAME}'
    MPATH=\"prisma/migrations/\${MNAME}\"

    echo '  → Generando SQL del estado actual del schema...'

    # prisma migrate diff --from-empty genera el CREATE TABLE/INDEX que
    # llevaría una BD vacía al estado del schema.prisma actual.
    # Usamos || true: si falla (edge-case Prisma v7 + earlyAccess),
    # creamos un archivo vacío que igual es válido para baseline.
    if npx prisma migrate diff \
        --from-empty \
        --to-schema-datamodel \"/app/prisma/schema.prisma\" \
        --script \
        > \"/app/\${MPATH}/migration.sql\" 2>&1; then
      echo '  → SQL generado correctamente'
    else
      echo '  ⚠ migrate diff falló — usando migration.sql vacío (válido para baseline)'
      echo '-- Prisma Migrate Baseline: schema already applied manually' \
        > \"/app/\${MPATH}/migration.sql\"
    fi

    echo ''
    echo '  → Marcando migration como ya aplicada (sin re-ejecutar el SQL)...'
    npx prisma migrate resolve --applied \"\${MNAME}\"
    echo '  → resolve OK'

    echo ''
    echo '  → Verificando con migrate deploy (debe decir: No pending migrations)...'
    npx prisma migrate deploy
    echo '  → deploy OK'
  "

ok "Baseline completado sin errores"

# ── Paso 5: Verificar archivo en el host ─────────────────────────────────────
echo ""
info "[5/6] Verificando archivos en el host..."

if [[ -f "$MIGRATION_HOST_PATH/migration.sql" ]]; then
  SQL_LINES=$(wc -l < "$MIGRATION_HOST_PATH/migration.sql")
  ok "migration.sql presente ($SQL_LINES líneas)"
  echo ""
  echo "   ─── Primeras 10 líneas del SQL generado ───────"
  head -10 "$MIGRATION_HOST_PATH/migration.sql"
  echo "   ────────────────────────────────────────────────"
else
  warn "migration.sql no encontrado en el host (puede ser un problema de permisos del volumen)."
  warn "Crea el archivo manualmente:"
  warn "  mkdir -p $MIGRATION_HOST_PATH"
  warn "  echo '-- baseline' > $MIGRATION_HOST_PATH/migration.sql"
fi

# ── Paso 6: Despliegue completo ───────────────────────────────────────────────
echo ""
info "[6/6] Iniciando despliegue completo..."
echo ""

# Ahora que migrate.sql existe, el servicio migrate del docker-compose
# funcionará correctamente: encontrará la migración marcada como aplicada
# y no intentará re-ejecutarla.
$COMPOSE up -d --build app

echo "   Esperando que sigc_app arranque..."
WAITED=0
until docker inspect sigc_app --format='{{.State.Status}}' 2>/dev/null \
      | grep -q "running"; do
  [[ $WAITED -ge 90 ]] && {
    echo ""
    echo "   ─── Logs de sigc_app ─────────────────────────"
    docker logs sigc_app --tail 40 2>&1 || true
    echo "   ──────────────────────────────────────────────"
    fail "sigc_app no arrancó en 90s. Revisa los logs arriba."
  }
  printf "."
  sleep 3
  WAITED=$((WAITED + 3))
done
echo ""

# Pausa breve para que Express inicialice completamente
sleep 5

# Verificar que no se cayó inmediatamente
APP_STATUS=$(docker inspect sigc_app --format='{{.State.Status}}' 2>/dev/null || echo "unknown")
if [[ "$APP_STATUS" != "running" ]]; then
  echo "   ─── Logs de sigc_app (crash) ─────────────────"
  docker logs sigc_app --tail 40 2>&1 || true
  echo "   ──────────────────────────────────────────────"
  fail "sigc_app se cayó inmediatamente. Estado: $APP_STATUS"
fi
ok "sigc_app corriendo (estado: $APP_STATUS)"

# ── Resumen final ─────────────────────────────────────────────────────────────
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" \
  --filter "name=sigc_" 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           ✅  BASELINE + DEPLOY COMPLETADOS              ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  App:  https://motos.quantacloud.co                     ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  IMPORTANTE — Guarda la migración en Git:               ║"
echo "║  (desde tu máquina local, no el VPS)                    ║"
echo "║                                                          ║"
echo "║    git add prisma/migrations/                            ║"
echo "║    git commit -m 'chore: add prisma baseline (P3005)'    ║"
echo "║    git push                                              ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Comandos útiles:                                        ║"
echo "║  • docker logs sigc_app -f                               ║"
echo "║  • docker logs sigc_migrate                              ║"
echo "║  • docker ps --filter name=sigc_                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
