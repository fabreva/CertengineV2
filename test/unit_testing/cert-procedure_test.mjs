import chai from 'chai';
import app from '../../src/app.js';
import { setupServerNoLogin } from "./utils/setup.mjs";
import pkg from "./utils/data.js";
import { checkError, checkOk } from "./utils/otherCheckers.mjs";
import { checkCertInfos, checkProofs, checkTicket } from "./utils/certChecker.mjs";
import { getSenderAccount } from "../../src/connectors/blockchainConnector.js";
import { configurator } from "../../src/config.js";

const expect = chai.expect;
const { certData, batch } = pkg;

let apiKey;

// Verbose request/response logging.
// Default OFF. Enable with:  PRINT_LOG=true npm test
const print_log = process.env.PRINT_LOG === 'true';

const owner = "Test Owner";
const user = "test@test.com";
const hashAlgo = 'sha256';

let agent;
let account;

let tickets = [];
let proofs, URL, transactionHash, gasPrice;

let io = [];

function findDataById(id) {
    const i = certData.findIndex(c => c.id === id);
    return i !== -1 ? certData[i] : batch[batch.findIndex(c => c.id === id)];
}

async function call(method, api, payload) {
    let res;
    if (method === 'post')        res = await agent.post(api).set('X-API-Key', apiKey).send(payload);
    else if (method === 'get')    res = await agent.get(api).set('X-API-Key', apiKey).query(payload);
    else if (method === 'delete') res = await agent.delete(api).set('X-API-Key', apiKey).query(payload);
    else throw new Error(`Unsupported method: ${method}`);
    io.push({ method, api, req: payload, res });
    return res;
}

before(async function () {
    this.timeout(10000);
    agent = await setupServerNoLogin(app);
    account = await getSenderAccount();
    apiKey = await configurator.getConfig('serviceApiKey');
    expect(apiKey, 'serviceApiKey must resolve for tests').to.not.be.undefined;

    expect(account.address, 'sender address must be configured').to.not.be.undefined;
    expect(account.privateKey, 'sender privKey must be configured').to.not.be.undefined;
});

describe("Certification procedure test", function () {

    beforeEach(function () {
        io = [];
    });

    afterEach(function () {
        const failed = this.currentTest.state === 'failed';
        if (!print_log && !failed) return;

        console.log(`\n— ${this.currentTest.title}${failed ? '  [FAILED]' : ''}`);
        for (const e of io) {
            console.log(`  ${e.method.toUpperCase()} ${e.api}`);
            console.log(`  request:  ${JSON.stringify(e.req)}`);
            console.log(`  response: ${JSON.stringify(e.res.body)}`);
        }
    });

    it('Request certification for certData', async function () {
        const api = `/api/requestCert`;
        for (const doc of certData) {
            const req = { owner, user, data: [doc], hashAlgorithm: hashAlgo };
            const res = await call('post', api, req);
            const ticket = checkOk(res, 200, 'requestCert certData');
            checkTicket(ticket);
            tickets.push(ticket);
        }
    });

    it('Request certification for batch data', async function () {
        const api = `/api/requestCert`;
        const req = { owner, user, data: batch, hashAlgorithm: hashAlgo };
        const res = await call('post', api, req);
        const ticket = checkOk(res, 200, 'requestCert batch');
        checkTicket(ticket);
        tickets.push(ticket);
    });

    it('Abort certification for an element', async function () {
        const doc = certData.pop();
        const api = `/api/abortCert`;
        const req = { owner, id: doc.id, ticket: tickets.pop() };
        const res = await call('delete', api, req);
        checkOk(res, 200, 'abortCert');
    });

    it('Get gasPrice', async function () {
        this.timeout(10000000);
        const res = await call('get', `/api/getGasPrice`, {});
        gasPrice = checkOk(res, 200, 'getGasPrice');
    });

    it('Certify all data', async function () {
        this.timeout(10000000);
        expect(tickets.length, 'need at least one ticket to certify').to.be.above(0);

        const req = {
            owner, user,
            ticket: tickets[0],
            gasPrice: {
                baseFee: gasPrice.baseFee,
                maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
                maxFeePerGas: gasPrice.maxFeePerGas
            }
        };
        const res = await call('post', `/api/certify`, req);
        const certInfos = checkOk(res, 200, 'certify');
        checkCertInfos(certInfos);
    });

    it('Obtain proofs for certified data', async function () {
        expect(tickets.length, 'need at least one ticket to download').to.be.above(0);

        const res1 = await call('get', `/api/downloadCert`, { owner, ticket: tickets[0] });
        const certInfos = checkOk(res1, 200, 'downloadCert');
        checkProofs(certInfos, hashAlgo);
        URL = certInfos.blockchainURL;
        proofs = certInfos.proofs;
        transactionHash = certInfos.transactionHash;

        const res2 = await call('delete', `/api/ackDownload`, { owner, ticket: tickets[0] });
        checkOk(res2, 200, 'ackDownload');
    });

    it('Certification queue should not exist after certification download', async function () {
        expect(tickets.length, 'need at least one ticket').to.be.above(0);
        const res = await call('get', `/api/downloadCert`, { owner, ticket: tickets[0] });
        checkError(res, 404, undefined, 'downloadCert after ack');
    });

    it('Verification of correct certified data should be valid', async function () {
        this.timeout(10000000);
        expect(proofs.length, 'need proofs to verify').to.be.above(0);
        expect(typeof transactionHash, 'transactionHash should be a string').to.equal('string');
        expect(typeof URL, 'blockchainURL should be a string').to.equal('string');

        for (let i = 0; i < proofs.length; i++) {
            const dataID = proofs[i].id;
            const idx = certData.findIndex(c => c.id === dataID);
            const data = idx !== -1 ? certData[idx] : batch[batch.findIndex(c => c.id === dataID)];

            const req = {
                proof: proofs[i].proof,
                transactionHash,
                data: data.toBeCertified,
                blockchainURL: URL,
                hashAlgorithm: hashAlgo
            };
            const res = await call('post', `/api/verify`, req);
            const certInfos = checkOk(res, 200, `verify valid #${i} (id=${dataID})`);

            expect(certInfos.valid, `verify #${i}: valid`).to.equal(true);
            expect(certInfos.integrity.passed, `verify #${i}: integrity.passed`).to.equal(true);
            expect(certInfos.integrity.reason, `verify #${i}: integrity.reason`).to.equal("OK");
            expect(certInfos.authenticity.passed, `verify #${i}: authenticity.passed`).to.equal(true);
            expect(certInfos.authenticity.reason, `verify #${i}: authenticity.reason`).to.equal("OK");
        }
    });

    it('Verification of tampered certified data should be not valid', async function () {
        this.timeout(10000000);
        expect(proofs.length, 'need at least 2 proofs to cross-mismatch').to.be.above(1);

        const victimProof = proofs[0];
        const otherId = proofs.find(p => p.id !== victimProof.id).id;
        const otherData = findDataById(otherId);

        const req = {
            proof: victimProof.proof,
            transactionHash,
            data: otherData.toBeCertified,
            blockchainURL: URL,
            hashAlgorithm: hashAlgo
        };
        const res = await call('post', `/api/verify`, req);
        const certInfos = checkOk(res, 200, 'verify tampered');

        expect(certInfos.valid, 'mismatched proof/data must be invalid').to.equal(false);
        expect(certInfos.integrity.passed, 'integrity must fail').to.equal(false);
        expect(certInfos.integrity.reason).to.equal("TAMPERED DATA");
        expect(certInfos.authenticity.passed, 'authenticity still OK').to.equal(true);
    });

    it('If requesting certification for multiple data, the hashing algorithm must always be the same', async function () {
        const api = `/api/requestCert`;
        const req1 = { owner, user, data: [certData[0]], hashAlgorithm: "sha256" };
        const req2 = { owner, user, data: [certData[1]], hashAlgorithm: "sha512" };

        const res1 = await call('post', api, req1);
        const t = checkOk(res1, 200, 'requestCert sha256');

        const res2 = await call('post', api, req2);
        checkError(res2, 400, undefined, 'requestCert sha512 mismatch');

        await call('delete', `/api/abortCert`, { owner, id: certData[0].id, ticket: t });
    });
});
