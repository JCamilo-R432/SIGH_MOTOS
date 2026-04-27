import { Router } from 'express';
import inventoryRoutes     from './inventoryRoutes';
import productRoutes       from './productRoutes';
import posRoutes           from './posRoutes';
import salesRoutes         from './salesRoutes';
import customerRoutes      from './customerRoutes';
import purchaseRoutes      from './purchaseRoutes';
import purchaseOrderRoutes from './purchaseOrderRoutes';
import supplierRoutes      from './supplierRoutes';
import reportRoutes        from './reportRoutes';
import authRoutes          from './authRoutes';
import userRoutes          from './userRoutes';
import financeRoutes       from './financeRoutes';
import invoiceRoutes       from './invoiceRoutes';
import treasuryRoutes      from './treasuryRoutes';
import securityRoutes      from './securityRoutes';
// ── Nuevas rutas (Módulos adicionales) ─────────────────────────────────────
import imageRoutes         from './imageRoutes';
import debtRoutes          from './debtRoutes';
import abcRoutes           from './abcRoutes';
import posSearchRoutes     from './posSearchRoutes';
import configRoutes        from './configRoutes';
import { authenticate }    from '../middleware/authMiddleware';

const router = Router();

// Módulo 5 — Auth (público)
router.use('/auth',      authRoutes);

// Módulo 5 — Usuarios (protegido)
router.use('/users',     authenticate, userRoutes);

// Módulo 1 — Inventario (rutas canónicas: /inventory/products, /inventory/brands, /inventory/categories)
router.use('/inventory', inventoryRoutes);

// Módulo 1 — Ruta legacy mantenida para compatibilidad con módulos 2-6
router.use('/products',  productRoutes);

// Módulo 2 — POS (Punto de Venta): /pos/products/by-barcode, /pos/sales, /pos/customers
router.use('/pos',       posRoutes);

// Módulo 2 — Rutas legacy de ventas y clientes (mantenidas para otros módulos)
router.use('/sales',     salesRoutes);
router.use('/customers', customerRoutes);

// Módulo 4 — Entradas de Mercancía (ANTES de purchaseOrderRoutes para que
// GET /entries no sea absorbido por GET /:id de las órdenes de compra)
router.use('/purchases', purchaseRoutes);

// Módulo 3 — Compras y Proveedores (Órdenes de Compra)
router.use('/purchases', purchaseOrderRoutes);
router.use('/suppliers', supplierRoutes);

// Módulo 4 — Reportes y Analítica
router.use('/reports',   reportRoutes);
router.use('/reports',   abcRoutes);        // abc-analysis, sales-trend, kpis

// Módulo 3 — Facturación y Documentación Comercial
router.use('/invoices',  invoiceRoutes);

// Módulo 6 — Finanzas, Caja y Cartera
router.use('/finance',   authenticate, financeRoutes);

// Módulo 5 — Tesorería y Control de Caja (arqueo de turno por usuario)
router.use('/treasury',  authenticate, treasuryRoutes);
// Créditos / Fiados (CxC) — montado bajo /treasury/debts
router.use('/treasury/debts', debtRoutes);

// Módulo 7 — Seguridad y Gobernanza de Acceso
router.use('/security',  authenticate, securityRoutes);

// ── Extensiones de POS ────────────────────────────────────────────────────
// Búsqueda tolerante: GET /pos/products/search?query=... (ANTES de posRoutes genérico)
router.use('/pos',       posSearchRoutes);

// Módulo 8 — Configuración del Negocio
router.use('/config', configRoutes);

// ── Uploads de imágenes ───────────────────────────────────────────────────
// POST /inventory/products/:id/image
router.use('/inventory', imageRoutes);

export default router;
