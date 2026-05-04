#!/usr/bin/env bash
# =============================================================================
#  fix-nginx.sh — Repara Nginx cuando no escucha en puertos 80/443
#
#  Ejecutar en el VPS como root:
#    cd /opt/SIGH_MOTOS
#    sudo bash scripts/fix-nginx.sh
#
#  Qué hace:
#   1. Genera certificado SSL autofirmado si no existe
#   2. Abre los puertos en el firewall
#   3. Recrea los contenedores con la configuración correcta
#   4. Valida que todo funcione
# =============================================================================
set -euo pipefail

PROJECT_DIR="/opt/SIGH_MOTOS"
ENV_FILE=".env.production"
COMPOSE="docker compose"

log()  { echo -e "\033[0;34m[$(date '+%H:%M:%S')] $*\033[0m"; }
ok()   { echo -e "\033[0;32m[$(date '+%H:%M:%S')] ✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m[$(date '+%H:%M:%S')] ! $*\033[0m"; }
die()  { echo -e "\033[0;31m[$(date '+%H:%M:%S')] ERROR: $*\033[0m"; exit 1; }

[[ $EUID -ne 0 ]] && die "Ejecutar como root: sudo bash scripts/fix-nginx.sh"
[[ -d "$PROJECT_DIR" ]] || die "Directorio $PROJECT_DIR no encontrado"

cd "$PROJECT_DIR"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  SIGC-Motos — Reparación de Nginx"
echo "══════════════════════════════════════════════════════"
echo ""

# ── Paso 1: Certificado SSL autofirmado ───────────────────────────────────────
log "Paso 1/5 — Verificando certificado SSL..."
if [[ ! -f "ssl/server.crt" || ! -f "ssl/server.key" ]]; then
    mkdir -p ssl
    bash scripts/generate-ssl.sh
else
    ok "Certificado SSL ya existe"
fi

# ── Paso 2: Firewall ──────────────────────────────────────────────────────────
log "Paso 2/5 — Configurando firewall..."
if command -v ufw &>/dev/null; then
    ufw allow 80/tcp  &>/dev/null || true
    ufw allow 443/tcp &>/dev/null || true
    ufw --force enable &>/dev/null || true
    ok "UFW: puertos 80 y 443 abiertos"
else
    warn "UFW no instalado — asegúrate que el proveedor VPS tenga abiertos los puertos 80 y 443"
fi

# ── Paso 3: Bajar contenedores ────────────────────────────────────────────────
log "Paso 3/5 — Reiniciando contenedores..."
${COMPOSE} --env-file "${ENV_FILE}" down --remove-orphans 2>/dev/null || \
    ${COMPOSE} down --remove-orphans 2>/dev/null || true

# Limpiar redes huérfanas que bloqueen la recreación
docker network prune -f &>/dev/null || true

# ── Paso 4: Levantar todo ─────────────────────────────────────────────────────
log "Paso 4/5 — Levantando servicios (esto toma ~30 segundos)..."
if [[ -f "${ENV_FILE}" ]]; then
    ${COMPOSE} --env-file "${ENV_FILE}" up -d
else
    warn ".env.production no encontrado — usando variables de entorno del sistema"
    ${COMPOSE} up -d
fi

log "Esperando que los servicios estén saludables..."
sleep 30

# ── Paso 5: Validación ────────────────────────────────────────────────────────
log "Paso 5/5 — Validando..."
echo ""

echo "=== PUERTOS EXPUESTOS ==="
docker port sigc_nginx 2>/dev/null || warn "sigc_nginx no responde a docker port"

echo ""
echo "=== ESTADO DE CONTENEDORES ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "=== PUERTOS ESCUCHANDO EN EL HOST ==="
ss -tlnp | grep -E ':(80|443)\s' || warn "No se detectan puertos 80/443 escuchando"

echo ""
echo "=== PRUEBA HTTPS LOCAL ==="
HTTP_CODE=$(curl -sk https://localhost/ -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
    ok "Frontend responde: HTTP $HTTP_CODE"
elif [[ "$HTTP_CODE" == "000" ]]; then
    warn "Frontend no responde (HTTP 000) — revisa logs: docker logs sigc_nginx --tail 20"
else
    ok "Nginx responde: HTTP $HTTP_CODE (esperado para rutas autenticadas)"
fi

echo ""
echo "=== PRUEBA API ==="
API_CODE=$(curl -sk https://localhost/api/v1/users -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
if [[ "$API_CODE" =~ ^(200|401|403)$ ]]; then
    ok "API responde: HTTP $API_CODE"
else
    warn "API respondió HTTP $API_CODE — puede que el backend aún esté iniciando"
fi

echo ""
echo "=== PRUEBA IP PÚBLICA ==="
PUBLIC_IP="79.143.181.220"
PUB_CODE=$(curl -sk --max-time 10 "https://${PUBLIC_IP}/" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
if [[ "$PUB_CODE" == "200" ]]; then
    ok "Accesible desde internet: https://${PUBLIC_IP}/"
elif [[ "$PUB_CODE" == "000" ]]; then
    warn "No accesible desde internet — verifica que el proveedor VPS permita puertos 80 y 443"
else
    ok "Respondió HTTP $PUB_CODE desde internet"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Reparación completada."
echo ""
echo "  URL de acceso: https://${PUBLIC_IP}/"
echo "  El navegador mostrará advertencia SSL (certificado autofirmado) — es normal."
echo "  Haz clic en 'Avanzado' → 'Continuar de todas formas' para acceder."
echo ""
echo "  Logs en tiempo real:"
echo "    docker logs -f sigc_nginx"
echo "    docker logs -f sigc_app"
echo "══════════════════════════════════════════════════════"
