import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/memoryStore.js';

export const SECRET = 'test-secret-test-secret';

export function setup(now?: () => Date) {
  const store = new MemoryStore();
  const h = (p: string) => bcrypt.hashSync(p, 4);
  store.students.push({ studentNo: '23070001001', fullName: 'Ada One' }, { studentNo: '23070001002', fullName: 'Bob Two' }, { studentNo: '23070001003', fullName: 'Cem Three' });
  store.users.push(
    { id: 1, username: '23070001001', passwordHash: h('pw'), role: 'student', studentNo: '23070001001' },
    { id: 2, username: '23070001002', passwordHash: h('pw'), role: 'student', studentNo: '23070001002' },
    { id: 3, username: 'bank', passwordHash: h('pw'), role: 'bank', studentNo: null },
    { id: 4, username: 'admin', passwordHash: h('pw'), role: 'admin', studentNo: null },
  );
  store.tuition.push(
    { studentNo: '23070001001', term: '2026-FALL', totalMinor: 1000000, currency: 'TRY' },
    { studentNo: '23070001002', term: '2026-FALL', totalMinor: 500000, currency: 'TRY' },
  );
  store.payments.push({ transactionId: 'SEED-1', studentNo: '23070001001', term: '2026-FALL', amountMinor: 200000 });
  const app = createApp(store, SECRET, now);
  const token = async (username: string) => (await request(app).post('/api/v1/auth/token').send({ username, password: 'pw' })).body.accessToken as string;
  return { app, store, token };
}
