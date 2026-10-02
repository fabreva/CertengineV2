const {getSenderAddress} = require("../../../connectors/blockchainConnector");

async function verifyAuthCentralized(txFromAddress){
    const authorizedAddress = await getSenderAddress()
    return txFromAddress.toLowerCase() === authorizedAddress.toLowerCase();
}

module.exports = {
    verifyAuthCentralized
}