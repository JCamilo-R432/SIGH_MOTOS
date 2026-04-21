import { Router } from 'express';
import productRoutes       from './productRoutes';
import salesRoutes         from './salesRoutes';
import customerRoutes      from './customerRoutes';
import purchaseOrderRoutes from './purchaseOrderRoutes';
import supplierRoutes      from './supplierRoutes';

const router = Router();

// Módulo 1 — Inventario
router.use('/products',  productRoutes);

// Módulo 2 — Ventas / POS
router.use('/sales',     salesRoutes);
router.use('/customers', customerRoutes);

// Módulo 3 — Compras y Proveedores
router.use('/purchases', purchaseOrderRoutes);
router.use('/suppliers', supplierRoutes);

export default router;
