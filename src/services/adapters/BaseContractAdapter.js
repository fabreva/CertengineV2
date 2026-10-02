const {connectToBlockchain, getSenderAddress} = require("../../connectors/blockchainConnector");
const {configurator} = require("../../config");
const {transactOnBC} = require("../transactions/certification/certifier");

class BaseContractAdapter {
    constructor(abi, contractAddress) {
        this.abi = abi;
        this.contractAddress = contractAddress;
    }

    async submitCall({calldata, gasPrice, sender, anchorMode, action, merkleRoot, familyId}) {
        const address = this.#requireAddress();
        const abi = this.#requireAbi();
        const cap = await this.#gasCap();
        const web3 = await connectToBlockchain();
        await this.#assertChain(web3);
        await this.#assertBytecode(web3, address);

        const contract = new web3.eth.Contract(abi, address);
        const owner = await contract.methods.owner().call();
        const senderAddress = await getSenderAddress();
        if (!senderAddress || owner.toLowerCase() !== senderAddress.toLowerCase()) {
            throw new Error("Contract owner is not the service wallet");
        }

        const data = calldata.startsWith("0x") ? calldata : "0x" + calldata;
        const estimate = BigInt(await web3.eth.estimateGas({
            from: sender.address,
            to: address,
            data,
        }));
        if (estimate > cap) {
            throw new Error("Contract gas estimate exceeds CONTRACT_GAS_CAP");
        }

        const receipt = await transactOnBC(data, gasPrice, sender, address, "0x" + estimate.toString(16));
        if (!receipt || !receipt.transactionHash) {
            throw new Error("Contract transaction did not return a receipt");
        }

        return {
            ...receipt,
            chainId: String(await web3.eth.getChainId()),
            from: sender.address,
            to: address,
            status: "success",
            anchorMode,
            action,
            merkleRoot,
            familyId,
            owner,
        };
    }

    #requireAddress() {
        if (typeof this.contractAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(this.contractAddress)) {
            throw new Error("Contract address is not configured");
        }
        return this.contractAddress;
    }

    #requireAbi() {
        if (!Array.isArray(this.abi) || this.abi.length === 0) {
            throw new Error("Contract ABI is missing");
        }
        return this.abi;
    }

    async #gasCap() {
        const raw = await configurator.getConfig("blockchain.contractGasCap");
        if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) {
            throw new Error("CONTRACT_GAS_CAP must be a positive integer");
        }
        return BigInt(raw);
    }

    async #assertChain(web3) {
        const configured = await configurator.getConfig("blockchain.chainId");
        const actual = await web3.eth.getChainId();
        if (configured === undefined || configured === null || String(actual) !== String(configured)) {
            throw new Error("Chain id does not match the configuration");
        }
    }

    async decodeReceiptEvent(transactionHash, eventName) {
        const web3 = await connectToBlockchain();
        const receipt = await web3.eth.getTransactionReceipt(transactionHash);
        const status = receipt ? receipt.status : undefined;
        if (!receipt || status === false || status === 0 || status === 0n || status === "0x0") {
            throw new Error("Contract receipt was not successful");
        }
        const eventAbi = this.abi.find((item) => item.type === "event" && item.name === eventName);
        if (!eventAbi) {
            throw new Error(`ABI has no event ${eventName}`);
        }
        const signature = web3.eth.abi.encodeEventSignature(eventAbi);
        const log = receipt.logs.find((item) =>
            item.topics
            && item.topics[0] === signature
            && item.address.toLowerCase() === this.contractAddress.toLowerCase()
        );
        if (!log) {
            throw new Error(`Receipt has no ${eventName}`);
        }
        return web3.eth.abi.decodeLog(eventAbi.inputs, log.data, log.topics.slice(1));
    }

    async #assertBytecode(web3, address) {
        const code = await web3.eth.getCode(address);
        if (!code || code === "0x" || code === "0x0") {
            throw new Error("No contract bytecode at the configured address");
        }
    }
}

module.exports = BaseContractAdapter;
