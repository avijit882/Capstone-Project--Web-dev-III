import { Router } from 'express';
import { notificationController } from '../controllers/index.js';
import { authenticate } from '../middleware/auth.js';
import { validateIdParam } from '../middleware/validate-params.js';
const router = Router();
router.use(authenticate);
router.get('/', notificationController.list);
router.patch('/:id/read', validateIdParam(), notificationController.markRead);
export default router;
