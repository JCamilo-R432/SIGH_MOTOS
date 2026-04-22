import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { hashPassword, verifyPassword } from '../utils/passwordUtils';
import { logAction } from './auditService';
import { ROLE_PERMISSIONS, ROLE_DESCRIPTIONS } from '../constants/permissions';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no está configurado en las variables de entorno');
  return secret;
}

function buildUserPayload(user: {
  id: string;
  email: string;
  roleId: string;
  role: {
    name: string;
    permissions: Array<{ permission: { name: string } }>;
  };
}) {
  return {
    userId:      user.id,
    email:       user.email,
    roleId:      user.roleId,
    roleName:    user.role.name,
    permissions: user.role.permissions.map((rp) => rp.permission.name),
  };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string, ipAddress?: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  // Mensaje genérico para no revelar si el email existe
  const INVALID_MSG = 'Credenciales inválidas';

  if (!user || !user.isActive) throw new Error(INVALID_MSG);

  const valid = await verifyPassword(password, user.password);
  if (!valid) throw new Error(INVALID_MSG);

  const payload = buildUserPayload(user);
  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '8h' });

  await logAction(user.id, 'LOGIN', 'User', user.id, { email: user.email }, ipAddress);
  logger.info(`[authService] Login exitoso: ${user.email}`);

  return {
    token,
    expiresIn: '8h',
    user: {
      id:    user.id,
      email: user.email,
      name:  user.name,
      role:  user.role.name,
    },
  };
}

// ─── Crear usuario (solo ADMIN) ───────────────────────────────────────────────

export interface CreateUserInput {
  email:    string;
  password: string;
  name:     string;
  roleId:   string;
}

export async function createUser(data: CreateUserInput, adminUserId: string, ipAddress?: string) {
  const hashed = await hashPassword(data.password);

  const user = await prisma.user.create({
    data: {
      email:    data.email.toLowerCase().trim(),
      password: hashed,
      name:     data.name,
      roleId:   data.roleId,
    },
    include: { role: { select: { id: true, name: true } } },
  });

  await logAction(adminUserId, 'CREATE_USER', 'User', user.id, {
    email: user.email,
    name:  user.name,
    role:  user.role.name,
  }, ipAddress);

  logger.info(`[authService] Usuario creado: ${user.email} por admin ${adminUserId}`);

  const { password: _pw, ...safeUser } = user;
  return safeUser;
}

// ─── Listar usuarios ──────────────────────────────────────────────────────────

export async function listUsers() {
  return prisma.user.findMany({
    select: {
      id:        true,
      email:     true,
      name:      true,
      isActive:  true,
      createdAt: true,
      role:      { select: { id: true, name: true, description: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Cambiar rol ──────────────────────────────────────────────────────────────

export async function updateUserRole(
  targetUserId: string,
  newRoleId: string,
  adminUserId: string,
  ipAddress?: string,
) {
  const user = await prisma.user.update({
    where: { id: targetUserId },
    data: { roleId: newRoleId },
    include: { role: { select: { id: true, name: true } } },
  });

  await logAction(adminUserId, 'UPDATE_USER_ROLE', 'User', targetUserId, {
    newRoleId,
    newRoleName: user.role.name,
  }, ipAddress);

  const { password: _pw, ...safeUser } = user;
  return safeUser;
}

// ─── Desactivar usuario ───────────────────────────────────────────────────────

export async function deactivateUser(
  targetUserId: string,
  adminUserId: string,
  ipAddress?: string,
) {
  const user = await prisma.user.update({
    where: { id: targetUserId },
    data: { isActive: false },
    select: { id: true, email: true, name: true },
  });

  await logAction(adminUserId, 'DEACTIVATE_USER', 'User', targetUserId, {
    email: user.email,
  }, ipAddress);

  return user;
}

// ─── Listar roles disponibles ─────────────────────────────────────────────────

export async function listRoles() {
  return prisma.role.findMany({
    select: {
      id:          true,
      name:        true,
      description: true,
      _count: { select: { users: true } },
    },
    orderBy: { name: 'asc' },
  });
}

// ─── Seed inicial de roles y permisos ────────────────────────────────────────
// Llamar desde prisma/seed.ts — no en producción normal.

export async function seedRolesAndPermissions() {
  const permissionsData = Object.entries(ROLE_PERMISSIONS)
    .flatMap(([, perms]) => perms)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((name) => ({
      name,
      description: name.replace('.', ': ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));

  for (const perm of permissionsData) {
    await prisma.permission.upsert({
      where:  { name: perm.name },
      update: {},
      create: perm,
    });
  }

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where:  { name: roleName },
      update: {},
      create: { name: roleName, description: ROLE_DESCRIPTIONS[roleName] ?? roleName },
    });

    for (const permName of perms) {
      const permission = await prisma.permission.findUnique({ where: { name: permName } });
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where:  { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  logger.info('[authService] Roles y permisos sembrados correctamente');
}
