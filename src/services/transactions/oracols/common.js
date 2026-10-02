const axios = require("axios");
const {configurator} = require("../../../config");
const {getGas} = require("../../../connectors/blockchainConnector");
const appLogger = require("../../loggers/applogger");


async function estimateTransactionTime(weiGasPrice) {
    try {
        const apiKey = await configurator.getConfig('etherscanKey');
        const { data } = await axios.get('https://api.etherscan.io/v2/api', {
            params: {chainid: 1, module: 'gastracker', action: 'gasestimate', gasprice: weiGasPrice, apikey: apiKey}
        });

        const secs = Number(data?.result);

        if (!Number.isFinite(secs)) {
            throw new Error(`Invalid gas estimate response: ${data?.result}`);
        }

        const minutes = Math.floor(secs / 60);
        const seconds = secs % 60;

        return {
            seconds: secs,
            minutes,
            formatted: `${minutes} min : ${seconds} sec`
        };

    } catch (err) {
        appLogger.error({error:err}, "Etherscan gas estimate failed");
        return null;
    }
}

async function transformInEur(gweiPrice, effectiveGas, eur) {
    const gas = effectiveGas || await getGas()
    const etherPrice = (gweiPrice*gas)/1000000000;
    return etherPrice*eur;
}


function fromGweiToWei(Gwei){
    return Math.floor(Gwei*1000000000)
}
function fromWeiToGwei(wei){
    return wei/1000000000
}
function fromGweiToEth(gwei){
    return gwei/1000000000
}

module.exports = {
    transformInEur,
    estimateTransactionTime,
    fromGweiToWei,
    fromWeiToGwei,
    fromGweiToEth
}