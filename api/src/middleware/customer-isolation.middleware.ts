import { Request, Response, NextFunction } from 'express';
import { CustomerContext } from '../types/customer';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    customerId: string;
    role: string;
    subscriberIds?: string[];
  };
  customerContext?: CustomerContext;
}

export const customerIsolationMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Check if customer isolation is enabled
    const isolationEnabled = process.env.ENABLE_CUSTOMER_ISOLATION === 'true';
    
    if (!isolationEnabled) {
      // If isolation is disabled, use default context
      req.customerContext = {
        customerId: process.env.DEFAULT_TENANT_ID || 'default',
        tenantId: process.env.DEFAULT_TENANT_ID || 'default'
      };
      return next();
    }

    // In development, allow X-Customer-ID header for testing
    if (process.env.NODE_ENV === 'development' && req.headers['x-customer-id']) {
      req.user = {
        userId: 'dev-user',
        customerId: req.headers['x-customer-id'] as string,
        role: 'admin'
      };
    }

    // Ensure user is authenticated
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Extract customer context from authenticated user
    const { customerId, subscriberIds } = req.user;

    if (!customerId) {
      res.status(403).json({ error: 'Customer context not found' });
      return;
    }

    // Set customer context for downstream services
    req.customerContext = {
      customerId,
      subscriberIds: subscriberIds || []
    };

    // Log access for audit
    logger.info('Customer access', {
      userId: req.user.userId,
      customerId,
      endpoint: req.path,
      method: req.method
    });

    next();
  } catch (error) {
    logger.error('Customer isolation middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const validateSubscriberAccess = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    const subscriberId = req.params.subscriberId || req.body.subscriberId;
    
    if (!subscriberId) {
      return next();
    }

    const context = req.customerContext;
    
    if (!context) {
      res.status(403).json({ error: 'Customer context not found' });
      return;
    }

    // Check if user has access to specific subscriber
    if (context.subscriberIds && context.subscriberIds.length > 0) {
      if (!context.subscriberIds.includes(subscriberId)) {
        res.status(403).json({ error: 'Access denied to subscriber' });
        return;
      }
    }

    next();
  } catch (error) {
    logger.error('Subscriber validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Alias for requireCustomerContext (commonly used name)
export const requireCustomerContext = customerIsolationMiddleware;