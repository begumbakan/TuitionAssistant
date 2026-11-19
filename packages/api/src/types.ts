export type Role = 'student' | 'bank' | 'admin';

export interface UserRow { id: number; username: string; passwordHash: string; role: Role; studentNo: string | null }
export interface StudentRow { studentNo: string; fullName: string }
export interface TuitionRow { studentNo: string; term: string; totalMinor: number; currency: string }
export interface UnpaidRow { studentNo: string; fullName: string; term: string; totalMinor: number; paidMinor: number; currency: string }

/** Storage operations. All calls inside Store.tx() run in a single transaction. */
export interface Tx {
  getUser(username: string): Promise<UserRow | null>;
  getStudent(studentNo: string): Promise<StudentRow | null>;
  listTuition(studentNo: string): Promise<(TuitionRow & { paidMinor: number })[]>;
  getTuition(studentNo: string, term: string, forUpdate?: boolean): Promise<(TuitionRow & { paidMinor: number }) | null>;
  upsertTuition(row: TuitionRow): Promise<'created' | 'updated'>;
  paymentExists(transactionId: string): Promise<boolean>;
  insertPayment(p: { transactionId: string; studentNo: string; term: string; amountMinor: number }): Promise<void>;
  listUnpaid(term: string, limit: number, offset: number): Promise<{ rows: UnpaidRow[]; total: number }>;
  /** Atomically increments today's counter unless it already reached `limit`. Returns false when over the limit. */
  tryIncrementMobileQuery(studentNo: string, day: string, limit: number): Promise<boolean>;
}

export interface Store {
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
