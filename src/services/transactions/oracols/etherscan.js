const axios = require("axios");
const {fromGweiToWei, estimateTransactionTime} = require("./common");
const appLogger = require("../../loggers/applogger");
const {configurator} = require("../../../config");


async function etherscanGasPriceOracol(){
    const apiKey = await configurator.getConfig('etherscanKey')
    const chainId = await configurator.getConfig('blockchain.chainId')
    const api = axios.create({baseURL: `https://api.etherscan.io/v2/api?chainid=${chainId}&module=gastracker&action=gasoracle&apikey=${apiKey}`,})

    const chosenOne = "FastGasPrice"  //"SafeGasPrice"  "ProposeGasPrice"

    try {
        let response = await api.get();
        if (response.status !== 200) return;

        const result = response.data.result;
        const baseFee = parseFloat(result.suggestBaseFee);
        const maxPriorityFeePerGas = parseFloat(result[chosenOne]);
        const maxFeePerGas = baseFee + maxPriorityFeePerGas;
        return {
            baseFee: baseFee,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            maxFeePerGas: maxFeePerGas,
            estimatedTime: await estimateTransactionTime(fromGweiToWei(baseFee+maxPriorityFeePerGas))
        }

    } catch (error) {
        appLogger.error({error:error}, "Error Etherscan oracol");
        return null
    }
}

module.exports = {
    etherscanGasPriceOracol
}