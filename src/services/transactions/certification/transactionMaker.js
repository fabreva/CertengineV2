const {connectToBlockchain, getReceiverAddress, getGas} = require("../../../connectors/blockchainConnector");


async function getSignedTransaction(data, nonce, price, sender, to = null, gasOverride = null){
    const web3 = await connectToBlockchain();
    const maxPriorityFeePerGas = price.maxPriorityFeePerGas;
    const maxFeePerGas = price.maxFeePerGas;

    const txData = data.startsWith('0x') ? data : '0x' + data;

    
    const receiver = to || await getReceiverAddress();
    const gasLimit = gasOverride || await getGas();

    const rawTx = {
        from: sender.address,
        to: receiver,
        value: 0,
        gas: gasLimit, 
        maxPriorityFeePerGas: web3.utils.toHex(maxPriorityFeePerGas),
        maxFeePerGas: web3.utils.toHex(maxFeePerGas),
        data: txData,
        nonce : nonce,
        type: 2
    };
    
    return await web3.eth.accounts.signTransaction(rawTx, sender.privateKey);
}

module.exports = {
    getSignedTransaction,
}