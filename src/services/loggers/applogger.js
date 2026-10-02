const pino = require('pino');
const dotenv = require("dotenv");
const { resolve } = require("path");

const dotenvResult = dotenv.config({ path: resolve(__dirname, '..', '..', '.env') });
if (dotenvResult.error) {
    console.warn('[CERTENGINE] No .env file found, relying on environment variables injected at runtime');
}

const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const logLevel = validLevels.includes(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'info';

const isDev = process.env.NODE_ENV !== 'prod';

const options = {
    level: logLevel,
    msgPrefix: '[CERTENGINE] ',
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
        error: (err) => ({ message: err.message, stack: err.stack, name: err.name }),
    },
};

const appLogger = isDev
    ? pino({
        ...options,
        transport: {
            target: 'pino-pretty',
            options: { colorize: true, ignore: 'hostname,req,res,responseTime' },
        },
    })
    : pino(options);

module.exports = appLogger;