const Redis = require('ioredis');
const {getNonceFromBCForRedis} = require("../services/transactions/explorers/explorer");
const appLogger = require("../services/loggers/applogger");
const {configurator} = require("../config");
const {getEthEurFromService} = require("../services/transactions/oracols/price");


let redisClient;

async function connectToRedis() {
    if (!redisClient || ["connecting", "ready"].includes(redisClient.status) === false) {
        try {
            redisClient = new Redis({
                port: await configurator.getConfig('redisconf.port'),
                host: await configurator.getConfig('redisconf.host'),
                password: await configurator.getConfig('redisconf.password')
            });

            redisClient.on('connect', () => {
                appLogger.info(undefined, 'REDIS - Connected');
            });

            redisClient.on('error', (error) => {
                appLogger.error({error:error}, 'REDIS - Error while connecting');
            });

            const {eur, status} = await getEthEurFromService()
            await redisClient.set('price_service_STATUS', status.toString())
            if(status){
                await redisClient.set('from_ETH_to_EUR', eur)
            }

            const nonce = await getNonceFromBCForRedis()
            await redisClient.set(`nextNonce`, nonce);
            await redisClient.set(`concurrentTransactions`, 0);
        } catch (error) {
            appLogger.error({error:error},'REDIS - Error while establishing connection');
            throw error;
        }
    }
    return redisClient;
}

async function disconnectFromRedis() {
    if (redisClient && redisClient.status !== "end") {
        try {
            await redisClient.quit();
            appLogger.warn(undefined, 'REDIS - Disconnected');
        } catch (error) {
            appLogger.error({error:error}, 'REDIS - Error while disconnecting');
        }
    }
}

module.exports = {
    connectToRedis,
    disconnectFromRedis
};
