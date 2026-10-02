const crypto = require("crypto");
const appLogger = require("../services/loggers/applogger");
const {handlerErrorRequest} = require("../responseHandlers/handlerErrorRequest");
const {configurator} = require("../config");

function safeEqual(provided, expected){
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

async function serviceAuth(req, res, next){
    try {
        const provided = req.get("X-API-Key");
        const expected = await configurator.getConfig("serviceApiKey");

        if (!expected) {
            appLogger.fatal({}, "SERVICE_API_KEY not configured at runtime: rejecting request");
            return res.status(503).json(handlerErrorRequest({message:"Service not configured"}));
        }
        if (!provided || !safeEqual(provided, expected)) {
            appLogger.warn({context:{path:req.path}}, "Request with missing or invalid API key");
            return res.status(401).json(handlerErrorRequest({message:"Unauthorized"}));
        }
        return next();
    } catch (err) {
        appLogger.error({error:err}, "Error in authentication middleware");
        return res.status(500).json(handlerErrorRequest({message:"Internal Server Error"}));
    }
}

module.exports = {serviceAuth};