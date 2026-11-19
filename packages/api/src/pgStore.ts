import pg from 'pg';
import type { Store, Tx } from './types.js';

const PAID = `COALESCE((SELECT SUM(amount_minor) FROM payments p WHERE p.student_no = t.student_no AND p.term = t.term), 0)::bigint`;

function mapTuition(r: any) {
  return { studentNo: r.student_no, term: r.term, totalMinor: Number(r.total_minor), currency: r.currency.trim(), paidMinor: Number(r.paid_minor) };
}

export class PgStore implements Store {
  constructor(public pool: pg.Pool) {}

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(this.view(c));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  private view(c: pg.PoolClient): Tx {
    return {
      getUser: async (username) => {
        const r = await c.query('SELECT * FROM users WHERE username = $1', [username]);
        const u = r.rows[0];
        return u ? { id: u.id, username: u.username, passwordHash: u.password_hash, role: u.role, studentNo: u.student_no } : null;
      },
      getStudent: async (n) => {
        const r = await c.query('SELECT student_no, full_name FROM students WHERE student_no = $1', [n]);
        return r.rows[0] ? { studentNo: r.rows[0].student_no, fullName: r.rows[0].full_name } : null;
      },
      listTuition: async (n) => {
        const r = await c.query(`SELECT t.*, ${PAID} AS paid_minor FROM tuition t WHERE t.student_no = $1 ORDER BY t.term`, [n]);
        return r.rows.map(mapTuition);
      },
      getTuition: async (n, term, forUpdate) => {
        const r = await c.query(
          `SELECT t.*, ${PAID} AS paid_minor FROM tuition t WHERE t.student_no = $1 AND t.term = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
          [n, term],
        );
        return r.rows[0] ? mapTuition(r.rows[0]) : null;
      },
      upsertTuition: async (row) => {
        const r = await c.query(
          `INSERT INTO tuition (student_no, term, total_minor, currency) VALUES ($1,$2,$3,$4)
           ON CONFLICT (student_no, term) DO UPDATE SET total_minor = EXCLUDED.total_minor, currency = EXCLUDED.currency, updated_at = now()
           RETURNING (xmax = 0) AS inserted`,
          [row.studentNo, row.term, row.totalMinor, row.currency],
        );
        return r.rows[0].inserted ? 'created' : 'updated';
      },
      paymentExists: async (id) => (await c.query('SELECT 1 FROM payments WHERE transaction_id = $1', [id])).rowCount! > 0,
      insertPayment: async (p) => {
        await c.query('INSERT INTO payments (transaction_id, student_no, term, amount_minor) VALUES ($1,$2,$3,$4)',
          [p.transactionId, p.studentNo, p.term, p.amountMinor]);
      },
      listUnpaid: async (term, limit, offset) => {
        const base = `FROM tuition t JOIN students s ON s.student_no = t.student_no WHERE t.term = $1 AND t.total_minor - ${PAID} > 0`;
        const total = await c.query(`SELECT COUNT(*)::int AS n ${base}`, [term]);
        const r = await c.query(
          `SELECT t.student_no, s.full_name, t.term, t.total_minor, t.currency, ${PAID} AS paid_minor ${base} ORDER BY t.student_no LIMIT $2 OFFSET $3`,
          [term, limit, offset],
        );
        return {
          total: total.rows[0].n,
          rows: r.rows.map((x) => ({
            studentNo: x.student_no, fullName: x.full_name, term: x.term,
            totalMinor: Number(x.total_minor), paidMinor: Number(x.paid_minor), currency: x.currency.trim(),
          })),
        };
      },
      tryIncrementMobileQuery: async (n, day, limit) => {
        const r = await c.query(
          `INSERT INTO mobile_query_counter AS q (student_no, day, count) VALUES ($1,$2,1)
           ON CONFLICT (student_no, day) DO UPDATE SET count = q.count + 1 WHERE q.count < $3
           RETURNING count`,
          [n, day, limit],
        );
        return r.rowCount! > 0;
      },
    };
  }
}
