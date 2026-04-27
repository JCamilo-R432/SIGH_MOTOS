/**
 * purchaseRoutes.ts — Módulo 4: Recepción Física de Mercancía (Entradas)
 *
 * Rutas para registrar y consultar entradas de mercancía al almacén.
 * Montadas en /api/v1/purchases (ver src/routes/index.ts).
 *
 * IMPORTANTE: Este router debe registrarse ANTES de purchaseOrderRoutes
 * en index.ts. El router de órdenes tiene `GET /:id` que de lo contrario
 * absorbería requests para `/purchases/entries` con id = "entries".
 *
 * Roles requeridos: ADMIN o WAREHOUSE (purchases.read / purchases.write).
 */

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  registerEntryHandler,
  getAllEntriesHandler,
  getEntryByIdHandler,
} from '../controllers/purchaseController';

const router = Router();

const canRead  = [authenticate, authorize('purchases.read')];
const canWrite = [authenticate, authorize('purchases.write')];

// ═══════════════════════════════════════════════════════════════════════════
// ENTRADAS DE MERCANCÍA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/purchases/entries
 *
 * Registra una entrada de mercancía. Transacción atómica:
 * stock update + WAC recalculation + ENTRY movement(s) + ENT number generation.
 * Puede crear productos nuevos si no existen (al proporcionar nameCommercial + brandId + categoryId).
 *
 * Requiere: purchases.write (ADMIN, WAREHOUSE).
 */
router.post('/entries', ...canWrite, registerEntryHandler);

/**
 * GET /api/v1/purchases/entries
 *
 * Lista el historial de entradas con datos agregados:
 * Número ENT, Fecha, Total Ítems, Valor Total.
 * Filtros: ?startDate=&endDate=&page=&limit=
 *
 * Requiere: purchases.read.
 */
router.get('/entries', ...canRead, getAllEntriesHandler);

/**
 * GET /api/v1/purchases/entries/:id
 *
 * Detalle completo de una entrada por número de documento (ENT-2026-00001).
 * Lista todos los productos recibidos con costos unitarios y totales.
 *
 * Requiere: purchases.read.
 */
router.get('/entries/:id', ...canRead, getEntryByIdHandler);

export default router;
