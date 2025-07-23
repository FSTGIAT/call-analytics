import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  logger.error('API Error:', {
    statusCode,
    message,
    code: err.code,
    details: err.details,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
  res.status(statusCode).json({
    error: {
      message,
      code: err.code || 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
      path: req.path
    }
  });
};