import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { setup } from './helpers.js';

describe('POST /auth/token', () => {
  it('issues a JWT for valid credentials', async () => {
    const { app } = setup();
    const r = await request(app).post('/api/v1/auth/token').send({ username: '23070001001', password: 'pw' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tokenType: 'Bearer', role: 'student', studentNo: '23070001001' });
    expect(r.body.accessToken).toBeTruthy();
  });
  it('rejects a wrong password and missing fields', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/auth/token').send({ username: '23070001001', password: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/token').send({})).status).toBe(400);
  });
});

describe('GET /mobile/tuition/:studentNo (no auth, 3/day per student)', () => {
  it('returns total, paid and balance without authentication', async () => {
    const { app } = setup();
    const r = await request(app).get('/api/v1/mobile/tuition/23070001001?term=2026-FALL');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ studentNo: '23070001001', scope: '2026-FALL', tuitionTotal: 10000, paidAmount: 2000, balance: 8000, currency: 'TRY' });
  });
  it('returns overall balance when term is omitted', async () => {
    const { app } = setup();
    const r = await request(app).get('/api/v1/mobile/tuition/23070001001');
    expect(r.body.scope).toBe('ALL_TERMS');
    expect(r.body.terms).toHaveLength(1);
  });
  it('blocks the 4th call of the day per student, but not other students, and resets next day', async () => {
    let now = new Date('2026-11-18T10:00:00Z');
    const { app } = setup(() => now);
    for (let i = 0; i < 3; i++) expect((await request(app).get('/api/v1/mobile/tuition/23070001001')).status).toBe(200);
    const blocked = await request(app).get('/api/v1/mobile/tuition/23070001001').set('X-Forwarded-For', '9.9.9.9');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('DAILY_LIMIT_EXCEEDED');
    expect((await request(app).get('/api/v1/mobile/tuition/23070001002')).status).toBe(200);
    now = new Date('2026-11-19T00:05:00Z');
    expect((await request(app).get('/api/v1/mobile/tuition/23070001001')).status).toBe(200);
  });
  it('404s for unknown student or term, 400s for invalid input', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/v1/mobile/tuition/99999999999')).status).toBe(404);
    expect((await request(app).get('/api/v1/mobile/tuition/23070001001?term=2030-FALL')).status).toBe(404);
    expect((await request(app).get('/api/v1/mobile/tuition/23070001001?term=bad')).status).toBe(400);
    expect((await request(app).get('/api/v1/mobile/tuition/2307000600')).status).toBe(400); // 10 digits
    expect((await request(app).get('/api/v1/mobile/tuition/abc07000600')).status).toBe(400); // letters
  });
});

describe('GET /banking/tuition/:studentNo (auth)', () => {
  it('lets a student read their own data and a bank client read anyone', async () => {
    const { app, token } = setup();
    const s = await request(app).get('/api/v1/banking/tuition/23070001001').set('Authorization', `Bearer ${await token('23070001001')}`);
    expect(s.status).toBe(200);
    expect(s.body.balance).toBe(8000);
    const b = await request(app).get('/api/v1/banking/tuition/23070001002').set('Authorization', `Bearer ${await token('bank')}`);
    expect(b.status).toBe(200);
  });
  it('rejects no token (401) and another student\'s data (403)', async () => {
    const { app, token } = setup();
    expect((await request(app).get('/api/v1/banking/tuition/23070001001')).status).toBe(401);
    const r = await request(app).get('/api/v1/banking/tuition/23070001002').set('Authorization', `Bearer ${await token('23070001001')}`);
    expect(r.status).toBe(403);
  });
  it('rejects an admin token (wrong role) and a tampered token', async () => {
    const { app, token } = setup();
    expect((await request(app).get('/api/v1/banking/tuition/23070001001').set('Authorization', `Bearer ${await token('admin')}`)).status).toBe(403);
    expect((await request(app).get('/api/v1/banking/tuition/23070001001').set('Authorization', `Bearer ${await token('23070001001')}x`)).status).toBe(401);
  });
});

describe('POST /banking/payments', () => {
  const pay = (over = {}) => ({ studentNo: '23070001001', term: '2026-FALL', amount: 3000, transactionId: 'TX-000001', ...over });
  it('records a partial payment and updates the balance', async () => {
    const { app, token } = setup();
    const t = await token('23070001001');
    const r = await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'PARTIALLY_PAID', paidAmount: 3000, remainingBalance: 5000 });
    const q = await request(app).get('/api/v1/banking/tuition/23070001001').set('Authorization', `Bearer ${t}`);
    expect(q.body.balance).toBe(5000);
  });
  it('marks full payment as PAID_IN_FULL', async () => {
    const { app, token } = setup();
    const r = await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${await token('23070001001')}`).send(pay({ amount: 8000 }));
    expect(r.body).toMatchObject({ status: 'PAID_IN_FULL', remainingBalance: 0 });
  });
  it('rejects duplicate transaction IDs (409)', async () => {
    const { app, token } = setup();
    const t = await token('23070001001');
    await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay());
    const r = await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay({ amount: 1 }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE_TRANSACTION');
  });
  it('rejects amounts above the balance (422) and paying a settled term', async () => {
    const { app, token } = setup();
    const t = await token('23070001001');
    const over = await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay({ amount: 8000.01 }));
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('AMOUNT_EXCEEDS_BALANCE');
    await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay({ amount: 8000 }));
    const again = await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay({ transactionId: 'TX-000002', amount: 1 }));
    expect(again.body.error.code).toBe('NOTHING_TO_PAY');
  });
  it('validates input: zero, negative, 3 decimals, bad transactionId', async () => {
    const { app, token } = setup();
    const t = await token('23070001001');
    for (const bad of [{ amount: 0 }, { amount: -5 }, { amount: 10.123 }, { amount: 'abc' }, { transactionId: 'x' }, { term: 'nope' }]) {
      const r = await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay(bad));
      expect(r.status).toBe(400);
    }
  });
  it('requires auth and forbids paying for another student', async () => {
    const { app, token } = setup();
    expect((await request(app).post('/api/v1/banking/payments').send(pay())).status).toBe(401);
    const r = await request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${await token('23070001002')}`).send(pay());
    expect(r.status).toBe(403);
  });
  it('allows only one of two concurrent payments with the same transaction ID', async () => {
    const { app, token } = setup();
    const t = await token('23070001001');
    const rs = await Promise.all([1, 2].map(() => request(app).post('/api/v1/banking/payments').set('Authorization', `Bearer ${t}`).send(pay())));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe('POST /admin/tuition', () => {
  const body = (o = {}) => ({ studentNo: '23070001003', term: '2026-FALL', amount: 7000, currency: 'TRY', ...o });
  it('creates (201) then updates (200) the same student/term', async () => {
    const { app, token } = setup();
    const t = await token('admin');
    const a = await request(app).post('/api/v1/admin/tuition').set('Authorization', `Bearer ${t}`).send(body());
    expect([a.status, a.body.status]).toEqual([201, 'CREATED']);
    const b = await request(app).post('/api/v1/admin/tuition').set('Authorization', `Bearer ${t}`).send(body({ amount: 7500 }));
    expect([b.status, b.body.status, b.body.tuitionTotal]).toEqual([200, 'UPDATED', 7500]);
  });
  it('rejects lowering the total below what was paid, currency mismatch, unknown student, bad input', async () => {
    const { app, token } = setup();
    const t = await token('admin');
    const h = (b: object) => request(app).post('/api/v1/admin/tuition').set('Authorization', `Bearer ${t}`).send(b);
    expect((await h(body({ studentNo: '23070001001', amount: 1000 }))).body.error.code).toBe('AMOUNT_BELOW_PAID');
    expect((await h(body({ studentNo: '23070001001', term: '2027-SPRING', currency: 'USD' }))).body.error.code).toBe('CURRENCY_MISMATCH');
    expect((await h(body({ studentNo: '77777777777' }))).status).toBe(404);
    expect((await h(body({ currency: 'XXX' }))).status).toBe(400);
  });
  it('is admin-only', async () => {
    const { app, token } = setup();
    expect((await request(app).post('/api/v1/admin/tuition').send(body())).status).toBe(401);
    expect((await request(app).post('/api/v1/admin/tuition').set('Authorization', `Bearer ${await token('23070001001')}`).send(body())).status).toBe(403);
  });
});

describe('POST /admin/tuition/batch', () => {
  const csv = ['studentNo,term,amount,currency', '23070001003,2027-SPRING,6000,TRY', '23070001002,2027-SPRING,6000,TRY', '99999999999,2027-SPRING,1,TRY', '23070001003,bad,5,TRY'].join('\n');
  it('reports success and failure counts per row', async () => {
    const { app, token } = setup();
    const r = await request(app).post('/api/v1/admin/tuition/batch').set('Authorization', `Bearer ${await token('admin')}`).set('Content-Type', 'text/csv').send(csv);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 4, succeeded: 2, failed: 2 });
    expect(r.body.results[2].error).toContain('STUDENT_NOT_FOUND');
  });
  it('rejects wrong header, empty body and non-admins', async () => {
    const { app, token } = setup();
    const a = await token('admin');
    expect((await request(app).post('/api/v1/admin/tuition/batch').set('Authorization', `Bearer ${a}`).set('Content-Type', 'text/csv').send('a,b\n1,2')).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/tuition/batch').set('Authorization', `Bearer ${a}`).set('Content-Type', 'text/csv').send('')).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/tuition/batch').set('Authorization', `Bearer ${await token('bank')}`).set('Content-Type', 'text/csv').send(csv)).status).toBe(403);
  });
});

describe('GET /admin/tuition/unpaid (paged)', () => {
  it('lists unpaid students with paging metadata', async () => {
    const { app, token } = setup();
    const a = await token('admin');
    const r = await request(app).get('/api/v1/admin/tuition/unpaid?term=2026-FALL&page=1&pageSize=1').set('Authorization', `Bearer ${a}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ studentNo: '23070001001', balance: 8000 });
    const p2 = await request(app).get('/api/v1/admin/tuition/unpaid?term=2026-FALL&page=2&pageSize=1').set('Authorization', `Bearer ${a}`);
    expect(p2.body.items[0].studentNo).toBe('23070001002');
  });
  it('omits fully paid students; validates paging; admin only', async () => {
    const { app, token, store } = setup();
    store.payments.push({ transactionId: 'FULL-1', studentNo: '23070001002', term: '2026-FALL', amountMinor: 500000 });
    const a = await token('admin');
    const r = await request(app).get('/api/v1/admin/tuition/unpaid?term=2026-FALL').set('Authorization', `Bearer ${a}`);
    expect(r.body.totalItems).toBe(1);
    expect((await request(app).get('/api/v1/admin/tuition/unpaid?term=2026-FALL&pageSize=500').set('Authorization', `Bearer ${a}`)).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/tuition/unpaid').set('Authorization', `Bearer ${a}`)).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/tuition/unpaid?term=2026-FALL').set('Authorization', `Bearer ${await token('23070001001')}`)).status).toBe(403);
  });
});

describe('misc', () => {
  it('serves health, swagger spec and JSON 404s', async () => {
    const { app } = setup();
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/api/v1/openapi.yaml')).text).toContain('University Tuition API');
    expect((await request(app).get('/api/v2/anything')).status).toBe(404);
  });
});

describe('gateway-only guard', () => {
  it('rejects direct calls without the gateway secret, but health stays open', async () => {
    const { store } = setup();
    const { createApp } = await import('../src/app.js');
    const app = createApp(store, 'test-secret-test-secret', undefined, { gatewaySecret: 'gw-secret' });
    expect((await request(app).get('/health')).status).toBe(200);
    const direct = await request(app).get('/api/v1/mobile/tuition/23070001001');
    expect([direct.status, direct.body.error.code]).toEqual([403, 'GATEWAY_ONLY']);
    expect((await request(app).get('/api/v1/mobile/tuition/23070001001').set('X-Gateway-Secret', 'gw-secret')).status).toBe(200);
  });
});

