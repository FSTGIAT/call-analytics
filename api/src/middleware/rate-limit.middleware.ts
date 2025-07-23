import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';

// Create rate limiter instances
export const analyticsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many analytics requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.'
    });
  }
});

export const searchRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, // limit each IP to 50 requests per windowMs
  message: {
    error: 'Too many search requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn('Search rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    res.status(429).json({
      error: 'Too many search requests',
      message: 'Search rate limit exceeded. Please try again later.'
    });
  }
});

export const mlRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: {
    error: 'Too many ML requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn('ML rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    res.status(429).json({
      error: 'Too many ML requests',
      message: 'ML processing rate limit exceeded. Please try again later.'
    });
  }
});

export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn('General rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    res.status(429).json({
      error: 'Too many requests',
      message: 'General rate limit exceeded. Please try again later.'
    });
  }
});

// Export default rate limit
export default generalRateLimit;

// Export alias for common usage
export const rateLimitMiddleware = generalRateLimit;