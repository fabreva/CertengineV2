import { makeClient, logIO, freshOwner } from './utils/client.mjs';
import { checkError } from './utils/otherCheckers.mjs';

let client;
const owner = freshOwner();
const user = 'test@test.com';
const goodDoc = { id: 'V1', toBeCertified: [{ A: 1 }] };

describe('Input validation (400s, no gas)', function () {

    before(async function () {
        this.timeout(10000);
        client = await makeClient();
    });

    beforeEach(function () { client.resetIO(); });
    afterEach(function () { logIO(this, client); });

    describe('requestCert', function () {
        it('missing owner', async function () {
            const res = await client.call('post', '/api/requestCert', { user, data: [goodDoc] });
            checkError(res, 400, undefined, 'no owner');
        });
        it('missing user', async function () {
            const res = await client.call('post', '/api/requestCert', { owner, data: [goodDoc] });
            checkError(res, 400, undefined, 'no user');
        });
        it('missing data', async function () {
            const res = await client.call('post', '/api/requestCert', { owner, user });
            checkError(res, 400, undefined, 'no data');
        });
        it('data is not an array', async function () {
            const res = await client.call('post', '/api/requestCert', { owner, user, data: { id: 'x' } });
            checkError(res, 400, undefined, 'data not array');
        });
        it('data element id not a string', async function () {
            const res = await client.call('post', '/api/requestCert',
                { owner, user, data: [{ id: 123, toBeCertified: [{ A: 1 }] }] });
            checkError(res, 400, undefined, 'id not string');
        });
        it('toBeCertified not an array', async function () {
            const res = await client.call('post', '/api/requestCert',
                { owner, user, data: [{ id: 'x', toBeCertified: 'nope' }] });
            checkError(res, 400, undefined, 'toBeCertified not array');
        });
        it('rejects unknown extra field (checkExact)', async function () {
            const res = await client.call('post', '/api/requestCert',
                { owner, user, data: [goodDoc], surprise: 1 });
            checkError(res, 400, undefined, 'extra field');
        });
        // depends on fix #12 (hashAlgorithm allowlist). Without it this returns 500.
        it('unsupported hashAlgorithm', async function () {
            const res = await client.call('post', '/api/requestCert',
                { owner, user, data: [goodDoc], hashAlgorithm: 'md5-but-not-allowed' });
            checkError(res, 400, undefined, 'bad hashAlgorithm');
        });
    });

    describe('abortCert', function () {
        it('missing owner', async function () {
            const res = await client.call('delete', '/api/abortCert', { id: 'x', ticket: '000000000000000000000000' });
            checkError(res, 400, undefined, 'no owner');
        });
        it('ticket not a valid mongo id', async function () {
            const res = await client.call('delete', '/api/abortCert', { owner, id: 'x', ticket: 'not-an-id' });
            checkError(res, 400, undefined, 'bad ticket');
        });
        it('missing id', async function () {
            const res = await client.call('delete', '/api/abortCert', { owner, ticket: '000000000000000000000000' });
            checkError(res, 400, undefined, 'no id');
        });
    });

    describe('certify', function () {
        const ticket = '000000000000000000000000';
        const gp = { baseFee: 10, maxPriorityFeePerGas: 2, maxFeePerGas: 12 };

        it('ticket not a valid mongo id', async function () {
            const res = await client.call('post', '/api/certify', { owner, user, ticket: 'nope', gasPrice: gp });
            checkError(res, 400, undefined, 'bad ticket');
        });
        it('missing gasPrice', async function () {
            const res = await client.call('post', '/api/certify', { owner, user, ticket });
            checkError(res, 400, undefined, 'no gasPrice');
        });
        it('gasPrice not an object', async function () {
            const res = await client.call('post', '/api/certify', { owner, user, ticket, gasPrice: 'cheap' });
            checkError(res, 400, undefined, 'gasPrice not object');
        });
        it('gasPrice.baseFee missing', async function () {
            const res = await client.call('post', '/api/certify',
                { owner, user, ticket, gasPrice: { maxPriorityFeePerGas: 2, maxFeePerGas: 12 } });
            checkError(res, 400, undefined, 'no baseFee');
        });
        it('gasPrice.baseFee negative', async function () {
            const res = await client.call('post', '/api/certify',
                { owner, user, ticket, gasPrice: { baseFee: -1, maxPriorityFeePerGas: 2, maxFeePerGas: 12 } });
            checkError(res, 400, undefined, 'negative baseFee');
        });
        it('gasPrice.baseFee non-numeric', async function () {
            const res = await client.call('post', '/api/certify',
                { owner, user, ticket, gasPrice: { baseFee: 'abc', maxPriorityFeePerGas: 2, maxFeePerGas: 12 } });
            checkError(res, 400, undefined, 'non-numeric baseFee');
        });
    });

    describe('verify', function () {
        const validHash = '0x' + 'a'.repeat(64);
        const base = {
            proof: [],
            transactionHash: validHash,
            data: [{ A: 1 }],
            blockchainURL: 'https://example.com',
        };
        it('proof not an array', async function () {
            const res = await client.call('post', '/api/verify', { ...base, proof: 'nope' });
            checkError(res, 400, undefined, 'proof not array');
        });
        it('transactionHash wrong format', async function () {
            const res = await client.call('post', '/api/verify', { ...base, transactionHash: '0x123' });
            checkError(res, 400, undefined, 'bad txHash');
        });
        it('data not an array', async function () {
            const res = await client.call('post', '/api/verify', { ...base, data: { A: 1 } });
            checkError(res, 400, undefined, 'data not array');
        });
        it('blockchainURL not a URL', async function () {
            const res = await client.call('post', '/api/verify', { ...base, blockchainURL: 'not a url' });
            checkError(res, 400, undefined, 'bad url');
        });
        // depends on fix #12 (hashAlgorithm allowlist)
        it('unsupported hashAlgorithm', async function () {
            const res = await client.call('post', '/api/verify', { ...base, hashAlgorithm: 'rot13' });
            checkError(res, 400, undefined, 'bad hashAlgorithm');
        });
    });

    describe('getTicketStatus', function () {
        it('ticket not a valid mongo id', async function () {
            const res = await client.call('get', '/api/getTicketStatus', { owner, ticket: 'nope' });
            checkError(res, 400, undefined, 'bad ticket');
        });
        it('missing owner', async function () {
            const res = await client.call('get', '/api/getTicketStatus', { ticket: '000000000000000000000000' });
            checkError(res, 400, undefined, 'no owner');
        });
    });

    describe('ping', function () {
        it('missing message', async function () {
            const res = await client.call('get', '/api/ping', {}, { auth: false });
            checkError(res, 400, undefined, 'no message');
        });
        it('wrong message', async function () {
            const res = await client.call('get', '/api/ping', { message: 'NOPE' }, { auth: false });
            checkError(res, 400, undefined, 'wrong message');
        });
    });

    describe('stats', function () {
        it('getTransactions page not an int', async function () {
            const res = await client.call('get', '/api/getTransactions', { page: 'x' });
            checkError(res, 400, undefined, 'bad page');
        });
    });
});
