#!/usr/bin/env bash
# =============================================================================
# restore-db.sh — Restauración de backup PostgreSQL
# Proyecto: SIGC-Motos | Clavijos Motos S.A.S.
#
# Uso: ./scripts/restore-db.sh <backup_file.sql.gz>
# Ej:  ./scripts/restore-db.sh backups/db/sigc_backup_20260426_020001.sql.gz
#
# ⚠️  ADVERTENCIA: Detiene la app brevemente y reemplaza TODA la base de datos.
# =============================================================================
set -euo pipefail

# ── Paths ──────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/SIGH_MOTOS"
ENV_FILE="${PROJECT_DIR}/.env"
LOG_FILE="/var/log/sigc-backup.log"
COMPOSE_CMD="docker compose"

# ── Validate argument ────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <archivo_backup.sql.gz>"
  echo "Ej:  $0 backups/db/sigc_backup_20260426_020001.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"

# Resolve relative path from project dir
if [[ "${BACKUP_FILE}" != /* ]]; then
  BACKUP_FILE="${PROJECT_DIR}/${BACKUP_FILE}"
fi

# ── Log helper ───────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }
log_fail() { log "❌ ERROR: $*"; }
log_ok() { log "✅ $*"; }

# ── Load env ────────────────────────────────────────────────────────────────
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  source <(grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=' "${ENV_FILE}" || true)
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-sigc_user}"
POSTGRES_DB="${POSTGRES_DB:-sigc_db}"

# ── Validate backup file ─────────────────────────────────────────────────────
if [[ ! -f "${BACKUP_FILE}" ]]; then
  log_fail "Archivo no encontrado: ${BACKUP_FILE}"
  exit 1
fi

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" 2>/dev/null | cut -f1)
log "================================================================"
log "SIGC-Motos — Iniciando RESTAURACIÓN de base de datos"
log "Archivo: ${BACKUP_FILE} (${BACKUP_SIZE})"
log ""
log "⚠️  Esta operación reemplazará TODOS los datos actuales."
log "⚠️  La aplicación se detendrá brevemente."
log ""

# ── Interactive confirmation (skip with FORCE=1) ─────────────────────────────
if [[ "${FORCE:-}" != "1" ]]; then
  read -r -p "¿Continuar? Escribe 'SI' para confirmar: " CONFIRM
  if [[ "${CONFIRM}" != "SI" ]]; then
    log "Restauración cancelada por el usuario."
    exit 0
  fi
fi

cd "${PROJECT_DIR}"

# ── Step 1: Stop app (keep DB running) ───────────────────────────────────────
log "Paso 1/5: Deteniendo la aplicación..."
if ${COMPOSE_CMD} stop app 2>/dev/null; then
  log_ok "Aplicación detenida."
else
  log "  (No se pudo detener app — puede que no esté corriendo. Continuando.)"
fi

# ── Step 2: Drop & recreate DB or clear tables ───────────────────────────────
log "Paso 2/5: Preparando base de datos para restauración..."

# The dump was created with --clean --if-exists so it handles this itself.
# We just need to ensure the database exists.
${COMPOSE_CMD} exec -T sigc_db psql \
  --username="${POSTGRES_USER}" \
  --dbname="postgres" \
  -c "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}';" \
  > /dev/null 2>&1 || {
  ${COMPOSE_CMD} exec -T sigc_db createdb \
    --username="${POSTGRES_USER}" "${POSTGRES_DB}" || true
}
log_ok "Base de datos verificada."

# ── Step 3: Restore dump ──────────────────────────────────────────────────────
log "Paso 3/5: Restaurando datos (esto puede tardar varios minutos)..."

if gunzip -c "${BACKUP_FILE}" | \
   ${COMPOSE_CMD} exec -T sigc_db \
     psql \
       --username="${POSTGRES_USER}" \
       --dbname="${POSTGRES_DB}" \
       --set ON_ERROR_STOP=0 \
       --quiet \
   >> "${LOG_FILE}" 2>&1; then
  log_ok "Datos restaurados exitosamente."
else
  log_fail "Error durante la restauración. Revisar: ${LOG_FILE}"
  log "Intentando reiniciar la aplicación de todas formas..."
  ${COMPOSE_CMD} start app 2>/dev/null || true
  exit 1
fi

# ── Step 4: Restart app ──────────────────────────────────────────────────────
log "Paso 4/5: Reiniciando la aplicación..."
if ${COMPOSE_CMD} start app; then
  log_ok "Aplicación iniciada."
else
  log_fail "No se pudo iniciar la aplicación. Intentar: docker compose up -d app"
  exit 1
fi

# ── Step 5: Validate connectivity ────────────────────────────────────────────
log "Paso 5/5: Validando conectividad de base de datos..."
sleep 5  # Wait for app to come up

for attempt in 1 2 3 4 5; do
  if ${COMPOSE_CMD} exec -T sigc_db \
      psql --username="${POSTGRES_USER}" --dbname="${POSTGRES_DB}" \
      -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
      > /dev/null 2>&1; then
    log_ok "Base de datos accesible. Restauración completada con éxito."
    break
  fi
  log "  Intento ${attempt}/5 — esperando..."
  sleep 3
  if [[ ${attempt} -eq 5 ]]; then
    log_fail "La BD no responde después de varios intentos. Verificar manualmente."
    exit 1
  fi
done

log "================================================================"
log "✅ RESTAURACIÓN COMPLETADA EXITOSAMENTE."
log "   Archivo restaurado: ${BACKUP_FILE}"
log "================================================================"
exit 0
