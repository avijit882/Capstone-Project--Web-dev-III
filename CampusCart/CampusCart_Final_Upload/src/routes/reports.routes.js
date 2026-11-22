import { Router } from 'express';
import { reportController } from '../controllers/index.js';
import { authenticate, authorize } from '../middleware/auth.js';
const router = Router();
router.use(authenticate, authorize('admin', 'seller'));
router.get('/sales', reportController.sales);
router.get('/top-products', reportController.topProducts);
router.get('/inventory', reportController.inventory);
export default router;
