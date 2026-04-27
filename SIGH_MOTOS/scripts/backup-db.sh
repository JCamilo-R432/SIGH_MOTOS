#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — Backup automático de PostgreSQL (pg_dump en caliente)
# Proyecto: SIGC-Motos | Clavijos Motos S.A.S.
# Ejecutar: /opt/SIGH_MOTOS/scripts/backup-db.sh
# Cron:     0 2 * * * /opt/SIGH_MOTOS/scripts/backup-db.sh >> /var/log/sigc-backup.log 2>&1
# =============================================================================
set -euo pipefail

# ── Paths ──────────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/SIGH_MOTOS"
BACKUP_DIR="${PROJECT_DIR}/backups/db"
ENV_FILE="${PROJECT_DIR}/.env"
LOG_FILE="/var/log/sigc-backup.log"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/sigc_backup_${TIMESTAMP}.sql.gz"
COMPOSE_CMD="docker compose"

# ── Load env ────────────────────────────────────────────────────────────────
if [[ -f "${ENV_FILE}" ]]; then
  # Export only DB-related vars, skip lines starting with # or blank
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB)=' "${ENV_FILE}" || true)
  set +a
fi

# Fallback defaults
POSTGRES_USER="${POSTGRES_USER:-sigc_user}"
POSTGRES_DB="${POSTGRES_DB:-sigc_db}"

# ── Log helper ───────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log_fail() { log "❌ ERROR: $*"; }
log_ok() { log "✅ $*"; }

# ── Create backup dir ────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

log "================================================================"
log "SIGC-Motos — Iniciando backup de base de datos"
log "Archivo destino: ${BACKUP_FILE}"

# ── Verify DB container is running ──────────────────────────────────────────
cd "${PROJECT_DIR}"

if ! ${COMPOSE_CMD} ps sigc_db 2>/dev/null | grep -q "running\|Up"; then
  log_fail "El contenedor sigc_db no está corriendo. Abortando backup."
  # Send email notification if mail is available
  if command -v mail &>/dev/null; then
    echo "SIGC-Motos backup FALLÓ: contenedor sigc_db no disponible en $(hostname)" \
      | mail -s "❌ SIGC-Motos Backup FALLÓ - $(date '+%Y-%m-%d')" root 2>/dev/null || true
  fi
  exit 1
fi

# ── Create dump (hot backup — no downtime) ───────────────────────────────────
log "Ejecutando pg_dump..."

if ${COMPOSE_CMD} exec -T sigc_db \
    pg_dump \
      --username="${POSTGRES_USER}" \
      --dbname="${POSTGRES_DB}" \
      --clean \
      --if-exists \
      --no-password \
      --format=plain \
      --verbose 2>>"${LOG_FILE}" \
    | gzip -9 > "${BACKUP_FILE}"; then

  BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" 2>/dev/null | cut -f1)
  log_ok "Backup creado exitosamente: ${BACKUP_FILE} (${BACKUP_SIZE})"

else
  log_fail "pg_dump falló. Eliminando archivo incompleto."
  rm -f "${BACKUP_FILE}"

  if command -v mail &>/dev/null; then
    echo "SIGC-Motos pg_dump FALLÓ en $(hostname) — $(date)" \
      | mail -s "❌ SIGC-Motos Backup FALLÓ" root 2>/dev/null || true
  fi
  exit 1
fi

# ── Verify backup is non-empty ────────────────────────────────────────────────
BACKUP_BYTES=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "0")
if [[ "${BACKUP_BYTES}" -lt 1024 ]]; then
  log_fail "El archivo de backup parece vacío (${BACKUP_BYTES} bytes). Verificar."
  exit 1
fi

# ── Clean old backups (retención ${RETENTION_DAYS} días) ────────────────────
log "Limpiando backups de más de ${RETENTION_DAYS} días..."
DELETED=$(find "${BACKUP_DIR}" -name "sigc_backup_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l)
[[ "${DELETED}" -gt 0 ]] && log "  Eliminados: ${DELETED} archivos antiguos" || log "  Sin archivos para eliminar"

# ── List current backups ──────────────────────────────────────────────────────
log "Backups disponibles en ${BACKUP_DIR}:"
find "${BACKUP_DIR}" -name "sigc_backup_*.sql.gz" -printf "  %f (%k KB)\n" 2>/dev/null | sort || \
  ls -lh "${BACKUP_DIR}"/sigc_backup_*.sql.gz 2>/dev/null | awk '{print "  "$NF" ("$5")"}' || true

log "================================================================"
log "Backup completado exitosamente."
exit 0
