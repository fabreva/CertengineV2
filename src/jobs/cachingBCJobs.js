const {predictGasPrice} = require("../services/transactions/oracols");
const redisClient = require("../services/redis/redisClient");
const {getNonceFromBCForRedis} = require("../services/transactions/explorers/explorer");

async function saveGasPrice(){
    const gasPrice = await predictGasPrice();
    if (gasPrice) {
        await redisClient.setValue("suggestedTransactionPrice", JSON.stringify(gasPrice));
    }
}

async function saveNonce(){
    const concurrentTransactions = Number(await redisClient.getValue("concurrentTransactions"));
    const chainNonce = await getNonceFromBCForRedis();
    if (concurrentTransactions === 0) {
        const current = Number(await redisClient.getValue("nextNonce"));
        if (chainNonce > current) {
            await redisClient.setValue("nextNonce", chainNonce);
        }
    }
}


async function cacheBCInfo(){
    await saveGasPrice()
    await saveNonce()
}

module.exports = {
    cacheBCInfo
}
