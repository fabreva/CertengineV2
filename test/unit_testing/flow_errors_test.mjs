import chai from 'chai';
import { makeClient, logIO, FAKE_TICKET, freshOwner, sampleDoc } from './utils/client.mjs';
import { checkError, checkOk } from './utils/otherCheckers.mjs';

const expect = chai.expect;

let client;
const user = 'test@test.com';
const hashAlgo = 'sha256';

// Helper: create a fresh, uncertified queue and return its ticket + owner.
async function createUncertifiedQueue() {
    const owner = freshOwner('Flow');
    const res = await client.call('post', '/api/requestCert',
        { owner, user, data: [sampleDoc('Flow')], hashAlgorithm: hashAlgo });
    const ticket = checkOk(res, 200, 'setup requestCert');
    return { owner, ticket };
}

describe('Flow errors (404 / 409, no gas)', function () {

    before(async function () {
        this.timeout(10000);
        client = await makeClient();
    });

    beforeEach(function () { client.resetIO(); });
    afterEach(function () { logIO(this, client); });

    describe('non-existent ticket', function () {
        const owner = freshOwner('FlowNX');

        it('getTicketStatus -> 404', async function () {
            const res = await client.call('get', '/api/getTicketStatus', { owner, ticket: FAKE_TICKET });
            checkError(res, 404, undefined, 'status nonexistent');
        });

        it('downloadCert -> 404', async function () {
            const res = await client.call('get', '/api/downloadCert', { owner, ticket: FAKE_TICKET });
            checkError(res, 404, undefined, 'download nonexistent');
        });

        it('ackDownload -> 404', async function () {
            const res = await client.call('delete', '/api/ackDownload', { owner, ticket: FAKE_TICKET });
            checkError(res, 404, undefined, 'ack nonexistent');
        });

        it('certify -> 409 (no queue to lock, must not spend gas)', async function () {
            this.timeout(60000);
            const res = await client.call('post', '/api/certify', {
                owner, user, ticket: FAKE_TICKET,
                gasPrice: { baseFee: 10, maxPriorityFeePerGas: 2, maxFeePerGas: 12 }
            });
            checkError(res, 409, undefined, 'certify nonexistent');
        });

        it('abortCert on a non-existent ticket must not 500', async function () {
            const res = await client.call('delete', '/api/abortCert',
                { owner, id: 'whatever', ticket: FAKE_TICKET });
            expect(res.status, `abort nonexistent should be a clean status, got ${res.status} — ${JSON.stringify(res.body)}`)
                .to.be.oneOf([200, 404]);
        });
    });

    describe('wrong order', function () {

        it('downloadCert before certify -> 409', async function () {
            const { owner, ticket } = await createUncertifiedQueue();
            const res = await client.call('get', '/api/downloadCert', { owner, ticket });
            checkError(res, 409, undefined, 'download before certify');
        });

        it('ackDownload before download -> 409', async function () {
            const { owner, ticket } = await createUncertifiedQueue();
            const res = await client.call('delete', '/api/ackDownload', { owner, ticket });
            checkError(res, 409, undefined, 'ack before download');
        });

        it('an uncertified ticket reports an open status', async function () {
            const { owner, ticket } = await createUncertifiedQueue();
            const res = await client.call('get', '/api/getTicketStatus', { owner, ticket });
            const result = checkOk(res, 200, 'status open');
            expect(result.status, 'a fresh queue should not be in a downloadable/transacting state').to.equal('Open');
        });

        it('abort then status -> the aborted single-doc queue is gone (404)', async function () {
            const owner = freshOwner('FlowAbort');
            const doc = sampleDoc('FlowAbort');
            const rc = await client.call('post', '/api/requestCert',
                { owner, user, data: [doc], hashAlgorithm: hashAlgo });
            const ticket = checkOk(rc, 200, 'requestCert');

            const ab = await client.call('delete', '/api/abortCert', { owner, id: doc.id, ticket });
            checkOk(ab, 200, 'abort');

            // the only document was removed -> the queue is deleted -> status not found
            const st = await client.call('get', '/api/getTicketStatus', { owner, ticket });
            checkError(st, 404, undefined, 'status after abort');
        });
    });

    describe('hash algorithm consistency', function () {
        it('mixing algorithms under the same owner is rejected (400)', async function () {
            const owner = freshOwner('FlowAlgo');
            const docA = sampleDoc('A');
            const r1 = await client.call('post', '/api/requestCert',
                { owner, user, data: [docA], hashAlgorithm: 'sha256' });
            const ticket = checkOk(r1, 200, 'first sha256');

            const r2 = await client.call('post', '/api/requestCert',
                { owner, user, data: [sampleDoc('B')], hashAlgorithm: 'sha512' });
            checkError(r2, 400, undefined, 'second sha512');

            // cleanup
            await client.call('delete', '/api/abortCert', { owner, id: docA.id, ticket }).catch(() => {});
        });
    });
});
