import { Router } from 'express';
import { adminController } from '../controllers/index.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateIdParam } from '../middleware/validate-params.js';
const router = Router();
router.use(authenticate, authorize('admin'));
router.get('/users', adminController.users);
router.patch('/sellers/:id/status', validateIdParam(), adminController.sellerStatus);
export default router;
