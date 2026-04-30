/**
 * invoiceRoutes.ts — Módulo 3: Facturación y Documentación Comercial
 *
 * Todas las rutas requieren autenticación JWT.
 * Las rutas de escritura y cancelación requieren rol ADMIN (sales.admin).
 *
 * Montado en /api/v1/invoices (ver src/routes/index.ts)
 *
 * IMPORTANTE: las rutas estáticas (/config) deben declararse ANTES de /:id
 * para que Express no las interprete como identificadores de factura.
 */

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as ctrl from '../controllers/invoiceController';

const router = Router();

// Grupos de permisos
const canRead  = [authenticate, authorize('sales.read')];
const canAdmin = [authenticate, authorize('sales.admin')];

// ═══════════════════════════════════════════════════════════════════════════
// LISTADO DE FACTURAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/invoices
 * Lista facturas (ventas) con paginación y filtros.
 */
router.get('/', ...canRead, ctrl.listInvoicesHandler);

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE EMPRESA
// ─── Ruta estática declarada ANTES de /:id ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/invoices/config
 * Retorna la configuración de empresa para el encabezado de facturas.
 */
router.get('/config', ...canRead, ctrl.getCompanyConfigHandler);

/**
 * PUT /api/v1/invoices/config
 * Actualiza la configuración de empresa (merge parcial). Solo ADMIN.
 */
router.put('/config', ...canAdmin, ctrl.updateCompanyConfigHandler);

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTOS DE FACTURA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/invoices/:id
 * Genera el documento de factura para impresión térmica.
 * :id puede ser un ID de Prisma (cuid) o número de factura (FAC-… / VTA-…).
 */
router.get('/:id', ...canRead, ctrl.getInvoiceHandler);

/**
 * POST /api/v1/invoices/:id/cancel
 * Cancela una factura COMPLETED. Restaura stock. Solo ADMIN.
 */
router.post('/:id/cancel', ...canAdmin, ctrl.cancelInvoiceHandler);

export default router;
