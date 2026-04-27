#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — Despliegue completo de SIGC-Motos v2.0 en VPS Ubuntu 24.04
#
#  VPS:     79.143.181.220
#  Dominio: motos.quantacloud.co
#  Email:   jriveracl@unal.edu.co (Let's Encrypt)
#
#  PRIMER DESPLIEGUE:  sudo bash deploy.sh --init
#  ACTUALIZACIÓN:      sudo bash deploy.sh
# =============================================================================
set -euo pipefail

# ── Configuración ─────────────────────────────────────────────────────────────
PROJECT_DIR="/opt/SIGH_MOTOS"
DOMAIN="motos.quantacloud.co"
EMAIL="jriveracl@unal.edu.co"
COMPOSE="docker compose"
ENV_FILE=".env.production"

# ── Colores ───────────────────────────────────────────────────────────────────
log()  { echo -e "\033[0;34m[$(date '+%H:%M:%S')] ℹ  $*\033[0m"; }
ok()   { echo -e "\033[0;32m[$(date '+%H:%M:%S')] ✅ $*\033[0m"; }
warn() { echo -e "\033[1;33m[$(date '+%H:%M:%S')] ⚠  $*\033[0m"; }
die()  { echo -e "\033[0;31m[$(date '+%H:%M:%S')] ❌ $*\033[0m"; exit 1; }

# ── Verificar root ─────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Ejecuta como root: sudo bash deploy.sh [--init]"

# ── Ir al directorio del proyecto ─────────────────────────────────────────────
[[ -d "${PROJECT_DIR}" ]] || die "Directorio ${PROJECT_DIR} no existe. Ve la sección PASO 2 más abajo."
cd "${PROJECT_DIR}"

# ════════════════════════════════════════════════════════════════════════════
# MODO --init: PRIMERA INSTALACIÓN COMPLETA CON SSL
# ════════════════════════════════════════════════════════════════════════════
if [[ "${1:-}" == "--init" ]]; then

  log "════════════════════════════════════════════════════════════"
  log " SIGC-Motos v2.0 — INICIALIZACIÓN COMPLETA"
  log " VPS: 79.143.181.220 | Dominio: ${DOMAIN}"
  log "════════════════════════════════════════════════════════════"

  # PASO 1: Verificar dependencias
  log "Paso 1/8 — Verificando Docker..."
  command -v docker      > /dev/null || die "Docker no instalado. Ejecuta: apt install -y docker.io"
  ${COMPOSE} version     > /dev/null || die "Plugin docker compose no encontrado."
  ok "Docker OK"

  # PASO 2: Crear estructura de directorios
  log "Paso 2/8 — Creando directorios..."
  mkdir -p nginx/conf.d uploads logs backups/db
  chmod 700 backups/db
  ok "Directorios creados"

  # PASO 3: Verificar .env.production
  log "Paso 3/8 — Verificando variables de entorno..."
  [[ -f "${ENV_FILE}" ]] || die ".env.production no encontrado. Copia la plantilla y rellena los valores:\n  cp .env.production.example .env.production && nano .env.production"
  grep -q "CAMBIAR_ESTO" "${ENV_FILE}" && die ".env.production aún tiene valores de plantilla. Edítalo primero:\n  nano .env.production"
  ok ".env.production OK"

  # PASO 4: Build del frontend React
  log "Paso 4/8 — Compilando frontend React..."
  if command -v node > /dev/null && [[ -d frontend ]]; then
    cd frontend
    npm ci --silent
    npm run build
    cd ..
    ok "Frontend compilado en frontend/dist/"
  else
    warn "Node.js no encontrado en el VPS. El frontend debe compilarse localmente y subirse."
    warn "Ejecuta en tu máquina: cd frontend && npm run build && scp -r dist/ root@79.143.181.220:/opt/SIGH_MOTOS/frontend/"
  fi

  # PASO 5: Nginx temporal (HTTP only) para obtener el certificado SSL
  log "Paso 5/8 — Configurando Nginx temporal para validación Let's Encrypt..."
  cat > nginx/conf.d/default.conf << 'NGINX_TMP'
server {
    listen 80;
    server_name motos.quantacloud.co www.motos.quantacloud.co;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 'SIGC-Motos v2.0 OK'; add_header Content-Type text/plain; }
}
NGINX_TMP

  log "Levantando Nginx y DB (sin app aún)..."
  ${COMPOSE} --env-file "${ENV_FILE}" up -d db nginx certbot
  sleep 10

  # PASO 6: Obtener certificado SSL con Let's Encrypt
  log "Paso 6/8 — Obteniendo certificado SSL para ${DOMAIN}..."
  log "  Verificando conectividad al dominio..."

  if ! curl -sf "http://${DOMAIN}/" > /dev/null 2>&1; then
    warn "El dominio ${DOMAIN} no responde. Verifica:"
    warn "  1. El Registro A en Namecheap apunta a 79.143.181.220"
    warn "  2. El puerto 80 no está bloqueado por el firewall del VPS"
    warn "  3. Espera hasta 48h para propagación DNS"
    die "Abortando: DNS no resuelve correctamente."
  fi

  ${COMPOSE} run --rm certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email "${EMAIL}" \
    --agree-tos \
    --no-eff-email \
    -d "${DOMAIN}" \
    -d "www.${DOMAIN}" \
    || die "Certbot falló. Revisa los logs: docker compose logs certbot"

  ok "Certificado SSL obtenido: /etc/letsencrypt/live/${DOMAIN}/"

  # PASO 7: Restaurar nginx.conf con HTTPS real y levantar todo
  log "Paso 7/8 — Activando HTTPS y levantando stack completo..."
  # La config HTTPS ya está en nginx/conf.d/default.conf (parte del repositorio)
  # Si fue sobreescrita en el paso 5, la restauramos:
  git checkout nginx/conf.d/default.conf 2>/dev/null || true

  ${COMPOSE} --env-file "${ENV_FILE}" up -d --build
  log "Esperando que todos los servicios estén saludables..."
  sleep 30

  # PASO 8: Configurar Cron Jobs automáticos
  log "Paso 8/8 — Configurando cron jobs..."

  # Backup diario a las 2:00 AM
  CRON_BACKUP="0 2 * * * /opt/SIGH_MOTOS/scripts/backup-db.sh >> /var/log/sigc-backup.log 2>&1"
  (crontab -l 2>/dev/null | grep -v "backup-db.sh"; echo "${CRON_BACKUP}") | crontab -
  chmod +x "${PROJECT_DIR}/scripts/backup-db.sh"
  ok "Cron backup diario (2 AM) configurado"

  # Renovación SSL: Certbot corre automáticamente dentro de su contenedor (cada 12h)
  ok "Renovación SSL automática activa (cada 12h via contenedor certbot)"

  # ── Verificación final ────────────────────────────────────────────────────────
  log "════════════════════════════════════════════════════════════"
  ok " ✅ SIGC-Motos v2.0 desplegado exitosamente"
  log ""
  log " 🌐 URL:       https://${DOMAIN}"
  log " 🏥 Health:    https://${DOMAIN}/health"
  log " 📋 Logs:      docker compose logs -f app"
  log " 💾 Backups:   ${PROJECT_DIR}/backups/db/"
  log ""
  log " Verificación:"
  log "   curl -s https://${DOMAIN}/health"
  log "   docker compose ps"
  log "════════════════════════════════════════════════════════════"
  exit 0
fi

# ════════════════════════════════════════════════════════════════════════════
# MODO ACTUALIZACIÓN (sin --init)
# ════════════════════════════════════════════════════════════════════════════
log "════════════════════════════════════════════════════════════"
log " SIGC-Motos v2.0 — ACTUALIZACIÓN"
log "════════════════════════════════════════════════════════════"

# Pull cambios
log "Actualizando código fuente..."
git pull origin main || warn "git pull falló (modo offline). Usando código local."

# Compilar frontend
if [[ -d frontend ]]; then
  log "Recompilando frontend..."
  cd frontend && npm ci --silent && npm run build && cd ..
fi

# Rebuild del contenedor app (sin reconstruir db ni nginx)
log "Reconstruyendo contenedor app..."
${COMPOSE} --env-file "${ENV_FILE}" build --no-cache app

# Levantar todo
log "Reiniciando servicios..."
${COMPOSE} --env-file "${ENV_FILE}" up -d

# Migraciones de BD
log "Aplicando migraciones..."
${COMPOSE} --env-file "${ENV_FILE}" run --rm migrate || warn "Sin migraciones nuevas."

# Reload Nginx sin downtime
log "Recargando Nginx..."
${COMPOSE} exec nginx nginx -s reload 2>/dev/null || true

ok "════════════════════════════════════════════════════════════"
ok " Actualización completada. URL: https://${DOMAIN}"
ok "════════════════════════════════════════════════════════════"
