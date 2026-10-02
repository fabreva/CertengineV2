const cron = require('node-cron');
const redisClient = require('../services/redis/redisClient');
const {cacheBCInfo} = require("./cachingBCJobs");
const appLogger = require("../services/loggers/applogger");


async function runCacheBCInfo() {
    try {
        await cacheBCInfo();
    } catch (error) {
        appLogger.error({error}, "CRON - cacheBCInfo failed");
    }
}

async function runEthPriceUpdate() {
    try {
        await redisClient.saveOnRedisETHtoEUR();
    } catch (error) {
        appLogger.error({error}, "CRON - saveOnRedisETHtoEUR failed");
    }
}

async function startCronJob() {
    await runEthPriceUpdate();
    await runCacheBCInfo();

    cron.schedule('0 * * * * *', runCacheBCInfo);
    cron.schedule('0 */15 * * * *', runEthPriceUpdate);
}


module.exports = { startCronJob };