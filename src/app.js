const express = require('express');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');

const {pinoHttp} = require("pino-http");
const appLogger = require("./services/loggers/applogger");
const responseTime = require('response-time');
const helmet = require('helmet')


const prometheusMiddleware = require('express-prometheus-middleware');

const app = express();
app.set('etag', false);
app.disable("x-powered-by");
app.use(helmet({xPoweredBy: false,}))

/**
 * LOGGER
 */

app.use(responseTime((req, res, time) => {
    res.responseTime = time.toFixed(2);
}));

app.use(pinoHttp({
    logger: appLogger,
    customSuccessMessage: function (req, res) {
        const responseTime = res.responseTime || res.getHeader('X-Response-Time');
        return `Request completed: ${req.method} ${req.url} - Status: ${res.statusCode} - ${responseTime}ms`;
    },
    customErrorMessage: function (req, res, err) {
        const responseTime = res.responseTime || res.getHeader('X-Response-Time');
        return `Error occurred: ${req.method} ${req.url} - Error: ${err.message} - Response Time: ${responseTime}ms`;
    },
    customLogLevel: function (req, res, err) {
        if (err) {
            return 'error';
        }
        if (res && res.statusCode >= 400 && res.statusCode < 500) {
            return 'warn';
        }
        if (res && res.statusCode >= 500) {
            return 'error';
        }
        return 'info';
    },
    serializers: {
        req: () => undefined,
        res: (x) => {
            return {statusCode: x.statusCode, responseTime: x.responseTime}
        },
        responseTime: () => undefined
    },
}))



app.use(cors(
    {
        origin: process.env.MAIN_SERVER_URL,
        credentials: true
    }
));


app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({ extended: false }));


app.use(
    mongoSanitize({
        allowDots: true,
        replaceWith: '_'
    }),
);

if(process.env.NODE_ENV === 'prod') {
    app.set('trust proxy', 1);
}



app.use(prometheusMiddleware({
    metricsPath: '/api/metrics',
    collectDefaultMetrics: true,
    requestDurationBuckets: [0.1, 0.5, 1, 1.5],
    requestLengthBuckets: [512, 1024, 5120, 10240, 51200, 102400],
    responseLengthBuckets: [512, 1024, 5120, 10240, 51200, 102400],
    metricsApp: app
}));


// Rotte
const servicesRouter = require('./routes/certRoutes');
const statsRouter = require('./routes/statsRoutes');
const metricsRouter = require('./routes/metricsRoutes');
const {serviceAuth} = require("./middleware/serviceAuth");


app.use('/api', metricsRouter);
app.use('/api', serviceAuth, [servicesRouter, statsRouter]);


const {handlerErrorRequest} = require("./responseHandlers/handlerErrorRequest");


/* ########################################## */

app.use((err, req, res, next) => {
    appLogger.error({error:err}, `Error catched by general error handling middleware`);
    return res.status(500).json(handlerErrorRequest({message: "Internal Server Error"}));
});


module.exports = app;
