import { randomUUID } from 'node:crypto';
import type { Content, LlmClient, Session, Tools, TraceEntry } from './types.js';

const YES = /^\s*(yes|y|confirm|confirmed|evet|onaylıyorum|onay)\b/i;
const MAX_STEPS = 5;

export interface ChatResult { reply: string; trace: TraceEntry[]; pendingConfirmation?: { term: string; amount: number; transactionId: string } }

export class TuitionAgent {
  constructor(private llm: LlmClient, private tools: Tools) {}

  newSession(token: string, studentNo: string): Session {
    return { token, studentNo, history: [] };
  }

  async chat(s: Session, message: string): Promise<ChatResult> {
    const trace: TraceEntry[] = [];

    // A payment is waiting for explicit confirmation: only a clear "yes" executes it.
    if (s.pending) {
      const p = s.pending;
      s.pending = undefined;
      if (YES.test(message)) {
        let result: unknown;
        try {
          result = await this.tools.payTuition(s.token, { studentNo: s.studentNo, ...p });
        } catch (e: any) {
          result = { error: String(e?.message ?? e) };
        }
        trace.push({ tool: 'pay_tuition', input: { term: p.term, amount: p.amount, transactionId: p.transactionId, confirmed: true }, result });
        s.history.push({ role: 'user', parts: [{ text: `The student confirmed the payment. Payment API result: ${JSON.stringify(result)}. Tell the student the outcome.` }] });
        return { reply: await this.run(s, trace), trace };
      }
      s.history.push({ role: 'user', parts: [{ text: '(The student did not confirm; the pending payment was cancelled.)' }] });
    }

    s.history.push({ role: 'user', parts: [{ text: message }] });
    const reply = await this.run(s, trace);
    return { reply, trace, pendingConfirmation: s.pending };
  }

  private async run(s: Session, trace: TraceEntry[]): Promise<string> {
    for (let step = 0; step < MAX_STEPS; step++) {
      const out = await this.llm.generate(s.history);
      if (!out.functionCalls?.length) {
        const text = out.text ?? '';
        s.history.push({ role: 'model', parts: [{ text }] });
        return s.pending
          ? `${text}\n\nPlease confirm this payment:\n  Student: ${s.studentNo}\n  Term: ${s.pending.term}\n  Amount: ${s.pending.amount} ${s.pending.currency ?? ''}\n  Current balance: ${s.pending.currentBalance ?? 'unknown'} ${s.pending.currency ?? ''}\nReply YES to confirm. Anything else cancels.`.trim()
          : text;
      }
      // Keep the model's raw turn when available (preserves Gemini thought signatures on function calls).
      s.history.push(out.raw ?? { role: 'model', parts: out.functionCalls.map((functionCall) => ({ functionCall })) });
      const responses: Content = { role: 'user', parts: [] };
      for (const call of out.functionCalls) {
        const result = await this.execute(s, call.name, call.args ?? {});
        trace.push({ tool: call.name, input: call.args, result });
        responses.parts.push({ functionResponse: { name: call.name, response: { result } } });
      }
      s.history.push(responses);
    }
    return 'Sorry, I could not complete that request.';
  }

  /** The agent (not the LLM) executes tools. studentNo always comes from the authenticated session. */
  private async execute(s: Session, name: string, args: Record<string, any>): Promise<unknown> {
    try {
      switch (name) {
        case 'search_tuition_policies':
          return await this.tools.searchPolicies(String(args.query ?? ''));
        case 'query_tuition':
          return await this.tools.queryTuition(s.token, s.studentNo, args.term ? String(args.term) : undefined);
        case 'pay_tuition': {
          const amount = Number(args.amount);
          if (!args.term || !Number.isFinite(amount) || amount <= 0) return { error: 'term and a positive amount are required' };
          // Policy §7.3: show student, term, amount and CURRENT balance before asking for confirmation.
          const t: any = await this.tools.queryTuition(s.token, s.studentNo, String(args.term));
          if (typeof t?.balance === 'number' && amount > t.balance) {
            return { error: `Amount ${amount} exceeds the current balance ${t.balance} for ${args.term}` };
          }
          s.pending = {
            term: String(args.term), amount, transactionId: `TX-${s.studentNo}-${randomUUID().slice(0, 8)}`,
            currentBalance: t?.balance, currency: t?.currency,
          };
          return { status: 'AWAITING_USER_CONFIRMATION', currentBalance: t?.balance, note: 'Payment NOT made yet. The system will ask the student to confirm.' };
        }
        default:
          return { error: `Unknown tool ${name}` };
      }
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  }
}
