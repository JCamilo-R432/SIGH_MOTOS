import { Router } from 'express';
import productRoutes from './productRoutes';

const router = Router();

router.use('/products', productRoutes);

// Aquí se montarán los módulos futuros:
// router.use('/sales', salesRoutes);
// router.use('/purchases', purchaseRoutes);

export default router;
