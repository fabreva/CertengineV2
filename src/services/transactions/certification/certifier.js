const {connectToBlockchain, getBlockchainNameAndUrl} = require("../../../connectors/blockchainConnector");
const redisClient = require("../../redis/redisClient");
const {getSignedTransaction} = require("./transactionMaker");
const {dateFormatting} = require("../../../utils/common");
const {transformInEur, fromWeiToGwei} = require("../oracols/common");
const appLogger = require("../../loggers/applogger");


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function bumpGasPrice(price, factor = 0.15) {
    return {
        ...price,
        maxPriorityFeePerGas: Math.ceil(Number(price.maxPriorityFeePerGas) * (1 + factor)),
        maxFeePerGas: Math.ceil(Number(price.maxFeePerGas) * (1 + factor)),
    };
}

async function getNonceFromRedis(){
    return await redisClient.incrementAndGetNonce();
}


async function transact(data, nonce, price, sender, to = null, gasOverride = null){
    const web3 = await connectToBlockchain();
    const futureTransactionRetries = 5;

    const currentDate = new Date();
    let ts = dateFormatting(currentDate);
    let retry = 0
    while(retry < futureTransactionRetries && retry !== -1){
        appLogger.debug(undefined,`nonce ${nonce} - retry ${retry}`)
        try{
            const signedTx = await getSignedTransaction(data, nonce, price, sender, to, gasOverride)
            let receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            const transactionHash = receipt.transactionHash
            const effectiveGasPrice = Number(receipt.effectiveGasPrice)
            const gasUsed = Number(receipt.gasUsed)
            const {name, url} = await getBlockchainNameAndUrl()
            let {eur: eur, status:status} = await redisClient.getEURfromRedis()
            return {
                blockchainURL: url,
                blockchainName: name,
                transactionHash: transactionHash,
                transactionTimestamp: ts,
                priceEUR: await transformInEur(fromWeiToGwei(effectiveGasPrice), gasUsed, eur),
                wallet: sender.address
            }
        }catch (e) {
            appLogger.error({context:{nonce:nonce, price:price, reason: e.reason}, error:e},"Certifier - Error while transacting");
            if(e?.cause?.code === -32000){
                const errorMessage = e.cause.message;
                if (errorMessage === 'replacement transaction underpriced') {
                    await sleep(5000);
                    price = bumpGasPrice(price);
                    retry++;
                }
                if (errorMessage.startsWith('nonce too low')) {
                    await sleep(5000);
                    nonce = Number(await web3.eth.getTransactionCount(sender.address, 'pending'));
                    retry++;
                }
                if (errorMessage === 'transaction underpriced') {
                    retry=-1;
                }
            }else{
                retry = -1
                throw e;
            }
        }
    }
}

async function transactOnBC(data, gasPrice, sender, to = null, gasOverride = null){
    let receipt = null;
    let nonce;
    let incremented = false;
    try{
        incremented = await redisClient.blindIncrement(`concurrentTransactions`);
        nonce = await getNonceFromRedis();
        appLogger.debug(`nonce: ${nonce} - merkle root: ${data}`);
        receipt = await transact(data, nonce, gasPrice, sender, to, gasOverride);
        if(!receipt){
            throw new Error("Transaction failed with nonce " + nonce);
        }
        return receipt;
    } catch (error) {
        appLogger.error({context:{price:gasPrice}, error}, 'Certifier - Error while sending the transaction');
        throw error;
    } finally {
        if (incremented) {
            await redisClient.blindDecrement(`concurrentTransactions`);
        }
    }
}

module.exports = {transactOnBC}