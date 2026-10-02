import request from 'supertest';
import app from '../../../src/app.js';
import { configurator } from '../../../src/config.js';

export const PRINT_LOG = process.env.PRINT_LOG === 'true';

/**
 * Builds a test client bound to the in-process app.
 * Resolves the API key the same way the service does (via the configurator),
 * so the value the tests send and the value the service validates are always the same.
 */
export async function makeClient() {
    const agent = request.agent(app);
    const apiKey = await configurator.getConfig('serviceApiKey');
    return new TestClient(agent, apiKey);
}

export class TestClient {
    constructor(agent, apiKey) {
        this.agent = agent;
        this.apiKey = apiKey;
        this.io = [];
    }

    resetIO() { this.io = []; }

    /**
     * @param method 'post' | 'get' | 'delete'
     * @param api    e.g. '/api/requestCert'
     * @param payload body (POST) or query (GET/DELETE)
     * @param opts   { auth?: boolean, key?: string }  auth defaults to true; key overrides the API key
     */
    async call(method, api, payload = {}, opts = {}) {
        const auth = opts.auth !== false;                         // default: authenticated
        const key = opts.key !== undefined ? opts.key : this.apiKey;

        let req;
        if (method === 'post') req = this.agent.post(api);
        else if (method === 'get') req = this.agent.get(api);
        else if (method === 'delete') req = this.agent.delete(api);
        else throw new Error(`Unsupported method: ${method}`);

        if (auth) req = req.set('X-API-Key', key);

        const res = (method === 'post') ? await req.send(payload) : await req.query(payload);

        this.io.push({ method, api, req: payload, res });
        return res;
    }
}

/** afterEach helper: prints recorded request/response when verbose, and always on failure. */
export function logIO(testCtx, client) {
    const failed = testCtx.currentTest && testCtx.currentTest.state === 'failed';
    if (!PRINT_LOG && !failed) return;
    console.log(`\n— ${testCtx.currentTest.title}${failed ? '  [FAILED]' : ''}`);
    for (const e of client.io) {
        console.log(`  ${e.method.toUpperCase()} ${e.api}`);
        console.log(`  request:  ${JSON.stringify(e.req)}`);
        console.log(`  response: ${JSON.stringify(e.res.body)}`);
    }
}

/** A well-formed but (practically) non-existent ObjectId, for "ticket not found" cases. */
export const FAKE_TICKET = '000000000000000000000000';

/** Fresh, collision-free sample document for tests that need real data. */
export function sampleDoc(prefix = 'T') {
    const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { id, toBeCertified: [{ FIELD: 'value' }, { QTA: 1 }] };
}

/** Fresh owner name, so each test gets its own isolated queue. */
export function freshOwner(prefix = 'AnomalyOwner') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
