const {getBlockchainNameAndUrl} = require("../../../connectors/blockchainConnector");
const {etherscanGasPriceOracol} = require("./etherscan");
const {owlracolGasPriceOracol} = require("./owlracol");
const {transformInEur, estimateTransactionTime, fromGweiToWei} = require("./common");
const appLogger = require("../../loggers/applogger");
const redisClient = require("../../redis/redisClient");



async function getAdjustedGasPriceBasedOnTransactionsConcurrency(price, concurrentTransactions){
    let baseFee = price.baseFee
    let maxPriorityFeePerGas = price.maxPriorityFeePerGas;
    let maxFeePerGas = price.maxFeePerGas;
    let {eur: eur, status:status} = await redisClient.getEURfromRedis()
    if(!status){
        throw new Error('Problem with API Price Service')
    }
    if(concurrentTransactions === 0){
        price['minPriceEUR'] = await transformInEur(price.baseFee + price.maxPriorityFeePerGas, undefined, eur)
        price['maxPriceEUR'] = await transformInEur(price.maxFeePerGas, undefined, eur)
        return price;
    }

    baseFee = baseFee + baseFee * concurrentTransactions * 0.10
    maxFeePerGas = baseFee + maxPriorityFeePerGas;


    return {
        baseFee: baseFee,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        maxFeePerGas: maxFeePerGas,
        minPriceEUR: await transformInEur(baseFee + maxPriorityFeePerGas, undefined, eur),
        maxPriceEUR: await transformInEur(maxFeePerGas, undefined, eur),
        estimatedTime: await estimateTransactionTime(fromGweiToWei(baseFee+maxPriorityFeePerGas))
    }

}

async function predictGasPrice(){
    try{
        const blockchainNameAndUrl = await getBlockchainNameAndUrl();

        if(blockchainNameAndUrl.name === "Ethereum Mainnet"){
            return await etherscanGasPriceOracol()
        }else{
            return await owlracolGasPriceOracol()
        }
    }catch (error) {
        appLogger.error({error:error}, "Oracols - Error while asking for gas price to the oracol");
    }

}

module.exports = {
    predictGasPrice,
    getAdjustedGasPriceBasedOnTransactionsConcurrency
}