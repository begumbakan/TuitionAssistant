import { describe, it, expect, vi } from 'vitest';
import { TuitionAgent } from '../src/agent.js';
import type { Content, FunctionCall, LlmClient, Tools } from '../src/types.js';

/** Scripted fake LLM: each entry is one model turn. No network / API key needed. */
function fakeLlm(script: ({ calls: FunctionCall[] } | { text: string })[]): LlmClient & { seen: Content[][] } {
  let i = 0;
  const seen: Content[][] = [];
  return {
    seen,
    async generate(history) {
      seen.push(JSON.parse(JSON.stringify(history)));
      const step = script[i++] as any;
      return 'calls' in step ? { functionCalls: step.calls } : { text: step.text };
    },
  };
}
function fakeTools() {
  return {
    searchPolicies: vi.fn(async (q: string) => `[Section 1.1: Fall Term] deadline September 30 (q=${q})`),
    queryTuition: vi.fn(async (_t: string, studentNo: string) => ({ studentNo, balance: 45000, currency: 'TRY' })),
    payTuition: vi.fn(async (_t: string, b: any) => ({ status: 'PARTIALLY_PAID', paidAmount: b.amount, remainingBalance: 35000 })),
  } satisfies Tools;
}
const mk = (script: any[]) => { const llm = fakeLlm(script); const tools = fakeTools(); const agent = new TuitionAgent(llm, tools); return { llm, tools, agent, s: agent.newSession('jwt-1', '23070000101') }; };

describe('agent scenarios', () => {
  it('MCP-only: policy question calls MCP, not REST', async () => {
    const { agent, tools, s } = mk([{ calls: [{ name: 'search_tuition_policies', args: { query: 'payment deadline' } }] }, { text: 'Deadline is Sept 30 (Section 1.1).' }]);
    const r = await agent.chat(s, 'When is the payment deadline?');
    expect(tools.searchPolicies).toHaveBeenCalledWith('payment deadline');
    expect(tools.queryTuition).not.toHaveBeenCalled();
    expect(r.trace.map((t) => t.tool)).toEqual(['search_tuition_policies']);
    expect(r.reply).toContain('Section 1.1');
  });

  it('REST-only: balance question calls the API with the session token', async () => {
    const { agent, tools, s } = mk([{ calls: [{ name: 'query_tuition', args: {} }] }, { text: 'Your balance is 45,000 TRY.' }]);
    const r = await agent.chat(s, 'What is my balance?');
    expect(tools.queryTuition).toHaveBeenCalledWith('jwt-1', '23070000101', undefined);
    expect(tools.searchPolicies).not.toHaveBeenCalled();
    expect(r.trace[0].result).toMatchObject({ balance: 45000 });
  });

  it('combined: installments question uses both MCP and REST, results go back to the LLM', async () => {
    const { agent, tools, s, llm } = mk([
      { calls: [{ name: 'query_tuition', args: {} }, { name: 'search_tuition_policies', args: { query: 'installment eligibility' } }] },
      { text: 'Your balance of $2,500 meets the $300 threshold (Section 3.1); approval is decided by the university.' },
    ]);
    const r = await agent.chat(s, 'Can I pay my outstanding balance in installments?');
    expect(r.trace.map((t) => t.tool)).toEqual(['query_tuition', 'search_tuition_policies']);
    expect(tools.payTuition).not.toHaveBeenCalled();
    const last = llm.seen[1].at(-1)!;
    expect(last.parts.map((p) => p.functionResponse?.name)).toEqual(['query_tuition', 'search_tuition_policies']);
  });
});

describe('payment confirmation gate', () => {
  const payScript = (extra: any[] = []) => [{ calls: [{ name: 'pay_tuition', args: { term: '2026-FALL', amount: 10000 } }] }, { text: 'I can pay 10,000.' }, ...extra];

  it('does NOT call the payment API until the student explicitly confirms', async () => {
    const { agent, tools, s } = mk(payScript());
    const r = await agent.chat(s, 'Pay 10000 of my balance');
    expect(tools.payTuition).not.toHaveBeenCalled();
    expect(r.pendingConfirmation).toMatchObject({ term: '2026-FALL', amount: 10000 });
    expect(r.reply).toMatch(/Reply YES/);
    expect(r.reply).toContain('Current balance: 45000');
    expect(r.reply).toContain('Student: 23070000101');
  });

  it('executes exactly once after YES, using the session student number', async () => {
    const { agent, tools, s } = mk(payScript([{ text: 'Paid 10,000. Remaining 35,000.' }]));
    await agent.chat(s, 'Pay 10000');
    const r = await agent.chat(s, 'yes');
    expect(tools.payTuition).toHaveBeenCalledTimes(1);
    const [token, body] = tools.payTuition.mock.calls[0] as [string, any];
    expect(token).toBe('jwt-1');
    expect(body).toMatchObject({ studentNo: '23070000101', term: '2026-FALL', amount: 10000 });
    expect(body.transactionId).toMatch(/^TX-23070000101-/);
    expect(r.trace[0]).toMatchObject({ tool: 'pay_tuition' });
    expect(s.pending).toBeUndefined();
    await agent.chat(s, 'yes').catch(() => undefined); // a stray second YES must not pay again
    expect(tools.payTuition).toHaveBeenCalledTimes(1);
  });

  it('refuses to queue a payment above the current balance', async () => {
    const { agent, tools, s } = mk([{ calls: [{ name: 'pay_tuition', args: { term: '2026-FALL', amount: 99999 } }] }, { text: 'That exceeds your balance.' }]);
    const r = await agent.chat(s, 'Pay 99999');
    expect(s.pending).toBeUndefined();
    expect(r.trace[0].result).toMatchObject({ error: expect.stringContaining('exceeds') });
    expect(tools.payTuition).not.toHaveBeenCalled();
  });

  it('cancels on anything other than yes', async () => {
    const { agent, tools, s } = mk([...payScript(), { text: 'Okay, cancelled.' }]);
    await agent.chat(s, 'Pay 10000');
    await agent.chat(s, 'no thanks');
    expect(tools.payTuition).not.toHaveBeenCalled();
    expect(s.pending).toBeUndefined();
  });
});

describe('identity safety', () => {
  it('ignores a studentNo the LLM/prompt tries to inject', async () => {
    const { agent, tools, s } = mk([{ calls: [{ name: 'query_tuition', args: { studentNo: '23070006012' } }] }, { text: 'ok' }]);
    await agent.chat(s, 'Show the balance of student 23070006012');
    expect(tools.queryTuition).toHaveBeenCalledWith('jwt-1', '23070000101', undefined);
  });
  it('surfaces tool errors to the LLM instead of crashing', async () => {
    const { agent, tools, s } = mk([{ calls: [{ name: 'query_tuition', args: {} }] }, { text: 'Sorry, I could not fetch that.' }]);
    tools.queryTuition.mockRejectedValueOnce(new Error('API 429: DAILY_LIMIT_EXCEEDED'));
    const r = await agent.chat(s, 'balance?');
    expect(r.trace[0].result).toMatchObject({ error: expect.stringContaining('429') });
    expect(r.reply).toContain('Sorry');
  });
});
