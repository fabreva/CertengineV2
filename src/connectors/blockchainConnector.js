const { default: Web3 } = require('web3');
const {configurator} = require("../config");
const appLogger = require("../services/loggers/applogger");


async function getBlockchainNameAndUrl(){
    return {
        name: await configurator.getConfig('blockchain.blockchainName'),
        url : await configurator.getConfig('blockchain.blockchainURL')
    };
}

let defaultWeb3 = null;

async function connectToBlockchain(blockchainURL){
    if(blockchainURL){
        return new Web3(blockchainURL);
    }
    if(!defaultWeb3){
        defaultWeb3 = new Web3(await configurator.getConfig('blockchain.blockchainURL'));
    }
    return defaultWeb3;
}

async function getSenderAddress(){
    return await configurator.getConfig('blockchain.ethSender.address');
}

async function getSenderAccount(){
    return await configurator.getConfig('blockchain.ethSender');
}

async function getReceiverAddress(){
    return await configurator.getConfig('blockchain.ethReceiver.address');
}

async function getGas(){
    return await configurator.getConfig('blockchain.gas')
}

async function checkBlockchainConnection(){
    const web3 = await connectToBlockchain();
    if(await web3.eth.net.isListening()){
        appLogger.info(undefined, "BLOCKCHAIN - Reachable")
    }else{
        appLogger.warn("BLOCKCHAIN - Not reachable")
    }
}

module.exports = {
    getBlockchainNameAndUrl,
    connectToBlockchain,
    getSenderAccount,
    getSenderAddress,
    getReceiverAddress,
    checkBlockchainConnection,
    getGas
};