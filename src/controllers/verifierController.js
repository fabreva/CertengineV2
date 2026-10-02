const {handlerSuccessRequest} = require("../responseHandlers/handlerSuccessRequest");
const {handlerErrorRequest} = require("../responseHandlers/handlerErrorRequest");
const appLogger = require("../services/loggers/applogger");
const {connectToBlockchain, getReceiverAddress, getSenderAddress} = require("../connectors/blockchainConnector");
const {configurator} = require("../config");
const {verifyMerkle} = require("../services/transactions/verification/integrityVerification");
const {verifyAuthCentralized} = require("../services/transactions/verification/authenticityVerification");
const {certEngine1155, certEngine721, certEngineSBT721} = require("../services/adapters/contractAbis");
const {familyTokenId, normalizeFamilyId, serializedTokenId} = require("../services/adapters/tokenIds");

const EIP5192 = "0xb45a3c0e";

class VerifierController {

    async #allowedRpc(blockchainURL) {
        const configured = await configurator.getConfig("blockchain.blockchainURL");
        let supplied;
        let allowed;
        try {
            supplied = new URL(blockchainURL);
            allowed = new URL(configured);
        } catch (error) {
            throw rpcRejected("blockchainURL is not the configured endpoint");
        }
        if (supplied.username || supplied.password) {
            throw rpcRejected("blockchainURL must not contain credentials");
        }
        if (supplied.protocol !== "http:" && supplied.protocol !== "https:") {
            throw rpcRejected("blockchainURL is not the configured endpoint");
        }
        if (endpointKey(supplied) !== endpointKey(allowed)) {
            throw rpcRejected("blockchainURL is not the configured endpoint");
        }
        return configured;
    }

    async verify(req, res) {
        const proof = req.body.proof;
        const txHash = req.body.transactionHash;
        const data = req.body.data;
        const blockchainURL = req.body.blockchainURL;
        const anchorMode = req.body.anchorMode;
        const hashAlgo = anchorMode && anchorMode !== "raw"
            ? req.body.hashAlgorithm
            : (req.body.hashAlgorithm ?? "sha256");

        const bcInfo = {
            merkleproof: proof,
            transactionHash: txHash,
            blockchainURL: blockchainURL,
            hashAlgo: hashAlgo
        };

        try {
            if (anchorMode && anchorMode !== "raw" && !hashAlgo) {
                return res.status(400).json(handlerErrorRequest({message: "hashAlgorithm is required for a token certification"}));
            }
            const rpc = await this.#allowedRpc(blockchainURL);
            const web3 = await connectToBlockchain(rpc);
            const chainId = await web3.eth.getChainId();
            const configuredChainId = await configurator.getConfig("blockchain.chainId");
            if (String(chainId) !== String(configuredChainId)) {
                return res.status(400).json(handlerErrorRequest({message: "Chain id does not match the configuration"}));
            }

            const transaction = await web3.eth.getTransaction(txHash);
            if (!transaction) {
                return res.status(400).json(handlerErrorRequest({message: "Transaction not found"}));
            }
            const receipt = await web3.eth.getTransactionReceipt(txHash);
            const asset = await this.#readAsset(web3, transaction, receipt, req.body);
            const root = asset.root;
            const integrityPassed = root ? verifyMerkle(data, root, bcInfo) : false;
            const integrity = {passed: integrityPassed, reason: integrityPassed ? "OK" : "TAMPERED DATA"};
            const authenticityPassed = asset.authenticity && await verifyAuthCentralized(transaction.from);
            const authenticity = {passed: authenticityPassed, reason: authenticityPassed ? "OK" : "ISSUER NOT AUTHORIZED"};
            const assetConsistency = {passed: asset.consistent, reason: asset.consistent ? "OK" : asset.reason};
            const verified = integrityPassed && authenticityPassed && asset.consistent;
            return res.status(200).json(handlerSuccessRequest({
                valid: verified,
                integrity,
                authenticity,
                assetConsistency,
                verified
            }));
        } catch (error) {
            if (error.name === "RpcRejected") {
                return res.status(400).json(handlerErrorRequest({message: error.message}));
            }
            appLogger.error({context: {bcInfo: bcInfo}, error: error}, "Error while verifying certification proof");
            return res.status(500).json(handlerErrorRequest({message: "Internal server error"}));
        }
    }

    async #readAsset(web3, transaction, receipt, body) {
        const mode = body.anchorMode;
        if (!mode || mode === "raw") {
            return this.#readRaw(transaction);
        }
        if (!receiptSucceeded(receipt)) {
            return {root: null, consistent: false, authenticity: false, reason: "RECEIPT FAILED"};
        }
        const contracts = {
            erc1155: await configurator.getConfig("blockchain.contracts.erc1155"),
            erc721: await configurator.getConfig("blockchain.contracts.erc721"),
            sbt: await configurator.getConfig("blockchain.contracts.erc721Sbt")
        };
        const recognized = modeFromAddress(transaction.to, contracts);
        if (recognized !== mode || !sameHex(body.contractAddress, transaction.to)) {
            return {root: null, consistent: false, authenticity: false, reason: "CONTRACT MISMATCH"};
        }
        if (mode === "erc1155") return this.#read1155(web3, transaction, receipt, body);
        if (mode === "erc721") return this.#read721(web3, transaction, receipt, body, certEngine721(), "CertifiedTokenMinted");
        return this.#readSbt(web3, transaction, receipt, body);
    }

    async #readRaw(transaction) {
        const receiver = await getReceiverAddress();
        const input = transaction.input || "";
        const rawInput = /^0x[0-9a-fA-F]{64}$/.test(input);
        const rawTo = sameHex(transaction.to, receiver);
        return {
            root: rawInput ? input : null,
            consistent: rawInput && rawTo,
            authenticity: true,
            reason: rawInput && rawTo ? "OK" : "NOT A RAW CERTIFICATION"
        };
    }

    async #read1155(web3, transaction, receipt, body) {
        const abi = certEngine1155();
        const selector = transaction.input.slice(0, 10).toLowerCase();
        const mintSelector = functionSelector(web3, abi, "mintFamily");
        const serializeSelector = functionSelector(web3, abi, "serialize");
        const owner = await contractOwner(web3, abi, transaction.to);
        const senderOk = await senderIsOwner(transaction.from, owner);
        if (selector === mintSelector) {
            if (body.progressive) return failed("PROGRESSIVE NOT VALID FOR MINT");
            const decoded = decodeCall(web3, abi, "mintFamily", transaction.input);
            const familyId = normalizeFamilyId(decoded.familyId);
            const event = findEvent(web3, receipt, abi, "FamilyMinted", transaction.to);
            const tokenId = familyTokenId(familyId);
            const receiver = await getReceiverAddress();
            const consistent = !!event
                && sameHex(event.familyId, familyId)
                && String(event.tokenId) === tokenId
                && sameHex(event.owner, receiver)
                && sameHex(decoded.receiver, receiver)
                && declaredFamily(body, familyId)
                && declaredToken(body, tokenId);
            return {root: familyId, consistent, authenticity: senderOk && consistent, reason: consistent ? "OK" : "FAMILY MINT MISMATCH"};
        }
        if (selector === serializeSelector) {
            const decoded = decodeCall(web3, abi, "serialize", transaction.input);
            const familyId = normalizeFamilyId(decoded.familyId);
            const progressives = [...decoded.progressives].map((item) => String(item));
            const event = findEvent(web3, receipt, abi, "FamilySerialized", transaction.to);
            const expectedIds = progressives.map((progressive) => serializedTokenId(familyId, progressive));
            const eventIds = event ? [...event.tokenIds].map((item) => String(item)) : [];
            const receiver = await getReceiverAddress();
            let consistent = !!event
                && sameHex(event.familyId, familyId)
                && sameList(progressives, [...event.progressives].map((item) => String(item)))
                && sameList(expectedIds, eventIds)
                && sameHex(event.owner, receiver)
                && sameHex(decoded.receiver, receiver)
                && declaredFamily(body, familyId);
            if (consistent && body.progressive) {
                const index = progressives.indexOf(body.progressive);
                consistent = index >= 0 && declaredToken(body, expectedIds[index]);
            }
            if (consistent && body.tokenId && !body.progressive) {
                consistent = expectedIds.includes(body.tokenId);
            }
            return {root: familyId, consistent, authenticity: senderOk && consistent, reason: consistent ? "OK" : "SERIALIZATION MISMATCH"};
        }
        return failed("UNKNOWN SELECTOR");
    }

    async #read721(web3, transaction, receipt, body, abi, eventName) {
        if (body.progressive) return failed("PROGRESSIVE NOT VALID");
        const selector = transaction.input.slice(0, 10).toLowerCase();
        if (selector !== functionSelector(web3, abi, "mintCertified")) return failed("UNKNOWN SELECTOR");
        const decoded = decodeCall(web3, abi, "mintCertified", transaction.input);
        const familyId = normalizeFamilyId(decoded.familyId);
        const tokenId = familyTokenId(familyId);
        const owner = await contractOwner(web3, abi, transaction.to);
        const event = findEvent(web3, receipt, abi, eventName, transaction.to);
        const receiver = await getReceiverAddress();
        const consistent = !!event
            && sameHex(event.familyId, familyId)
            && String(event.tokenId) === tokenId
            && sameHex(event.owner, receiver)
            && sameHex(decoded.receiver, receiver)
            && declaredFamily(body, familyId)
            && declaredToken(body, tokenId);
        const senderOk = await senderIsOwner(transaction.from, owner);
        return {root: familyId, consistent, authenticity: senderOk && consistent, reason: consistent ? "OK" : "TOKEN MISMATCH"};
    }

    async #readSbt(web3, transaction, receipt, body) {
        const abi = certEngineSBT721();
        const asset = await this.#read721(web3, transaction, receipt, body, abi, "SoulboundIssued");
        if (!asset.consistent) return asset;
        const lockedEvent = findEvent(web3, receipt, abi, "Locked", transaction.to);
        const contract = new web3.eth.Contract(abi, transaction.to);
        const tokenId = familyTokenId(normalizeFamilyId(body.familyId || asset.root));
        let locked = false;
        let supports = false;
        try {
            locked = await contract.methods.locked(tokenId).call();
            supports = await contract.methods.supportsInterface(EIP5192).call();
        } catch (error) {
            return {...asset, consistent: false, authenticity: false, reason: "SBT NOT LOCKED"};
        }
        const consistent = !!lockedEvent && locked === true && supports === true;
        return {...asset, consistent, authenticity: asset.authenticity && consistent, reason: consistent ? "OK" : "SBT NOT LOCKED"};
    }
}

function rpcRejected(message) {
    const error = new Error(message);
    error.name = "RpcRejected";
    return error;
}

function endpointKey(url) {
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}

function failed(reason) {
    return {root: null, consistent: false, authenticity: false, reason};
}

function receiptSucceeded(receipt) {
    if (!receipt || receipt.blockNumber === undefined || receipt.blockNumber === null) return false;
    const status = receipt.status;
    return status === true || status === 1 || status === 1n || status === "0x1";
}

function modeFromAddress(address, contracts) {
    if (sameHex(address, contracts.erc1155)) return "erc1155";
    if (sameHex(address, contracts.erc721)) return "erc721";
    if (sameHex(address, contracts.sbt)) return "sbt";
    return null;
}

function functionSelector(web3, abi, name) {
    const method = abi.find((item) => item.type === "function" && item.name === name);
    return web3.eth.abi.encodeFunctionSignature(method).toLowerCase();
}

function decodeCall(web3, abi, name, input) {
    const method = abi.find((item) => item.type === "function" && item.name === name);
    return web3.eth.abi.decodeParameters(method.inputs, "0x" + input.slice(10));
}

function findEvent(web3, receipt, abi, eventName, address) {
    const eventAbi = abi.find((item) => item.type === "event" && item.name === eventName);
    if (!eventAbi) return null;
    const signature = web3.eth.abi.encodeEventSignature(eventAbi);
    const log = receipt.logs.find((item) =>
        item.topics
        && item.topics[0] === signature
        && sameHex(item.address, address)
    );
    if (!log) return null;
    return web3.eth.abi.decodeLog(eventAbi.inputs, log.data, log.topics.slice(1));
}

async function contractOwner(web3, abi, address) {
    const contract = new web3.eth.Contract(abi, address);
    return contract.methods.owner().call();
}

async function senderIsOwner(from, owner) {
    const sender = await getSenderAddress();
    return sameHex(from, owner) && sameHex(owner, sender);
}

function declaredFamily(body, familyId) {
    return !body.familyId || sameHex(body.familyId, familyId);
}

function declaredToken(body, tokenId) {
    return !body.tokenId || body.tokenId === tokenId;
}

function sameHex(left, right) {
    if (left === undefined || left === null || right === undefined || right === null) return false;
    return String(left).toLowerCase() === String(right).toLowerCase();
}

function sameList(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

module.exports = {
    VerifierController
};
