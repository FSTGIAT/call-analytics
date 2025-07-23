import winston from 'winston';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const logFormat = process.env.LOG_FORMAT || 'json';

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat === 'json' ? jsonFormat : consoleFormat,
  defaultMeta: { service: 'call-analytics-api' },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development' ? consoleFormat : jsonFormat
    })
  ]
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: path.join('/app/logs', 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  );
  
  logger.add(
    new winston.transports.File({
      filename: path.join('/app/logs', 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  );
}