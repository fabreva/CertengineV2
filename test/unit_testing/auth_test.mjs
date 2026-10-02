import chai from 'chai';
import { makeClient, logIO, FAKE_TICKET, freshOwner } from './utils/client.mjs';
import { checkError, checkOk } from './utils/otherCheckers.mjs';

const expect = chai.expect;

let client;

describe('Authentication', function () {

    before(async function () {
        this.timeout(10000);
        client = await makeClient();
    });

    beforeEach(function () { client.resetIO(); });
    afterEach(function () { logIO(this, client); });

    const owner = freshOwner();

    it('rejects a protected endpoint with no API key', async function () {
        const res = await client.call('get', '/api/getTicketStatus',
            { owner, ticket: FAKE_TICKET }, { auth: false });
        checkError(res, 401, undefined, 'no key');
    });

    it('rejects a protected endpoint with a wrong API key', async function () {
        const res = await client.call('get', '/api/getTicketStatus',
            { owner, ticket: FAKE_TICKET }, { key: 'definitely-wrong-key' });
        checkError(res, 401, undefined, 'wrong key');
    });

    it('rejects requestCert with no API key (auth runs before validation)', async function () {
        // even with a totally invalid body, auth must fire first -> 401, not 400
        const res = await client.call('post', '/api/requestCert', { garbage: true }, { auth: false });
        checkError(res, 401, undefined, 'no key, bad body');
    });

    it('rejects a stats endpoint with no API key', async function () {
        const res = await client.call('get', '/api/getUsageStats', {}, { auth: false });
        checkError(res, 401, undefined, 'stats no key');
    });

    it('allows /api/ping without an API key', async function () {
        const res = await client.call('get', '/api/ping', { message: 'PING' }, { auth: false });
        const result = checkOk(res, 200, 'ping open');
        expect(result, 'ping should answer PONG').to.equal('PONG');
    });

    it('allows /api/metrics without an API key', async function () {
        const res = await client.call('get', '/api/metrics', {}, { auth: false });
        expect(res.status, 'metrics should be reachable without auth').to.equal(200);
    });

    it('passes through with the correct key (reaches the controller, returns 404 for a missing ticket)', async function () {
        // correct key -> auth passes -> controller runs -> 404 proves we got past the middleware
        const res = await client.call('get', '/api/getTicketStatus', { owner, ticket: FAKE_TICKET });
        checkError(res, 404, undefined, 'authed, ticket not found');
    });
});
