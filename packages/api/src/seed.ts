import bcrypt from 'bcryptjs';
import type pg from 'pg';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Applies schema and (optionally) demo data. Idempotent. */
export async function initDb(pool: pg.Pool, seed: boolean) {
  const schemaPath = [process.env.SCHEMA_PATH, fileURLToPath(new URL('../../../db/schema.sql', import.meta.url)), './db/schema.sql', '/app/db/schema.sql']
    .find((p) => p && fs.existsSync(p));
  if (!schemaPath) throw new Error('db/schema.sql not found. Is it in the repo root db/ folder? Or set SCHEMA_PATH.');
  await pool.query(fs.readFileSync(schemaPath, 'utf8'));
  if (!seed) return;
  const h = (p: string) => bcrypt.hashSync(p, 8);
  const students: [string, string][] = [
    ['23070000101', 'Ayşe Demir'], ['23070006012', 'Mehmet Kaya'], ['24070000203', 'Zeynep Arslan'], ['24070002117', 'Can Yıldız'],
  ];
  for (const [n, name] of students) await pool.query('INSERT INTO students VALUES ($1,$2) ON CONFLICT DO NOTHING', [n, name]);
  const users: [string, string, string, string | null][] = [
    ['23070000101', 'student123', 'student', '23070000101'], ['23070006012', 'student123', 'student', '23070006012'],
    ['24070000203', 'student123', 'student', '24070000203'], ['24070002117', 'student123', 'student', '24070002117'],
    ['bank_app', 'bank123', 'bank', null], ['admin', 'admin123', 'admin', null],
  ];
  for (const [u, p, r, s] of users) {
    await pool.query('INSERT INTO users (username, password_hash, role, student_no) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [u, h(p), r, s]);
  }
  // USD, matching the policy document ($300 installment threshold). Minor units = cents.
  const tuition: [string, number][] = [['23070000101', 300000], ['23070006012', 300000], ['24070000203', 225000], ['24070002117', 300000]];
  for (const [n, t] of tuition) {
    await pool.query("INSERT INTO tuition (student_no, term, total_minor, currency) VALUES ($1,'2026-FALL',$2,'USD') ON CONFLICT DO NOTHING", [n, t]);
  }
  // 23070000101 owes $2,500 (installment-eligible), 23070006012 paid in full, 24070002117 owes $200 (below $300 threshold)
  const pays: [string, string, number][] = [['SEED-0001', '23070000101', 50000], ['SEED-0002', '23070006012', 300000], ['SEED-0004', '24070002117', 280000]];
  for (const [id, n, a] of pays) {
    await pool.query("INSERT INTO payments (transaction_id, student_no, term, amount_minor) VALUES ($1,$2,'2026-FALL',$3) ON CONFLICT DO NOTHING", [id, n, a]);
  }
}