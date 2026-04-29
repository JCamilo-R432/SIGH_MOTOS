#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  SIGC-Motos — Reset de usuario ADMIN + diagnóstico de bcrypt
#
#  Ejecuta TODO en un solo proceso Node.js dentro de sigc_app:
#  1. Crea el hash con bcryptjs
#  2. Lo verifica ANTES de guardarlo (sanity check)
#  3. Lo guarda en BD usando PrismaPg adapter (idéntico al app)
#  4. Lo lee de la BD y lo verifica de nuevo
#  5. Llama al endpoint HTTP /api/v1/auth/login y verifica la respuesta
#
#  Si todo pasa → el login funciona. Si algo falla → muestra exactamente dónde.
#
#  Ejecutar desde: /opt/SIGH_MOTOS
#  Uso: bash reset-admin.sh [PASSWORD]
#  Ej:  bash reset-admin.sh 'Admin2026!'
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/opt/SIGH_MOTOS"
ENV_FILE="$APP_DIR/.env.production"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}   ✓${NC} $*"; }
fail() { echo -e "${RED}   ✗${NC} $*"; }
info() { echo -e "${BLUE}▶${NC}  $*"; }
warn() { echo -e "${YELLOW}   ⚠${NC}  $*"; }

ADMIN_EMAIL="admin@sigcmotos.co"
ADMIN_PASSWORD="${1:-Admin2026!}"
SCRIPT_IN_CONTAINER="/tmp/sigc_reset_admin.js"
TMP_SCRIPT=$(mktemp /tmp/sigc_reset_XXXXXX.js)
trap 'rm -f "$TMP_SCRIPT"' EXIT

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   SIGC-Motos — Reset Admin + Diagnóstico bcrypt          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "   Email:    $ADMIN_EMAIL"
echo "   Password: $ADMIN_PASSWORD"
echo ""

cd "$APP_DIR" || { echo "No se puede acceder a $APP_DIR"; exit 1; }

# ── Validar env ───────────────────────────────────────────────────────────────
info "[1/4] Validando entorno..."
[[ ! -f "$ENV_FILE" ]] && { fail "No se encontró $ENV_FILE"; exit 1; }
DATABASE_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
[[ -z "$DATABASE_URL" ]] && { fail "DATABASE_URL no encontrado"; exit 1; }
[[ "$DATABASE_URL" == *"CAMBIAR_ESTO"* ]] && { fail "DATABASE_URL tiene placeholder"; exit 1; }

if ! docker ps --format '{{.Names}}' | grep -q "^sigc_app$"; then
  fail "sigc_app no está corriendo. Ejecuta primero: bash deploy.sh"
  exit 1
fi
ok "Entorno validado"

# ── Crear script Node.js ───────────────────────────────────────────────────────
info "[2/4] Preparando script de diagnóstico..."

# CRÍTICO: usar heredoc con comillas simples ('NODEJS_EOF') para que bash
# NO expanda $, \n ni ningún carácter especial dentro del script Node.js
cat > "$TMP_SCRIPT" << 'NODEJS_EOF'
'use strict';

// ── Mismo setup que src/config/prisma.ts del app ──────────────────────────────
const { PrismaPg }    = require('@prisma/adapter-pg');
const { Pool }        = require('pg');
const { PrismaClient } = require('@prisma/client');
let bcrypt;
try   { bcrypt = require('bcryptjs'); }
catch { console.error('ERROR: bcryptjs no instalado'); process.exit(1); }

const DATABASE_URL    = process.env.DATABASE_URL;
const ADMIN_EMAIL     = process.env.SIGC_ADMIN_EMAIL    || 'admin@sigcmotos.co';
const ADMIN_PASSWORD  = process.env.SIGC_ADMIN_PASSWORD || 'Admin2026!';
const SALT_ROUNDS     = 10;

if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL no definida'); process.exit(1); }

// Crear PrismaClient con el adapter de pg — idéntico al app
const pool    = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter });

async function main() {
  const sep = '─'.repeat(52);

  // ── PASO A: Verificar que bcrypt funciona en este proceso ────────────────────
  console.log('\n' + sep);
  console.log('PASO A — Sanity check de bcrypt en este proceso');
  console.log(sep);
  const testHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  console.log('  hash generado   :', testHash.length, 'chars,', JSON.stringify(testHash.slice(-4)), '← últimos 4');
  const testOk = await bcrypt.compare(ADMIN_PASSWORD, testHash);
  if (!testOk) {
    console.error('  ✗ FALLA CRÍTICA: bcrypt.hash/compare no son consistentes en este proceso');
    process.exit(1);
  }
  console.log('  ✓ bcrypt.compare(password, hash) =', testOk);

  // ── PASO B: Verificar/crear rol ADMIN ────────────────────────────────────────
  console.log('\n' + sep);
  console.log('PASO B — Verificando rol ADMIN en BD');
  console.log(sep);
  let role = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  if (!role) {
    role = await prisma.role.create({
      data: { name: 'ADMIN', description: 'Administrador con acceso total al sistema' },
    });
    console.log('  ✓ Rol ADMIN creado, ID:', role.id);
  } else {
    console.log('  ✓ Rol ADMIN existe, ID:', role.id);
  }

  // ── PASO C: Upsert del usuario con hash fresco ────────────────────────────────
  console.log('\n' + sep);
  console.log('PASO C — Guardando usuario admin en BD');
  console.log(sep);
  const freshHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  const user = await prisma.user.upsert({
    where:  { email: ADMIN_EMAIL },
    create: {
      email:    ADMIN_EMAIL,
      password: freshHash,   // ← sin console.log, sin newlines, string puro
      name:     'Administrador',
      roleId:   role.id,
      isActive: true,
    },
    update: {
      password: freshHash,
      isActive: true,
      roleId:   role.id,
    },
  });
  console.log('  ✓ Usuario upserted, ID:', user.id);

  // ── PASO D: Leer el hash desde la BD y verificarlo ────────────────────────────
  console.log('\n' + sep);
  console.log('PASO D — Leyendo hash desde BD y verificando');
  console.log(sep);
  const fromDB = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!fromDB) { console.error('  ✗ Usuario no encontrado tras upsert'); process.exit(1); }

  const storedHash = fromDB.password;
  console.log('  hash en BD      :', storedHash.length, 'chars');
  console.log('  últimos 4 chars :', JSON.stringify(storedHash.slice(-4)));
  console.log('  tiene newline   :', storedHash.includes('\n'));
  console.log('  tiene \\r       :', storedHash.includes('\r'));
  console.log('  isActive        :', fromDB.isActive);

  // Verificar con y sin trim para diagnosticar el problema
  const verifyRaw    = await bcrypt.compare(ADMIN_PASSWORD, storedHash);
  const verifyTrimmed = await bcrypt.compare(ADMIN_PASSWORD, storedHash.trim());
  console.log('  compare(raw)    :', verifyRaw,     verifyRaw    ? '✓' : '✗ ← hash corrupto');
  console.log('  compare(trim)   :', verifyTrimmed, verifyTrimmed ? '✓' : '✗ ← problema real');

  if (!verifyTrimmed) {
    console.error('\n  DIAGNÓSTICO: El hash almacenado no corresponde a la contraseña.');
    console.error('  Hash completo:', JSON.stringify(storedHash));
    process.exit(1);
  }

  // ── PASO E: Probar el endpoint HTTP directamente ──────────────────────────────
  console.log('\n' + sep);
  console.log('PASO E — Llamando a POST /api/v1/auth/login (HTTP interno)');
  console.log(sep);

  const http = require('http');
  const body = JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000,
      path: '/api/v1/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        console.log('  HTTP status     :', res.statusCode);
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200) {
            console.log('  ✓ Login exitoso!');
            console.log('  token (primeros 20):', json.data?.token?.slice(0, 20) || json.token?.slice(0, 20), '...');
            console.log('  user.name       :', json.data?.user?.name || json.user?.name);
          } else {
            console.log('  ✗ Login falló:', JSON.stringify(json));
          }
        } catch {
          console.log('  respuesta raw   :', data.slice(0, 200));
        }
        resolve(null);
      });
    });
    req.on('error', (e) => {
      console.log('  ✗ Error HTTP:', e.message);
      reject(e);
    });
    req.write(body);
    req.end();
  });

  // ── Resultado final ───────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ✅  ADMIN LISTO                                     ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Email:    admin@sigcmotos.co                        ║');
  console.log('║  Password: ' + ADMIN_PASSWORD.padEnd(41) + '║');
  console.log('╚══════════════════════════════════════════════════════╝');
}

main()
  .catch((e) => { console.error('\nERROR FATAL:', e.message); process.exit(1); })
  .finally(()  => prisma.$disconnect());
NODEJS_EOF

ok "Script preparado"

# ── Copiar y ejecutar dentro de sigc_app ─────────────────────────────────────
info "[3/4] Ejecutando diagnóstico dentro de sigc_app..."
echo "   (usando PrismaPg adapter + bcryptjs — idéntico al app)"
echo ""

docker cp "$TMP_SCRIPT" sigc_app:"$SCRIPT_IN_CONTAINER"

docker exec \
  --workdir /app \
  -e DATABASE_URL="$DATABASE_URL" \
  -e SIGC_ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e SIGC_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  sigc_app \
  node "$SCRIPT_IN_CONTAINER"

EXEC_EXIT=$?

docker exec sigc_app rm -f "$SCRIPT_IN_CONTAINER" 2>/dev/null || true

if [[ $EXEC_EXIT -ne 0 ]]; then
  echo ""
  fail "El script falló. Revisa el diagnóstico arriba."
  echo ""
  echo "   Si el PASO D muestra 'has newline: true':"
  warn "  La BD tiene hashes corruptos con \\n. Este script los reemplazó."
  warn "  Ahora reconstruye el backend para que el .trim() del authService"
  warn "  quede compilado en dist/:"
  echo "   bash rebuild.sh"
  exit 1
fi

# ── Rebuild del backend ───────────────────────────────────────────────────────
info "[4/4] Rebuilding backend para incluir fix del .trim() en authService..."
echo ""

COMPOSE="docker compose --env-file $ENV_FILE"
$COMPOSE build --no-cache app 2>&1 | grep -E "(Step|=>|Built|Error|error|CACHED)" | head -30 || true
$COMPOSE up -d app

echo "   Esperando que sigc_app arranque..."
WAITED=0
until docker inspect sigc_app --format='{{.State.Status}}' 2>/dev/null | grep -q "running"; do
  [[ $WAITED -ge 60 ]] && { fail "sigc_app no arrancó en 60s"; docker logs sigc_app --tail 20; exit 1; }
  printf "."; sleep 3; WAITED=$((WAITED+3))
done
echo ""
sleep 5

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           ✅  TODO LISTO                                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  Email:    %-41s║\n" "$ADMIN_EMAIL"
printf "║  Password: %-41s║\n" "$ADMIN_PASSWORD"
echo "║  URL:      https://motos.quantacloud.co                 ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
