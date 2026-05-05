/**
 * fix-permissions.ts
 *
 * Resiembra roles, permisos y tabla pivote role_permissions en la BD de producción.
 * Es seguro ejecutarlo múltiples veces (upsert idempotente).
 *
 * Uso desde el host del VPS:
 *   docker exec sigc_app node dist/scripts/fix-permissions.js
 */

import { prisma }                  from '../config/prisma';
import { seedRolesAndPermissions } from '../services/authService';
import { ROLE_PERMISSIONS }        from '../constants/permissions';
import { hashPassword }            from '../utils/passwordUtils';

async function main() {
  console.log('[fix-permissions] Conectando a la base de datos...');

  // 1. Seed de roles y permisos (upsert — idempotente)
  await seedRolesAndPermissions();
  console.log('[fix-permissions] ✅ Roles y permisos sembrados');

  // 2. Verificar cobertura de permisos por rol
  const roles = await prisma.role.findMany({
    include: {
      permissions: { include: { permission: { select: { name: true } } } },
    },
  });

  for (const role of roles) {
    const expected = ROLE_PERMISSIONS[role.name] ?? [];
    const actual   = role.permissions.map((rp) => rp.permission.name);
    const missing  = expected.filter((p) => !actual.includes(p));

    if (missing.length > 0) {
      console.warn(`[fix-permissions] ⚠️  Rol ${role.name} — faltan: ${missing.join(', ')}`);
    } else {
      console.log(`[fix-permissions] ✅ Rol ${role.name} — ${actual.length} permisos OK`);
    }
  }

  // 3. Asegurar que el usuario admin de producción exista con rol ADMIN
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  if (!adminRole) {
    console.error('[fix-permissions] ❌ Rol ADMIN no encontrado');
    process.exit(1);
  }

  const prodAdminEmail = 'admin@clavijosmotos.com';
  const existing = await prisma.user.findUnique({ where: { email: prodAdminEmail } });

  if (!existing) {
    const hashed = await hashPassword('Admin123!');
    await prisma.user.create({
      data: {
        email:   prodAdminEmail,
        password: hashed,
        name:    'Administrador',
        roleId:  adminRole.id,
      },
    });
    console.log(`[fix-permissions] ✅ Admin creado: ${prodAdminEmail}`);
  } else {
    // Asegurar que el usuario existente tiene el rol ADMIN
    if (existing.roleId !== adminRole.id) {
      await prisma.user.update({
        where: { id: existing.id },
        data:  { roleId: adminRole.id },
      });
      console.log(`[fix-permissions] ✅ Rol ADMIN asignado a: ${prodAdminEmail}`);
    } else {
      console.log(`[fix-permissions] ✅ Admin ya existe con rol correcto: ${prodAdminEmail}`);
    }
  }

  console.log('[fix-permissions] ✅ Proceso completado correctamente');
}

main()
  .catch((err) => {
    console.error('[fix-permissions] ❌ Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
