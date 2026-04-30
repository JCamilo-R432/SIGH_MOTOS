#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  SIGC-Motos — Seed de roles y permisos en producción
#
#  Ejecuta seedRolesAndPermissions() dentro de sigc_app usando el mismo
#  PrismaPg adapter que usa el backend (idéntico a src/config/prisma.ts).
#
#  Esto puebla las tablas permissions y role_permissions.
#  Sin esto, todos los endpoints con authorize() devuelven 403.
#
#  Ejecutar desde: /opt/SIGH_MOTOS
#  Uso: bash seed-permissions.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/opt/SIGH_MOTOS"
ENV_FILE="$APP_DIR/.env.production"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}   ✓${NC} $*"; }
fail() { echo -e "${RED}   ✗${NC} $*"; }
info() { echo -e "${BLUE}▶${NC}  $*"; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   SIGC-Motos — Seed Roles y Permisos                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cd "$APP_DIR" || { echo "No se puede acceder a $APP_DIR"; exit 1; }

# ── Validar entorno ───────────────────────────────────────────────────────────
info "[1/3] Validando entorno..."
[[ ! -f "$ENV_FILE" ]] && { fail "No se encontró $ENV_FILE"; exit 1; }
DATABASE_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
[[ -z "$DATABASE_URL" ]] && { fail "DATABASE_URL no encontrado"; exit 1; }
[[ "$DATABASE_URL" == *"CAMBIAR_ESTO"* ]] && { fail "DATABASE_URL tiene placeholder"; exit 1; }

if ! docker ps --format '{{.Names}}' | grep -q "^sigc_app$"; then
  fail "sigc_app no está corriendo. Ejecuta primero: bash deploy.sh"
  exit 1
fi
ok "Entorno validado"

# ── Crear script Node.js ──────────────────────────────────────────────────────
info "[2/3] Preparando script de seed..."

TMP_SCRIPT=$(mktemp /tmp/sigc_seed_XXXXXX.js)
trap 'rm -f "$TMP_SCRIPT"' EXIT
SCRIPT_IN_CONTAINER="/tmp/sigc_seed_permissions.js"

cat > "$TMP_SCRIPT" << 'NODEJS_EOF'
'use strict';

const { PrismaPg }    = require('@prisma/adapter-pg');
const { Pool }        = require('pg');
const { PrismaClient } = require('@prisma/client');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL no definida'); process.exit(1); }

const pool    = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter });

// ── Permisos por rol — DEBE coincidir con src/constants/permissions.ts ────────
const PERMISSIONS = {
  INVENTORY_READ:  'inventory.read',
  INVENTORY_WRITE: 'inventory.write',
  SALES_READ:      'sales.read',
  SALES_WRITE:     'sales.write',
  SALES_ADMIN:     'sales.admin',
  PURCHASES_READ:  'purchases.read',
  PURCHASES_WRITE: 'purchases.write',
  REPORTS_READ:    'reports.read',
  USERS_READ:      'users.read',
  USERS_WRITE:     'users.write',
  USERS_ADMIN:     'users.admin',
  FINANCE_READ:    'finance.read',
  FINANCE_WRITE:   'finance.write',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

const ROLE_PERMISSIONS = {
  ADMIN: ALL_PERMISSIONS,
  MANAGER: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.SALES_ADMIN,
    PERMISSIONS.PURCHASES_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.FINANCE_WRITE,
  ],
  SELLER: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.SALES_WRITE,
  ],
  WAREHOUSE: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.PURCHASES_READ,
    PERMISSIONS.PURCHASES_WRITE,
  ],
};

const ROLE_DESCRIPTIONS = {
  ADMIN:     'Acceso total al sistema',
  MANAGER:   'Gerente: reportes, supervisión de ventas y compras',
  SELLER:    'Vendedor: crear ventas y consultar stock',
  WAREHOUSE: 'Bodeguero: recepción de compras y ajuste de inventario',
};

async function main() {
  const sep = '─'.repeat(52);

  console.log('\n' + sep);
  console.log('PASO A — Creando/verificando permisos');
  console.log(sep);

  const allPermNames = [...new Set(ALL_PERMISSIONS)];
  for (const name of allPermNames) {
    const desc = name.replace('.', ': ').replace(/\b\w/g, c => c.toUpperCase());
    await prisma.permission.upsert({
      where:  { name },
      update: {},
      create: { name, description: desc },
    });
    process.stdout.write('  ✓ ' + name + '\n');
  }

  console.log('\n' + sep);
  console.log('PASO B — Creando/verificando roles');
  console.log(sep);

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where:  { name: roleName },
      update: {},
      create: { name: roleName, description: ROLE_DESCRIPTIONS[roleName] ?? roleName },
    });
    console.log('  ✓ Rol:', role.name, '(ID:', role.id + ')');

    for (const permName of perms) {
      const permission = await prisma.permission.findUnique({ where: { name: permName } });
      if (!permission) { console.warn('  ⚠ Permiso no encontrado:', permName); continue; }
      await prisma.rolePermission.upsert({
        where:  { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
    console.log('    →', perms.length, 'permisos asignados');
  }

  // Contar lo que quedó
  const [permCount, roleCount, rpCount] = await Promise.all([
    prisma.permission.count(),
    prisma.role.count(),
    prisma.rolePermission.count(),
  ]);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ✅  SEED COMPLETADO                                 ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Permisos en BD:          ' + String(permCount).padEnd(26) + '║');
  console.log('║  Roles en BD:             ' + String(roleCount).padEnd(26) + '║');
  console.log('║  Asignaciones rol-perm:   ' + String(rpCount).padEnd(26) + '║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  ⚠  El admin debe cerrar sesión y volver a entrar   ║');
  console.log('║     para obtener el JWT con los nuevos permisos.    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
}

main()
  .catch((e) => { console.error('\nERROR FATAL:', e.message); process.exit(1); })
  .finally(()  => prisma.$disconnect());
NODEJS_EOF

ok "Script preparado"

# ── Ejecutar dentro de sigc_app ───────────────────────────────────────────────
info "[3/3] Ejecutando seed dentro de sigc_app..."
echo ""

docker cp "$TMP_SCRIPT" sigc_app:"$SCRIPT_IN_CONTAINER"

docker exec \
  --workdir /app \
  -e DATABASE_URL="$DATABASE_URL" \
  sigc_app \
  node "$SCRIPT_IN_CONTAINER"

EXEC_EXIT=$?
docker exec sigc_app rm -f "$SCRIPT_IN_CONTAINER" 2>/dev/null || true

if [[ $EXEC_EXIT -ne 0 ]]; then
  echo ""
  fail "El seed falló. Revisa el diagnóstico arriba."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  PRÓXIMO PASO:                                           ║"
echo "║  1. bash rebuild.sh   (compila los nuevos endpoints)    ║"
echo "║  2. Cierra sesión y vuelve a entrar en la UI            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
