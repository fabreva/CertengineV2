import assert from "node:assert/strict";
import request from "supertest";
import app from "../../src/app.js";
import { configurator } from "../../src/config.js";
import { connectToBlockchain } from "../../src/connectors/blockchainConnector.js";

const USER = "erc-check";

let api;
let provider;

describe("MLS1 ERC check", function () {
    this.timeout(600000);

    before(async function () {
        const web3 = await connectToBlockchain();
        const chainId = String(await web3.eth.getChainId());
        if (chainId === "1") {
            throw new Error("ERC check refuses mainnet chain id 1");
        }
        provider = web3.provider;
        const agent = request.agent(app);
        const apiKey = await configurator.getConfig("serviceApiKey");
        api = {
            post(path, body) {
                return agent.post(path).set("X-API-Key", apiKey).send(body);
            },
            get(path) {
                return agent.get(path).set("X-API-Key", apiKey);
            },
        };
    });

    it("erc721 certify returns a transaction hash", async function () {
        const outcome = await certify("erc721");
        assert.equal(outcome.status, 200);
        assert.ok(outcome.transactionHash);
    });

    it("sbt certify returns a transaction hash", async function () {
        const outcome = await certify("sbt");
        assert.equal(outcome.status, 200);
        assert.ok(outcome.transactionHash);
    });

    it("erc1155 certify accepts quantity", async function () {
        const outcome = await certify("erc1155", { quantity: "1" });
        assert.equal(outcome.status, 200);
        assert.ok(outcome.transactionHash);
    });

    it("serializeErc1155 returns a transaction hash", async function () {
        const minted = await certify("erc1155", { quantity: "1" });
        assert.equal(minted.status, 200, JSON.stringify(minted.body));
        const serialized = await api.post("/api/serializeErc1155", {
            owner: freshOwner("serialize"),
            familyId: minted.familyId,
            progressives: ["1"],
            gasPrice: await currentGasPrice(),
        });
        assert.equal(serialized.status, 200, JSON.stringify(serialized.body));
        assert.ok(serialized.body.data.result.transactionHash);
    });

    it("estimate above CONTRACT_GAS_CAP does not sign", async function () {
        const minted = await certify("erc1155", { quantity: "1" });
        assert.equal(minted.status, 200, JSON.stringify(minted.body));
        const previous = configurator.config.blockchain.contractGasCap;
        configurator.config.blockchain.contractGasCap = "1";
        try {
            const serialized = await api.post("/api/serializeErc1155", {
                owner: freshOwner("cap"),
                familyId: minted.familyId,
                progressives: ["1"],
                gasPrice: await currentGasPrice(),
            });
            assert.equal(serialized.status, 400);
            assert.equal(serialized.body.error, "Contract gas estimate exceeds CONTRACT_GAS_CAP");
            assert.equal(serialized.body.data, undefined);
        } finally {
            configurator.config.blockchain.contractGasCap = previous;
        }
    });

    it("missing RPC returns an error", async function () {
        const web3 = await connectToBlockchain();
        web3.setProvider("http://127.0.0.1:9");
        try {
            const outcome = await certify("erc721");
            assert.notEqual(outcome.status, 200);
            assert.equal(outcome.transactionHash, undefined);
        } finally {
            web3.setProvider(provider);
        }
    });
});

async function currentGasPrice() {
    const res = await api.get("/api/getGasPrice");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.result;
}

async function certify(mode, extra = {}) {
    const owner = freshOwner(mode);
    const requested = await api.post("/api/requestCert", {
        owner,
        user: USER,
        data: [{
            id: `${mode}-${Math.random().toString(36).slice(2, 8)}`,
            toBeCertified: [{ mode, salt: Math.random().toString(36).slice(2) }],
        }],
        anchorMode: mode,
        ...extra,
    });
    if (requested.status !== 200) {
        return { status: requested.status, body: requested.body };
    }
    const certified = await api.post("/api/certify", {
        owner,
        user: USER,
        ticket: requested.body.data.result,
        gasPrice: await currentGasPrice(),
    });
    const result = certified.body?.data?.result;
    return {
        status: certified.status,
        body: certified.body,
        transactionHash: result?.transactionHash,
        familyId: result?.familyId,
    };
}

function freshOwner(label) {
    return `erc-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
