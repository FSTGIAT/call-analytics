import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import { generateToken } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';
import { oracleService } from '../services/oracle.service';

// Validation schemas
export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

export const adminLoginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
  adminKey: Joi.string().required()
});

export const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  customerId: Joi.string().required(),
  role: Joi.string().valid('admin', 'user', 'viewer').default('user')
});

export class AuthController {
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      // In production, fetch user from database
      // For now, using mock data
      const mockUsers = [
        {
          userId: 'user-123',
          email: 'demo@callanalytics.com',
          passwordHash: await bcrypt.hash('demo123456', 10),
          customerId: 'DEMO-CUSTOMER',
          role: 'customer',
          subscriberIds: []
        },
        {
          userId: 'user-456',
          email: 'test8tw@callanalytics.com',
          passwordHash: await bcrypt.hash('test123456', 10),
          customerId: 'CUSTOMER_TEST_8tw',
          role: 'customer',
          subscriberIds: []
        }
      ];

      // Find user by email
      const mockUser = mockUsers.find(user => user.email === email);
      if (!mockUser) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, mockUser.passwordHash);
      
      if (!isValidPassword) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      // Generate JWT token
      const token = generateToken({
        userId: mockUser.userId,
        customerId: mockUser.customerId,
        role: mockUser.role,
        subscriberIds: mockUser.subscriberIds
      });

      logger.info('User login successful', {
        userId: mockUser.userId,
        customerId: mockUser.customerId
      });

      res.json({
        token,
        user: {
          userId: mockUser.userId,
          email: mockUser.email,
          customerId: mockUser.customerId,
          role: mockUser.role
        }
      });
    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  }

  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, customerId, role } = req.body;

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // In production, save user to database
      const newUser = {
        userId: `user-${Date.now()}`,
        email,
        passwordHash,
        customerId,
        role,
        subscriberIds: []
      };

      // Generate token
      const token = generateToken({
        userId: newUser.userId,
        customerId: newUser.customerId,
        role: newUser.role,
        subscriberIds: newUser.subscriberIds
      });

      logger.info('User registration successful', {
        userId: newUser.userId,
        customerId: newUser.customerId
      });

      res.status(201).json({
        token,
        user: {
          userId: newUser.userId,
          email: newUser.email,
          customerId: newUser.customerId,
          role: newUser.role
        }
      });
    } catch (error) {
      logger.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }

  static async getProfile(req: Request, res: Response): Promise<void> {
    try {
      // Get user info from token (set by auth middleware)
      const user = (req as any).user;
      
      res.json({
        user: {
          userId: user.userId,
          email: 'demo@callanalytics.com',
          customerId: user.customerId,
          role: user.role
        }
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({ error: 'Failed to get profile' });
    }
  }

  static async logout(req: Request, res: Response): Promise<void> {
    // In production, you might want to blacklist the token
    res.json({ message: 'Logout successful' });
  }

  static async adminLogin(req: Request, res: Response): Promise<void> {
    try {
      const { username, password, adminKey } = req.body;

      // Admin credentials and key validation
      const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
      const ADMIN_KEY = process.env.ADMIN_KEY || 'call-analytics-admin-key-2025';

      // Verify admin credentials
      if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD || adminKey !== ADMIN_KEY) {
        logger.warn('Failed admin login attempt', { username, ip: req.ip });
        res.status(401).json({ error: 'Invalid admin credentials' });
        return;
      }

      // Generate JWT token for admin with null customerId for access to all data
      const token = generateToken({
        userId: 'admin-user',
        customerId: null, // null = access to all customers' data
        role: 'admin',
        subscriberIds: []
      });

      logger.info('Admin login successful', {
        username,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        token,
        user: {
          id: 'admin-user',
          email: `${username}@callanalytics.admin`,
          name: 'System Administrator',
          role: 'admin',
          isAdmin: true,
          permissions: ['read:all', 'write:all', 'admin:all'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          preferences: {
            language: 'he',
            theme: 'dark',
            notifications: true,
            timezone: 'Asia/Jerusalem'
          }
        },
        refreshToken: `refresh_${token}`,
        customerContext: null, // Admin has no customer context restrictions
        expiresIn: 3600
      });
    } catch (error) {
      logger.error('Admin login error:', error);
      res.status(500).json({ error: 'Admin login failed' });
    }
  }
}