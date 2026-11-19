import type { Store, Tx, UserRow, StudentRow, TuitionRow } from './types.js';

/** In-memory Store used by unit tests (no database or cloud needed). */
export class MemoryStore implements Store {
  users: UserRow[] = [];
  students: StudentRow[] = [];
  tuition: TuitionRow[] = [];
  payments: { transactionId: string; studentNo: string; term: string; amountMinor: number }[] = [];
  counters = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = this.chain.then(() => fn(this.view()));
    this.chain = run.catch(() => undefined); // serialize transactions
    return run;
  }

  private paid(s: string, t: string) {
    return this.payments.filter((p) => p.studentNo === s && p.term === t).reduce((a, p) => a + p.amountMinor, 0);
  }

  private view(): Tx {
    return {
      getUser: async (u) => this.users.find((x) => x.username === u) ?? null,
      getStudent: async (n) => this.students.find((x) => x.studentNo === n) ?? null,
      listTuition: async (n) =>
        this.tuition.filter((t) => t.studentNo === n).sort((a, b) => a.term.localeCompare(b.term))
          .map((t) => ({ ...t, paidMinor: this.paid(t.studentNo, t.term) })),
      getTuition: async (n, term) => {
        const t = this.tuition.find((x) => x.studentNo === n && x.term === term);
        return t ? { ...t, paidMinor: this.paid(n, term) } : null;
      },
      upsertTuition: async (row) => {
        const i = this.tuition.findIndex((x) => x.studentNo === row.studentNo && x.term === row.term);
        if (i >= 0) { this.tuition[i] = { ...row }; return 'updated'; }
        this.tuition.push({ ...row });
        return 'created';
      },
      paymentExists: async (id) => this.payments.some((p) => p.transactionId === id),
      insertPayment: async (p) => { this.payments.push({ ...p }); },
      listUnpaid: async (term, limit, offset) => {
        const all = this.tuition
          .filter((t) => t.term === term && t.totalMinor - this.paid(t.studentNo, t.term) > 0)
          .map((t) => ({
            studentNo: t.studentNo,
            fullName: this.students.find((s) => s.studentNo === t.studentNo)?.fullName ?? '',
            term, totalMinor: t.totalMinor, paidMinor: this.paid(t.studentNo, t.term), currency: t.currency,
          }))
          .sort((a, b) => a.studentNo.localeCompare(b.studentNo));
        return { rows: all.slice(offset, offset + limit), total: all.length };
      },
      tryIncrementMobileQuery: async (n, day, limit) => {
        const k = `${n}|${day}`;
        const c = this.counters.get(k) ?? 0;
        if (c >= limit) return false;
        this.counters.set(k, c + 1);
        return true;
      },
    };
  }
}
