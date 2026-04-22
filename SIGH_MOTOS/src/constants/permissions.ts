// ─── Catálogo canónico de permisos del sistema ───────────────────────────────
// Usar siempre estas constantes — nunca strings literales en los middlewares.

export const PERMISSIONS = {
  // Inventario
  INVENTORY_READ:   'inventory.read',
  INVENTORY_WRITE:  'inventory.write',

  // Ventas / POS
  SALES_READ:       'sales.read',
  SALES_WRITE:      'sales.write',
  SALES_ADMIN:      'sales.admin',    // Cancelar ventas, ver costos en POS

  // Compras y Proveedores
  PURCHASES_READ:   'purchases.read',
  PURCHASES_WRITE:  'purchases.write',

  // Reportes y Analítica
  REPORTS_READ:     'reports.read',

  // Gestión de Usuarios
  USERS_READ:       'users.read',
  USERS_WRITE:      'users.write',
  USERS_ADMIN:      'users.admin',    // Cambiar roles, desactivar usuarios

  // Finanzas y Caja
  FINANCE_READ:     'finance.read',
  FINANCE_WRITE:    'finance.write',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type PermissionValue = (typeof PERMISSIONS)[PermissionKey];

// ─── Permisos por rol predefinido ─────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<string, PermissionValue[]> = {
  ADMIN: Object.values(PERMISSIONS) as PermissionValue[],

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

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN:     'Acceso total al sistema',
  MANAGER:   'Gerente: reportes, supervisión de ventas y compras',
  SELLER:    'Vendedor: crear ventas y consultar stock',
  WAREHOUSE: 'Bodeguero: recepción de compras y ajuste de inventario',
};
