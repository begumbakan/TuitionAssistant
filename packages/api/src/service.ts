import bcrypt from 'bcryptjs';
import { AppError } from './errors.js';
import { fromMinor, toMinor } from './money.js';
import { signToken, type Claims } from './auth.js';
import type { Store, Tx } from './types.js';

export const MOBILE_DAILY_LIMIT = 3;
const TERM_RE = /^\d{4}-(FALL|SPRING|SUMMER)$/;
const STUDENT_RE = /^\d{11}$/;
const CURRENCIES = ['TRY', 'USD', 'EUR'];

export function validateTerm(t: unknown): string {
  if (typeof t !== 'string' || !TERM_RE.test(t)) throw new AppError(400, 'VALIDATION_ERROR', "term must look like '2026-FALL' (FALL, SPRING or SUMMER)");
  return t;
}
export function validateStudentNo(n: unknown): string {
  if (typeof n !== 'string' || !STUDENT_RE.test(n)) throw new AppError(400, 'VALIDATION_ERROR', 'studentNo must be an 11-digit number (e.g. e.g. 23070000101)');
  return n;
}

export interface TermSummary { term: string; tuitionTotal: number; paidAmount: number; balance: number; currency: string }

function summarize(rows: { term: string; totalMinor: number; paidMinor: number; currency: string }[]) {
  const terms: TermSummary[] = rows.map((r) => ({
    term: r.term, tuitionTotal: fromMinor(r.totalMinor), paidAmount: fromMinor(r.paidMinor),
    balance: fromMinor(r.totalMinor - r.paidMinor), currency: r.currency,
  }));
  const sum = (k: 'totalMinor' | 'paidMinor') => rows.reduce((a, r) => a + r[k], 0);
  return { terms, total: sum('totalMinor'), paid: sum('paidMinor') };
}

export class TuitionService {
  constructor(private store: Store, private jwtSecret: string, private now: () => Date = () => new Date()) {}

  async login(username: unknown, password: unknown) {
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new AppError(400, 'VALIDATION_ERROR', 'username and password are required');
    }
    const user = await this.store.tx((tx) => tx.getUser(username));
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
    }
    const claims: Claims = { sub: user.username, role: user.role, studentNo: user.studentNo };
    return { accessToken: signToken(claims, this.jwtSecret), tokenType: 'Bearer', expiresIn: 3600, role: user.role, studentNo: user.studentNo };
  }

  /** Query Tuition. term omitted => overall balance across all terms (plus per-term breakdown). */
  async queryTuition(studentNoRaw: unknown, termRaw?: unknown, opts: { mobileQuota?: boolean } = {}) {
    const studentNo = validateStudentNo(studentNoRaw);
    const term = termRaw === undefined || termRaw === '' ? undefined : validateTerm(termRaw);
    return this.store.tx(async (tx) => {
      if (!(await tx.getStudent(studentNo))) throw new AppError(404, 'STUDENT_NOT_FOUND', `Student ${studentNo} not found`);
      if (opts.mobileQuota) {
        const day = this.now().toISOString().slice(0, 10);
        const ok = await tx.tryIncrementMobileQuery(studentNo, day, MOBILE_DAILY_LIMIT);
        if (!ok) throw new AppError(429, 'DAILY_LIMIT_EXCEEDED', `Mobile app tuition queries are limited to ${MOBILE_DAILY_LIMIT} per student per day`);
      }
      let rows = await tx.listTuition(studentNo);
      if (term) rows = rows.filter((r) => r.term === term);
      if (term && rows.length === 0) throw new AppError(404, 'TUITION_NOT_FOUND', `No tuition record for ${studentNo} in ${term}`);
      const s = summarize(rows);
      return {
        studentNo, scope: term ?? 'ALL_TERMS', currency: rows[0]?.currency ?? null,
        tuitionTotal: fromMinor(s.total), paidAmount: fromMinor(s.paid), balance: fromMinor(s.total - s.paid),
        terms: s.terms,
      };
    });
  }

  async payTuition(body: any, auth: Claims | undefined) {
    const studentNo = validateStudentNo(body?.studentNo);
    const term = validateTerm(body?.term);
    const amountMinor = toMinor(body?.amount, 'amount');
    if (amountMinor <= 0) throw new AppError(400, 'VALIDATION_ERROR', 'amount must be greater than 0');
    const transactionId = body?.transactionId;
    if (typeof transactionId !== 'string' || !/^[A-Za-z0-9._-]{6,64}$/.test(transactionId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'transactionId must be 6-64 characters (letters, digits, . _ -)');
    }
    if (auth?.role === 'admin') throw new AppError(403, 'FORBIDDEN', 'Admins cannot record payments');
    if (auth) {
      if (auth.role === 'student' && auth.studentNo !== studentNo) throw new AppError(403, 'FORBIDDEN', 'Students can only pay their own tuition');
    }
    return this.store.tx(async (tx) => {
      const t = await tx.getTuition(studentNo, term, true);
      if (!t) throw new AppError(404, 'TUITION_NOT_FOUND', `No tuition record for ${studentNo} in ${term}`);
      if (await tx.paymentExists(transactionId)) throw new AppError(409, 'DUPLICATE_TRANSACTION', `Transaction ${transactionId} was already processed`);
      const balance = t.totalMinor - t.paidMinor;
      if (balance <= 0) throw new AppError(422, 'NOTHING_TO_PAY', 'This term has no outstanding balance');
      if (amountMinor > balance) {
        throw new AppError(422, 'AMOUNT_EXCEEDS_BALANCE', `Amount ${fromMinor(amountMinor)} exceeds outstanding balance ${fromMinor(balance)}`);
      }
      await tx.insertPayment({ transactionId, studentNo, term, amountMinor });
      const remaining = balance - amountMinor;
      return {
        status: remaining === 0 ? 'PAID_IN_FULL' : 'PARTIALLY_PAID', transactionId, studentNo, term,
        paidAmount: fromMinor(amountMinor), remainingBalance: fromMinor(remaining), currency: t.currency,
      };
    });
  }

  /**
   * Add Tuition (admin). Duplicate rules: (studentNo, term) is unique. A repeat call UPDATES the total.
   * Rejected when the new total is below what was already paid, or when the currency differs from the
   * student's existing currency (a student holds one currency).
   */
  async addTuition(body: any) {
    const studentNo = validateStudentNo(body?.studentNo);
    const term = validateTerm(body?.term);
    const totalMinor = toMinor(body?.amount, 'amount');
    const currency = typeof body?.currency === 'string' ? body.currency.toUpperCase() : '';
    if (!CURRENCIES.includes(currency)) throw new AppError(400, 'VALIDATION_ERROR', `currency must be one of ${CURRENCIES.join(', ')}`);
    return this.store.tx(async (tx) => this.upsert(tx, studentNo, term, totalMinor, currency));
  }

  private async upsert(tx: Tx, studentNo: string, term: string, totalMinor: number, currency: string) {
    if (!(await tx.getStudent(studentNo))) throw new AppError(404, 'STUDENT_NOT_FOUND', `Student ${studentNo} not found`);
    const existing = await tx.listTuition(studentNo);
    const other = existing.find((r) => r.currency !== currency);
    if (other) throw new AppError(409, 'CURRENCY_MISMATCH', `Student already has tuition in ${other.currency}`);
    const cur = existing.find((r) => r.term === term);
    if (cur && totalMinor < cur.paidMinor) {
      throw new AppError(409, 'AMOUNT_BELOW_PAID', `New total ${fromMinor(totalMinor)} is below the already paid ${fromMinor(cur.paidMinor)}`);
    }
    const result = await tx.upsertTuition({ studentNo, term, totalMinor, currency });
    return { status: result === 'created' ? 'CREATED' : 'UPDATED', studentNo, term, tuitionTotal: fromMinor(totalMinor), currency };
  }

  /** Add Tuition - Batch. CSV header: studentNo,term,amount,currency. Each row is its own transaction. */
  async addTuitionBatch(csv: unknown) {
    if (typeof csv !== 'string' || !csv.trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Request body must be non-empty text/csv');
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
    const header = lines[0].split(',').map((h) => h.trim());
    if (header.join(',') !== 'studentNo,term,amount,currency') {
      throw new AppError(400, 'VALIDATION_ERROR', 'CSV header must be exactly: studentNo,term,amount,currency');
    }
    const dataLines = lines.slice(1);
    if (dataLines.length > 1000) throw new AppError(413, 'BATCH_TOO_LARGE', 'At most 1000 rows per batch');
    const results: { line: number; studentNo: string; term: string; status: string; error?: string }[] = [];
    for (let i = 0; i < dataLines.length; i++) {
      const [studentNo = '', term = '', amount = '', currency = ''] = dataLines[i].split(',').map((c) => c.trim());
      try {
        const r = await this.addTuition({ studentNo, term, amount, currency });
        results.push({ line: i + 2, studentNo, term, status: r.status });
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        results.push({ line: i + 2, studentNo, term, status: 'FAILED', error: `${e.code}: ${e.message}` });
      }
    }
    const failed = results.filter((r) => r.status === 'FAILED').length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  async unpaidStatus(termRaw: unknown, pageRaw: unknown, pageSizeRaw: unknown) {
    const term = validateTerm(termRaw);
    const page = pageRaw === undefined ? 1 : Number(pageRaw);
    const pageSize = pageSizeRaw === undefined ? 20 : Number(pageSizeRaw);
    if (!Number.isInteger(page) || page < 1) throw new AppError(400, 'VALIDATION_ERROR', 'page must be an integer >= 1');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new AppError(400, 'VALIDATION_ERROR', 'pageSize must be an integer between 1 and 100');
    const { rows, total } = await this.store.tx((tx) => tx.listUnpaid(term, pageSize, (page - 1) * pageSize));
    return {
      term, page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize),
      items: rows.map((r) => ({
        studentNo: r.studentNo, fullName: r.fullName, tuitionTotal: fromMinor(r.totalMinor),
        paidAmount: fromMinor(r.paidMinor), balance: fromMinor(r.totalMinor - r.paidMinor), currency: r.currency,
      })),
    };
  }
}
