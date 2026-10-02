const {Web3} = require("web3");
const {connectToBlockchain, getReceiverAddress} = require("../../connectors/blockchainConnector");
const {configurator} = require("../../config");
const {normalizeFamilyId, familyTokenId} = require("./tokenIds");
const {certEngine721} = require("./contractAbis");
const BaseContractAdapter = require("./BaseContractAdapter");

class Erc721Adapter {
    async anchor(context) {
        const familyId = normalizeFamilyId(context.merkleRoot);
        const tokenId = familyTokenId(familyId);
        const receiver = await getReceiverAddress();
        const abi = certEngine721();
        const address = await configurator.getConfig("blockchain.contracts.erc721");
        const base = new BaseContractAdapter(abi, address);
        await assertTokenAbsent(abi, address, tokenId);

        const calldata = new Web3().eth.abi.encodeFunctionCall(
            abi.find((item) => item.name === "mintCertified" && item.type === "function"),
            [familyId, receiver]
        );
        let result;
        try {
            result = await base.submitCall({
                calldata,
                gasPrice: context.gasPrice,
                sender: context.sender,
                anchorMode: "erc721",
                action: "mint",
                merkleRoot: familyId,
                familyId,
            });
        } catch (error) {
            if (revertMatches(error, "AlreadyMinted()")) throw alreadyMinted();
            throw error;
        }

        const minted = await base.decodeReceiptEvent(result.transactionHash, "CertifiedTokenMinted");
        if (!sameHex(minted.familyId, familyId) || String(minted.tokenId) !== tokenId || !sameHex(minted.owner, receiver)) {
            throw new Error("CertifiedTokenMinted does not match the minted token");
        }
        return {
            ...result,
            tokenId,
            receiver,
            contractAddress: address,
        };
    }
}

async function assertTokenAbsent(abi, address, tokenId) {
    const web3 = await connectToBlockchain();
    const contract = new web3.eth.Contract(abi, address);
    try {
        await contract.methods.ownerOf(tokenId).call();
    } catch (error) {
        return;
    }
    throw alreadyMinted();
}

function alreadyMinted() {
    const error = new Error("Object already minted");
    error.name = "AlreadyMinted";
    return error;
}

function revertMatches(error, signature) {
    const selector = new Web3().eth.abi.encodeFunctionSignature(signature);
    return errorBlob(error).toLowerCase().includes(selector.toLowerCase());
}

function errorBlob(error) {
    const parts = [];
    let current = error;
    for (let depth = 0; current && depth < 6; depth++) {
        parts.push(current.message, current.data, current.reason);
        current = current.cause;
    }
    return parts.filter((part) => part !== undefined).join(" ");
}

function sameHex(left, right) {
    return String(left).toLowerCase() === String(right).toLowerCase();
}

module.exports = Erc721Adapter;
