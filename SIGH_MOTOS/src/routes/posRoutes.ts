/**
 * posRoutes.ts — Módulo 2: Punto de Venta (POS)
 *
 * Todas las rutas requieren autenticación JWT.
 * Las rutas de escritura y cancelación requieren roles específicos.
 *
 * Montado en /api/v1/pos (ver src/routes/index.ts)
 */

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as ctrl from '../controllers/posController';

const router = Router();

// Grupos de permisos
const canRead   = [authenticate, authorize('sales.read')];
const canWrite  = [authenticate, authorize('sales.write')];
const canAdmin  = [authenticate, authorize('sales.admin')];

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTOS — endpoint de caja (lookup por lector de barras)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/pos/products/by-barcode/:code
 *
 * Endpoint crítico para el flujo de escaneo en caja.
 * El lector HID envía el código como texto + Enter; el frontend llama
 * a este endpoint al detectar el evento Enter en el input de escaneo.
 *
 * Optimizado para respuestas < 50 ms usando índices de BD.
 * Retorna: { id, nameCommercial, skuInternal, salePriceBase, salePriceWithTax, stockQuantity, imageKey, locationBin }
 */
router.get('/products/by-barcode/:code', ...canRead, ctrl.getProductByBarcode);

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES — búsqueda rápida para vincular en checkout
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/pos/customers?query=...&page=1&limit=10
 * Busca clientes por nombre, teléfono o identificación para vincular a la venta.
 */
router.get('/customers', ...canRead, ctrl.searchCustomersHandler);

// ═══════════════════════════════════════════════════════════════════════════
// VENTAS
// ─── IMPORTANTE: las rutas estáticas (/totals/preview) deben declararse
// ANTES de /:id para que Express no las interprete como IDs.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/pos/sales/totals/preview
 * Calcula subtotal, IVA y total de un carrito SIN procesar la venta.
 * Util para mostrar el desglose en pantalla antes de confirmar.
 * Requiere: { items: [{quantity, unitPrice, discountPerItem?}], discountAmount?, taxRate? }
 */
router.post('/sales/totals/preview', ...canRead, ctrl.previewTotals);

/**
 * POST /api/v1/pos/sales
 * Crea una venta nueva. Transacción atómica completa.
 * Requiere permiso sales.write (SELLER o ADMIN).
 */
router.post('/sales', ...canWrite, ctrl.createSale);

/**
 * GET /api/v1/pos/sales
 * Lista ventas con filtros. SELLER ve sólo sus ventas; ADMIN ve todas.
 */
router.get('/sales', ...canRead, ctrl.getAllSalesHandler);

/**
 * GET /api/v1/pos/sales/:id
 * Obtiene una venta por ID o número de factura (FAC-… / VTA-…).
 * Útil para reimpresión de tickets.
 */
router.get('/sales/:id', ...canRead, ctrl.getSaleByIdHandler);

/**
 * POST /api/v1/pos/sales/:id/cancel
 * Cancela una venta COMPLETED. Restaura stock. Solo ADMIN.
 */
router.post('/sales/:id/cancel', ...canAdmin, ctrl.cancelSaleHandler);

export default router;
