import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

// Create logger instance - use 'info' level by default to reduce noise
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'quantedge-api' },
  transports: [
    // Write all logs to console in development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
          }
          return msg;
        })
      ),
    }),
  ],
});

// In production, you might want to add file transports or external logging
if (isProduction) {
  logger.add(
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Helper function to log API requests
export function logRequest(req: any, message: string) {
  logger.info(message, {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
}

// Helper function to log errors
export function logError(error: Error, context?: any) {
  logger.error(error.message, {
    stack: error.stack,
    ...context,
  });
}
