import chai from 'chai';
import { makeClient, logIO, freshOwner, sampleDoc } from './utils/client.mjs';
import { checkError, checkOk } from './utils/otherCheckers.mjs';

const expect = chai.expect;

let client;
const user = 'test@test.com';
const hashAlgo = 'sha256';

describe('Malicious input', function () {

    before(async function () {
        this.timeout(10000);
        client = await makeClient();
    });

    beforeEach(function () { client.resetIO(); });
    afterEach(function () { logIO(this, client); });

    // ── NoSQL injection ──────────────────────────────────────────────
    // express-mongo-sanitize strips '$'/'.' keys; these tests prove a crafted
    // operator object cannot reach another owner's data or bypass the id check.
    describe('NoSQL injection', function () {

        it('operator object as owner must not read another owner\'s queue', async function () {
            // a real queue under a known owner
            const victim = freshOwner('Victim');
            const seed = sampleDoc('inj');
            const rc = await client.call('post', '/api/requestCert',
                { owner: victim, user, data: [seed], hashAlgorithm: hashAlgo });
            const ticket = checkOk(rc, 200, 'victim queue');

            // attacker substitutes the owner name with an operator object
            const res = await client.call('get', '/api/getTicketStatus',
                { owner: { $ne: 'zzz' }, ticket });

            // after sanitize the operator is gone -> owner is no longer the victim's name.
            // a 200 carrying the victim's real status would mean the injection worked.
            expect(res.status, `injection via owner must not succeed — ${JSON.stringify(res.body)}`)
                .to.be.oneOf([400, 404]);

            // cleanup
            await client.call('delete', '/api/abortCert',
                { owner: victim, id: seed.id, ticket }).catch(() => {});
        });

        it('operator object as ticket is rejected', async function () {
            // double defense: sanitize strips '$', and isMongoId rejects a non-string anyway
            const res = await client.call('get', '/api/getTicketStatus',
                { owner: freshOwner('InjT'), ticket: { $gt: '' } });
            checkError(res, 400, undefined, 'operator ticket');
        });

        it('operator object inside abortCert id/ticket does not crash', async function () {
            const res = await client.call('delete', '/api/abortCert',
                { owner: freshOwner('InjA'), id: { $ne: null }, ticket: { $gt: '' } });
            // must be a clean rejection, never a 500 from a malformed query reaching mongo
            expect(res.status, `crafted abort must be rejected cleanly — ${JSON.stringify(res.body)}`)
                .to.be.oneOf([400, 404]);
        });
    });

    // ── Payload abuse / DoS robustness ───────────────────────────────
    // These assert the server STAYS UP and answers; the exact status is secondary.
    // A clean 200/4xx/413 is fine; a hang or crash is the failure.
    describe('Payload abuse', function () {

        it('a very large data array gets a clean response (no crash/hang)', async function () {
            this.timeout(60000);
            const owner = freshOwner('Big');
            const data = Array.from({ length: 5000 }, (_, i) =>
                ({ id: `big-${i}`, toBeCertified: [{ A: i }] }));

            const res = await client.call('post', '/api/requestCert',
                { owner, user, data, hashAlgorithm: hashAlgo });

            expect(res.status, `large batch must get a clean response — got ${res.status}`)
                .to.be.oneOf([200, 400, 413]);
            // NOTE: on 200 this leaves an uncertified queue behind (fresh owner, no interference).
            // No bulk-delete endpoint exists; test DB can be dropped to clean up.
        });

        it('a deeply nested object does not crash the server', async function () {
            const owner = freshOwner('Deep');
            let nested = { v: 1 };
            for (let i = 0; i < 1000; i++) nested = { n: nested };

            const res = await client.call('post', '/api/requestCert',
                { owner, user, data: [{ id: 'deep', toBeCertified: [nested] }], hashAlgorithm: hashAlgo });

            expect(res.status, 'server must answer to deep nesting').to.be.a('number');
            if (res.status === 200) {
                await client.call('delete', '/api/abortCert',
                    { owner, id: 'deep', ticket: res.body.data.result }).catch(() => {});
            }
        });

        it('an oversized single field is handled without crashing', async function () {
            const owner = freshOwner('Huge');
            const huge = 'x'.repeat(2 * 1024 * 1024); // 2 MB string, under the 50mb json limit
            const res = await client.call('post', '/api/requestCert',
                { owner, user, data: [{ id: 'huge', toBeCertified: [{ blob: huge }] }], hashAlgorithm: hashAlgo });

            expect(res.status, 'server must answer to an oversized field').to.be.oneOf([200, 400, 413]);
            if (res.status === 200) {
                await client.call('delete', '/api/abortCert',
                    { owner, id: 'huge', ticket: res.body.data.result }).catch(() => {});
            }
        });
    });
});
