/**
 * Seed inicial — ejecutar UNA SOLA VEZ después de la primera migración.
 *
 *   npm run db:seed
 *
 * Crea: roles, permisos, tabla pivote y el primer usuario ADMIN.
 * Credenciales por defecto (CAMBIAR INMEDIATAMENTE en producción):
 *   email:    admin@sigcmotos.co
 *   password: Admin2024!
 */

import { prisma } from '../src/config/prisma';
import { seedRolesAndPermissions } from '../src/services/authService';
import { hashPassword } from '../src/utils/passwordUtils';
import { logger } from '../src/config/logger';

async function main() {
  logger.info('[seed] Iniciando seed de seguridad...');

  await seedRolesAndPermissions();

  // Crear usuario ADMIN por defecto si no existe
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  if (!adminRole) throw new Error('Rol ADMIN no encontrado después del seed de roles');

  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@sigcmotos.co' },
  });

  if (!existingAdmin) {
    const hashed = await hashPassword('Admin2024!');
    await prisma.user.create({
      data: {
        email:    'admin@sigcmotos.co',
        password: hashed,
        name:     'Administrador',
        roleId:   adminRole.id,
      },
    });
    logger.info('[seed] Usuario ADMIN creado: admin@sigcmotos.co');
  } else {
    logger.info('[seed] Usuario ADMIN ya existe, omitiendo creación');
  }

  logger.info('[seed] Seed completado correctamente.');
}

main()
  .catch((err) => {
    logger.error('[seed] Error durante el seed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
