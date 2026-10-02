const {Web3} = require("web3");
const {connectToBlockchain, getReceiverAddress} = require("../../connectors/blockchainConnector");
const {configurator} = require("../../config");
const {normalizeFamilyId, familyTokenId, serializedTokenId} = require("./tokenIds");
const {certEngine1155} = require("./contractAbis");
const BaseContractAdapter = require("./BaseContractAdapter");

const MAX_UINT256 = (1n << 256n) - 1n;

class Erc1155Adapter {
    async anchor(context) {
        if (context.action !== "mint") {
            throw new Error("Erc1155Adapter.anchor only mints a family; serialization is a separate call");
        }
        const familyId = normalizeFamilyId(context.merkleRoot);
        const quantity = context.quantity;
        if (typeof quantity !== "string" || !/^[1-9]\d*$/.test(quantity)) {
            const error = new Error("quantity must be a positive integer string");
            error.name = "TicketParams";
            throw error;
        }
        const tokenId = familyTokenId(familyId);
        const receiver = await getReceiverAddress();
        const abi = certEngine1155();
        const address = await configurator.getConfig("blockchain.contracts.erc1155");
        const base = new BaseContractAdapter(abi, address);
        const calldata = encode(abi, "mintFamily", [familyId, quantity, receiver]);
        let result;
        try {
            result = await base.submitCall({
                calldata,
                gasPrice: context.gasPrice,
                sender: context.sender,
                anchorMode: "erc1155",
                action: "mint",
                merkleRoot: familyId,
                familyId,
            });
        } catch (error) {
            if (revertMatches(error, "FamilyAlreadyCreated()")) throw alreadyMinted();
            throw error;
        }

        const minted = await base.decodeReceiptEvent(result.transactionHash, "FamilyMinted");
        if (!sameHex(minted.familyId, familyId) || String(minted.tokenId) !== tokenId || String(minted.quantity) !== quantity || !sameHex(minted.owner, receiver)) {
            throw new Error("FamilyMinted does not match the minted family");
        }
        return {
            ...result,
            tokenId,
            quantity,
            receiver,
            contractAddress: address,
        };
    }

    async serialize(context) {
        const familyId = normalizeFamilyId(context.familyId);
        const progressives = assertProgressives(context.progressives);
        const receiver = await getReceiverAddress();
        const abi = certEngine1155();
        const address = await configurator.getConfig("blockchain.contracts.erc1155");
        const web3 = await connectToBlockchain();
        const contract = new web3.eth.Contract(abi, address);
        const maxBatch = BigInt(await contract.methods.maxSerializeBatch().call());
        if (BigInt(progressives.length) > maxBatch) {
            const error = new Error("progressives exceed maxSerializeBatch");
            error.name = "TicketParams";
            throw error;
        }

        const expected = progressives.map((progressive) => serializedTokenId(familyId, progressive));
        const base = new BaseContractAdapter(abi, address);
        const calldata = encode(abi, "serialize", [familyId, progressives, receiver]);
        const result = await base.submitCall({
            calldata,
            gasPrice: context.gasPrice,
            sender: context.sender,
            anchorMode: "erc1155",
            action: "serialize",
            merkleRoot: familyId,
            familyId,
        });
        const serialized = await base.decodeReceiptEvent(result.transactionHash, "FamilySerialized");
        const eventIds = [...serialized.tokenIds].map((id) => String(id));
        const eventProgressives = [...serialized.progressives].map((id) => String(id));
        if (!sameHex(serialized.familyId, familyId) || !sameHex(serialized.owner, receiver) || !sameList(eventProgressives, progressives) || !sameList(eventIds, expected)) {
            throw new Error("FamilySerialized does not match the calculated token ids");
        }
        return {
            ...result,
            progressives,
            serializedTokenIds: expected,
            receiver,
            contractAddress: address,
        };
    }
}

function assertProgressives(progressives) {
    if (!Array.isArray(progressives) || progressives.length === 0) {
        const error = new Error("progressives must be a non-empty list");
        error.name = "TicketParams";
        throw error;
    }
    const seen = new Set();
    for (const progressive of progressives) {
        if (typeof progressive !== "string" || !/^[1-9]\d*$/.test(progressive) || BigInt(progressive) > MAX_UINT256) {
            const error = new Error("each progressive must be a positive integer string within uint256");
            error.name = "TicketParams";
            throw error;
        }
        if (seen.has(progressive)) {
            const error = new Error("progressives must be unique");
            error.name = "TicketParams";
            throw error;
        }
        seen.add(progressive);
    }
    return progressives;
}

function encode(abi, name, args) {
    const method = abi.find((item) => item.type === "function" && item.name === name);
    if (!method) throw new Error(`ABI has no ${name}`);
    return new Web3().eth.abi.encodeFunctionCall(method, args);
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

function sameList(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

module.exports = Erc1155Adapter;
