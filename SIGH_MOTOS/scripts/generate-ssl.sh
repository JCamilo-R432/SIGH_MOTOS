#!/usr/bin/env bash
# =============================================================================
#  generate-ssl.sh — Genera certificado SSL autofirmado para SIGC-Motos
#
#  Uso: sudo bash scripts/generate-ssl.sh
#
#  Crea ./ssl/server.crt y ./ssl/server.key
#  Válido por 10 años. El navegador mostrará advertencia (normal para IP directa).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SSL_DIR="$PROJECT_DIR/ssl"
VPS_IP="79.143.181.220"

log()  { echo -e "\033[0;34m[SSL] $*\033[0m"; }
ok()   { echo -e "\033[0;32m[SSL] ✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m[SSL] ⚠  $*\033[0m"; }

log "Generando certificado SSL autofirmado..."
log "Directorio: $SSL_DIR"

mkdir -p "$SSL_DIR"

if [[ -f "$SSL_DIR/server.crt" && -f "$SSL_DIR/server.key" ]]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$SSL_DIR/server.crt" 2>/dev/null | cut -d= -f2 || echo "desconocido")
    warn "Ya existe un certificado (expira: $EXPIRY). Regenerando de todas formas..."
fi

openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "$SSL_DIR/server.key" \
    -out    "$SSL_DIR/server.crt" \
    -subj   "/C=CO/ST=Bogota/L=Bogota/O=SIGC-Motos/CN=$VPS_IP" \
    -addext "subjectAltName=IP:$VPS_IP,DNS:motos.quantacloud.co,DNS:www.motos.quantacloud.co" \
    2>/dev/null

chmod 600 "$SSL_DIR/server.key"
chmod 644 "$SSL_DIR/server.crt"

ok "Certificado creado: $SSL_DIR/server.crt"
ok "Clave privada creada: $SSL_DIR/server.key"
log ""
log "NOTA: El navegador mostrará advertencia de seguridad (certificado autofirmado)."
log "      Haz clic en 'Avanzado' → 'Continuar' para acceder."
log ""
log "Para evitar la advertencia, obtén un certificado real con:"
log "   bash scripts/deploy.sh --init  (requiere dominio apuntando al VPS)"
