#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  SIGC-Motos v2.0 — Script de despliegue en producción
#  Ejecutar desde: /opt/SIGH_MOTOS
#  Uso:            bash deploy.sh
#
#  Siempre carga las variables desde .env.production de forma explícita.
#  Nunca uses "docker compose up" sin --env-file en este proyecto.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/opt/SIGH_MOTOS"
ENV_FILE="$APP_DIR/.env.production"
COMPOSE_CMD="docker compose --env-file $ENV_FILE"

# ─── Colores para la salida ───────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}   ✓${NC} $*"; }
info() { echo -e "${BLUE}▶${NC}  $*"; }
warn() { echo -e "${YELLOW}   ⚠${NC}  $*"; }
fail() { echo -e "${RED}❌${NC} $*"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║      SIGC-Motos v2.0 — Despliegue en producción         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cd "$APP_DIR" || fail "No se puede acceder a $APP_DIR"

# ── Paso 1: Validar .env.production ──────────────────────────────────────────
info "[1/7] Validando variables de entorno..."

[[ ! -f "$ENV_FILE" ]] && fail "No se encontró $ENV_FILE"

# Leer las variables clave del archivo de forma segura (sin source completo)
get_env() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

DATABASE_URL_VAL=$(get_env DATABASE_URL)
JWT_SECRET_VAL=$(get_env JWT_SECRET)

[[ -z "$DATABASE_URL_VAL" ]] && \
  fail "DATABASE_URL no está definida en .env.production"
[[ "$DATABASE_URL_VAL" == *"CAMBIAR_ESTO"* ]] && \
  fail "DATABASE_URL aún tiene el placeholder <CAMBIAR_ESTO>. Reemplázalo con tu contraseña real."
[[ -z "$JWT_SECRET_VAL" ]] && \
  fail "JWT_SECRET no está definida en .env.production"
[[ "$JWT_SECRET_VAL" == *"CAMBIAR_ESTO"* ]] && \
  fail "JWT_SECRET aún tiene el placeholder <CAMBIAR_ESTO>. Genera una clave con: openssl rand -base64 64"

ok "DATABASE_URL presente y sin placeholders"
ok "JWT_SECRET presente y sin placeholders"

# ── Paso 2: Detener contenedores actuales ────────────────────────────────────
info "[2/7] Deteniendo contenedores existentes..."

$COMPOSE_CMD down --remove-orphans 2>/dev/null || true
ok "Contenedores detenidos"

# ── Paso 3: Levantar SOLO la base de datos y esperar a que esté saludable ────
info "[3/7] Iniciando base de datos (sigc_db)..."

$COMPOSE_CMD up -d --build db
echo "   Esperando healthcheck de sigc_db..."

MAX_WAIT=60
WAITED=0
until docker inspect sigc_db --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; do
  if [[ $WAITED -ge $MAX_WAIT ]]; then
    fail "sigc_db no alcanzó estado 'healthy' en ${MAX_WAIT}s.\n   Revisa los logs: docker logs sigc_db"
  fi
  printf "."
  sleep 2
  WAITED=$((WAITED + 2))
done
echo ""
ok "sigc_db está healthy"

# ── Paso 4: Ejecutar migraciones Prisma ──────────────────────────────────────
info "[4/7] Ejecutando migraciones Prisma..."

# Ejecutar migrate. Si falla, mostramos los logs y preguntamos si continuar.
if $COMPOSE_CMD run --rm \
     -e DATABASE_URL="$DATABASE_URL_VAL" \
     migrate; then
  ok "Migraciones aplicadas correctamente"
else
  MIGRATE_EXIT=$?
  echo ""
  warn "El servicio migrate terminó con error (exit $MIGRATE_EXIT)."
  echo ""
  echo "   ─── Últimas líneas del log de migrate ───"
  docker logs sigc_migrate 2>&1 | tail -30 || true
  echo "   ─────────────────────────────────────────"
  echo ""
  echo -n "   ¿Continuar el despliegue de todas formas? (las tablas ya existen) [s/N]: "
  read -r CONTINUAR
  [[ "$CONTINUAR" != "s" && "$CONTINUAR" != "S" ]] && \
    fail "Despliegue cancelado. Corrige el error de migrate antes de continuar."
  warn "Continuando sin migrate. Asegúrate de que el esquema esté actualizado."
fi

# ── Paso 5: Construir y levantar el backend ───────────────────────────────────
info "[5/7] Construyendo e iniciando sigc_app..."

$COMPOSE_CMD up -d --build app
echo "   Esperando que sigc_app esté corriendo y saludable..."

MAX_WAIT=90
WAITED=0
until docker inspect sigc_app --format='{{.State.Status}}' 2>/dev/null | grep -q "running"; do
  if [[ $WAITED -ge $MAX_WAIT ]]; then
    echo ""
    echo "   ─── Logs de sigc_app ───"
    docker logs sigc_app --tail 50 2>&1 || true
    echo "   ────────────────────────"
    fail "sigc_app no arrancó en ${MAX_WAIT}s. Revisa los logs arriba."
  fi
  printf "."
  sleep 3
  WAITED=$((WAITED + 3))
done
echo ""

# Espera adicional para que Express inicialice
sleep 5

# Verificar que el proceso sigue corriendo (no se cayó inmediatamente)
APP_STATUS=$(docker inspect sigc_app --format='{{.State.Status}}' 2>/dev/null)
if [[ "$APP_STATUS" != "running" ]]; then
  echo "   ─── Logs de sigc_app (crash inmediato) ───"
  docker logs sigc_app --tail 50 2>&1 || true
  echo "   ──────────────────────────────────────────"
  fail "sigc_app se detuvo inmediatamente. Estado: $APP_STATUS"
fi
ok "sigc_app está corriendo (estado: $APP_STATUS)"

# ── Paso 6: Verificar endpoint /health ───────────────────────────────────────
info "[6/7] Verificando endpoint /health..."

HEALTH_OK=false
for i in 1 2 3 4 5; do
  HTTP_CODE=$(docker exec sigc_app \
    node -e "
      require('http').get('http://localhost:3000/health', r => {
        process.stdout.write(String(r.statusCode));
        process.exit(0);
      }).on('error', () => { process.stdout.write('0'); process.exit(1); });
    " 2>/dev/null || echo "0")

  if [[ "$HTTP_CODE" == "200" ]]; then
    HEALTH_OK=true
    break
  fi
  echo "   Intento $i/5 — código HTTP: $HTTP_CODE — esperando 5s..."
  sleep 5
done

if $HEALTH_OK; then
  ok "Endpoint /health responde HTTP 200"
else
  warn "El endpoint /health no respondió 200 en 5 intentos."
  warn "La app puede estar iniciando aún. Verifica manualmente:"
  warn "  docker exec sigc_app wget -qO- http://localhost:3000/health"
fi

# ── Paso 7: Resumen ───────────────────────────────────────────────────────────
info "[7/7] Resumen del despliegue..."
echo ""

docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" \
  --filter "name=sigc_" 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           ✅  DESPLIEGUE COMPLETADO                      ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  App:  https://motos.quantacloud.co                     ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Comandos útiles:                                        ║"
echo "║  • Ver logs app:    docker logs sigc_app -f              ║"
echo "║  • Ver logs db:     docker logs sigc_db -f               ║"
echo "║  • Estado:          docker ps --filter name=sigc_        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
