import request from 'supertest';

export async function setupServerNoLogin(app) {
    return request.agent(app);
}