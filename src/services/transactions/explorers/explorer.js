const {connectToBlockchain, getSenderAddress} = require("../../../connectors/blockchainConnector");


async function getNonceFromBCForRedis(){
    const address = await getSenderAddress()
    const web3 = await connectToBlockchain();
    let nonce = await web3.eth.getTransactionCount(address, 'latest')
    return Number(nonce)
}

module.exports = {
    getNonceFromBCForRedis
}