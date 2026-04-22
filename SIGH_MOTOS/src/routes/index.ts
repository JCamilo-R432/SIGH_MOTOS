import { Router } from 'express';
import productRoutes       from './productRoutes';
import salesRoutes         from './salesRoutes';
import customerRoutes      from './customerRoutes';
import purchaseOrderRoutes from './purchaseOrderRoutes';
import supplierRoutes      from './supplierRoutes';
import reportRoutes        from './reportRoutes';
import authRoutes          from './authRoutes';
import userRoutes          from './userRoutes';
import financeRoutes       from './financeRoutes';
import { authenticate }    from '../middleware/authMiddleware';

const router = Router();

// Módulo 5 — Auth (público)
router.use('/auth',      authRoutes);

// Módulo 5 — Usuarios (protegido)
router.use('/users',     authenticate, userRoutes);

// Módulo 1 — Inventario
router.use('/products',  productRoutes);

// Módulo 2 — Ventas / POS
router.use('/sales',     salesRoutes);
router.use('/customers', customerRoutes);

// Módulo 3 — Compras y Proveedores
router.use('/purchases', purchaseOrderRoutes);
router.use('/suppliers', supplierRoutes);

// Módulo 4 — Reportes y Analítica
router.use('/reports',   reportRoutes);

// Módulo 6 — Finanzas, Caja y Cartera
router.use('/finance',   authenticate, financeRoutes);

export default router;
