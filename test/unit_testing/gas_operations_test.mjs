import chai from 'chai';
import { makeClient, logIO, freshOwner, sampleDoc } from './utils/client.mjs';
import { checkError, checkOk } from './utils/otherCheckers.mjs';

const expect = chai.expect;


const GAS_TESTS_ENABLED = process.env.RUN_GAS_TESTS === 'true';

let client;
const user = 'test@test.com';
const hashAlgo = 'sha256';

async function getGasPrice() {
    const res = await client.call('get', '/api/getGasPrice', {});
    const gp = checkOk(res, 200, 'getGasPrice');
    return {
        baseFee: gp.baseFee,
        maxPriorityFeePerGas: gp.maxPriorityFeePerGas,
        maxFeePerGas: gp.maxFeePerGas
    };
}

describe('Gas-spending anomalies (real transactions)', function () {

    before(async function () {
        if (!GAS_TESTS_ENABLED) {
            console.log('  (skipping gas tests — set RUN_GAS_TESTS=true to enable)');
            this.skip();
        }
        this.timeout(30000);
        client = await makeClient();
    });

    beforeEach(function () { client.resetIO(); });
    afterEach(function () { logIO(this, client); });

    it('double certify on the same ticket: second is rejected, no second transaction', async function () {
        this.timeout(10000000);
        const owner = freshOwner('GasDouble');

        const rc = await client.call('post', '/api/requestCert',
            { owner, user, data: [sampleDoc('D')], hashAlgorithm: hashAlgo });
        const ticket = checkOk(rc, 200, 'requestCert');

        const gasPrice = await getGasPrice();

        const first = await client.call('post', '/api/certify', { owner, user, ticket, gasPrice });
        checkOk(first, 200, 'first certify');

        const second = await client.call('post', '/api/certify', { owner, user, ticket, gasPrice });
        checkError(second, 409, undefined, 'second certify');

        await client.call('get', '/api/downloadCert', { owner, ticket });
        await client.call('delete', '/api/ackDownload', { owner, ticket });
    });

    it('concurrent certify on the same ticket: exactly one wins', async function () {
        this.timeout(10000000);
        const owner = freshOwner('GasConc');

        const rc = await client.call('post', '/api/requestCert',
            { owner, user, data: [sampleDoc('C')], hashAlgorithm: hashAlgo });
        const ticket = checkOk(rc, 200, 'requestCert');

        const gasPrice = await getGasPrice();

        const [a, b] = await Promise.all([
            client.call('post', '/api/certify', { owner, user, ticket, gasPrice }),
            client.call('post', '/api/certify', { owner, user, ticket, gasPrice }),
        ]);

        const statuses = [a.status, b.status].sort();
        expect(statuses, `exactly one certify must win (200) and the other be rejected (409); got ${statuses}`)
            .to.deep.equal([200, 409]);

        await client.call('get', '/api/downloadCert', { owner, ticket });
        await client.call('delete', '/api/ackDownload', { owner, ticket });
    });

    it('concurrent appends are not lost: all documents end up certified', async function () {
        this.timeout(10000000);
        const owner = freshOwner('GasAppend');
        const N = 6;

        const seed = sampleDoc('seed');
        const rc = await client.call('post', '/api/requestCert',
            { owner, user, data: [seed], hashAlgorithm: hashAlgo });
        const ticket = checkOk(rc, 200, 'seed requestCert');

        const docs = Array.from({ length: N }, (_, i) => sampleDoc(`P${i}`));
        const results = await Promise.all(docs.map(d =>
            client.call('post', '/api/requestCert', { owner, user, data: [d], hashAlgorithm: hashAlgo })
        ));
        results.forEach((r, i) => checkOk(r, 200, `append #${i}`));

        const gasPrice = await getGasPrice();
        const cert = await client.call('post', '/api/certify', { owner, user, ticket, gasPrice });
        checkOk(cert, 200, 'certify');

        const dl = await client.call('get', '/api/downloadCert', { owner, ticket });
        const certInfos = checkOk(dl, 200, 'downloadCert');
        expect(certInfos.proofs.length,
            `expected ${N + 1} proofs (seed + ${N} concurrent appends), got ${certInfos.proofs.length}`)
            .to.equal(N + 1);

        await client.call('delete', '/api/ackDownload', { owner, ticket });
    });

    it('certify with zero gas must not certify (no successful 200)', async function () {
        this.timeout(10000000);
        const owner = freshOwner('GasZero');

        const rc = await client.call('post', '/api/requestCert',
            { owner, user, data: [sampleDoc('Z')], hashAlgorithm: hashAlgo });
        const ticket = checkOk(rc, 200, 'requestCert');

        const res = await client.call('post', '/api/certify', {
            owner, user, ticket,
            gasPrice: { baseFee: 0, maxPriorityFeePerGas: 0, maxFeePerGas: 0 }
        });
        expect(res.status, `zero-gas certify must not succeed, got ${res.status} — ${JSON.stringify(res.body)}`)
            .to.not.equal(200);

        const st = await client.call('get', '/api/getTicketStatus', { owner, ticket });
        const status = checkOk(st, 200, 'status after failed certify');
        expect(status.status, 'a failed certify (no gas spent) should leave the ticket Open/retryable').to.equal('Open');
    });
});
