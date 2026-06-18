import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  base: {
    service: 'crm-tool',
    version: process.env.npm_package_version || '0.1.0',
    environment: process.env.NODE_ENV || 'development',
  },
  transport: isProduction ? undefined : {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,service,version,environment',
    },
  },
});

export function createLogger(context: Record<string, unknown> = {}) {
  return logger.child(context);
}

export function createRequestLogger(requestId: string, userId?: string, workspaceId?: string) {
  return logger.child({ requestId, userId, workspaceId });
}

export { logger };
export default logger;