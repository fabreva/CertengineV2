const axios = require("axios");
const {fromGweiToWei, estimateTransactionTime} = require("./common");
const appLogger = require("../../loggers/applogger");
const {configurator} = require("../../../config");

const api = axios.create({baseURL: "https://api.owlracle.info/v4/sepolia/gas",})

async function owlracolGasPriceOracol(){
    const apiKey = await configurator.getConfig('owlracleKey')

    const params = {
        accept: "100",
        apikey: apiKey
    }
    try {
        let response = await api.get('', { params });
        if (response.status !== 200) return;

        const result = response.data.speeds[0];

        const baseFee = Number(result.baseFee);
        const maxPriorityFeePerGas = Number(result.maxPriorityFeePerGas);
        const maxFeePerGas = Number(result.maxFeePerGas);

        return {
            baseFee: baseFee,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            maxFeePerGas: maxFeePerGas,
            estimatedTime: await estimateTransactionTime(fromGweiToWei(baseFee+maxPriorityFeePerGas))
        }

    } catch (e) {
        if (e?.response?.status >= 500 || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
            appLogger.warn({ provider: 'owlracle', status: e?.response?.status },
                'Owlracle - Gas oracle temporarily unavailable, falling back');
        } else {
            appLogger.error({ error: e }, 'Oracol - Unexpected error while asking Owlracle');
        }
        return null
    }
}

module.exports = {
    owlracolGasPriceOracol
}