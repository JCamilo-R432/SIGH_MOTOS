import { Router } from 'express';
import productRoutes  from './productRoutes';
import salesRoutes    from './salesRoutes';
import customerRoutes from './customerRoutes';

const router = Router();

// Módulo 1 — Inventario
router.use('/products',  productRoutes);

// Módulo 2 — Ventas / POS
router.use('/sales',     salesRoutes);
router.use('/customers', customerRoutes);

// Módulo 3 (futuro): router.use('/purchases', purchaseRoutes);

export default router;
