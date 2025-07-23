import { Router } from 'express';
import { AuthController, loginSchema, registerSchema, adminLoginSchema } from '../controllers/auth.controller';
import { validate } from '../middleware/validation.middleware';
import { authenticateToken, refreshToken } from '../middleware/auth.middleware';

const router = Router();

// Public routes
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/register', validate(registerSchema), AuthController.register);
router.post('/admin/login', validate(adminLoginSchema), AuthController.adminLogin);

// Protected routes
router.get('/profile', authenticateToken, AuthController.getProfile);
router.post('/refresh', authenticateToken, refreshToken);
router.post('/logout', authenticateToken, AuthController.logout);

export { router as authRoutes };