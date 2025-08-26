import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from './customer-isolation.middleware';
import { logger } from '../utils/logger';
import { secretsService } from '../services/secrets.service';

interface JwtPayload {
  userId: string;
  customerId: string;
  role: string;
  subscriberIds?: string[];
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Get JWT secret from AWS Secrets Manager
    let secret: string;
    try {
      const jwtConfig = await secretsService.getSecret('prod/call-analytics/jwt');
      secret = jwtConfig.jwt_secret;
      
      if (!secret) {
        throw new Error('JWT secret not found in AWS configuration');
      }
    } catch (error) {
      logger.error('Failed to retrieve JWT secret:', error);
      res.status(500).json({ error: 'Authentication configuration error' });
      return;
    }

    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        logger.warn('Invalid token attempt', { error: err.message });
        res.status(403).json({ error: 'Invalid or expired token' });
        return;
      }

      const payload = decoded as JwtPayload;
      
      // Attach user info to request
      req.user = {
        userId: payload.userId,
        customerId: payload.customerId,
        role: payload.role,
        subscriberIds: payload.subscriberIds
      };

      next();
    });
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

export const authorizeRoles = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Unauthorized access attempt', {
        userId: req.user.userId,
        role: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path
      });
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

export const generateToken = async (payload: JwtPayload): Promise<string> => {
  try {
    const jwtConfig = await secretsService.getSecret('prod/call-analytics/jwt');
    const secret = jwtConfig.jwt_secret;
    const expiresIn = jwtConfig.jwt_expiry || '7d';
    
    if (!secret) {
      throw new Error('JWT_SECRET not found in AWS Secrets Manager');
    }

    return jwt.sign(payload, secret, {
      expiresIn,
      issuer: 'call-analytics-platform'
    } as jwt.SignOptions);
  } catch (error) {
    logger.error('Failed to generate JWT token:', error);
    throw new Error('JWT configuration error');
  }
};

export const refreshToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const newToken = generateToken({
      userId: req.user.userId,
      customerId: req.user.customerId,
      role: req.user.role,
      subscriberIds: req.user.subscriberIds
    });

    res.json({ token: newToken });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
};