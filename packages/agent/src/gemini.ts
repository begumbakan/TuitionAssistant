import { GoogleGenAI, Type, type Tool } from '@google/genai';
import type { Content, LlmClient } from './types.js';

export const SYSTEM_INSTRUCTION = `You are the University Tuition Assistant for a logged-in student.
Tools:
- search_tuition_policies: official policy text (deadlines, installment rules, late fees, scholarships, refunds, banking). Use for any rule/policy question.
- query_tuition: the logged-in student's live tuition total, paid amount and balance. Use for any question about "my" balance or amounts.
- pay_tuition: request a payment toward the student's balance. The system will ask the student to confirm; never claim a payment happened until you receive a successful payment result.
For questions mixing policy and personal data (e.g. installment eligibility), call BOTH tools and combine the results.
Cite policy section numbers (e.g. "Section 3.1") when you use policy text. A partial payment is not installment approval: never promise an installment plan is approved (Section 3.4); explain eligibility and that approval is decided by the university. Never claim a payment succeeded unless the payment result says so. Never invent amounts or rules. The student is already identified; never ask for or accept another student's number. Be concise. Scope: only help with this university's tuition (balances, payments, deadlines, installments, late fees, scholarships, refunds, payment methods). For anything else, reply in one sentence that you can only help with tuition questions, and call no tools.`;

const tools: Tool[] = [{
  functionDeclarations: [
    {
      name: 'search_tuition_policies',
      description: 'Search university tuition policies. Returns excerpts with section references.',
      parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: 'Search query' } }, required: ['query'] },
    },
    {
      name: 'query_tuition',
      description: "Get the logged-in student's tuition total, paid amount and balance. Optional term like 2026-FALL; omit for all terms.",
      parameters: { type: Type.OBJECT, properties: { term: { type: Type.STRING, description: "e.g. '2026-FALL'" } } },
    },
    {
      name: 'pay_tuition',
      description: "Request a simulated payment toward the logged-in student's tuition for a term. Requires user confirmation before it executes.",
      parameters: {
        type: Type.OBJECT,
        properties: { term: { type: Type.STRING, description: "e.g. '2026-FALL'" }, amount: { type: Type.NUMBER, description: 'Amount to pay' } },
        required: ['term', 'amount'],
      },
    },
  ],
}];

export class GeminiClient implements LlmClient {
  private ai: GoogleGenAI;

  constructor(apiKey: string, private model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash') {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate(history: Content[]) {
    const r = await this.withRetry(() => this.ai.models.generateContent({
      model: this.model,
      contents: history as any,
      config: { systemInstruction: SYSTEM_INSTRUCTION, tools, temperature: 0.2 },
    }));
    const calls = r.functionCalls?.map((c) => ({ name: c.name!, args: (c.args ?? {}) as Record<string, any> }));
    const raw = r.candidates?.[0]?.content as Content | undefined;
    return { text: calls?.length ? undefined : r.text, functionCalls: calls?.length ? calls : undefined, raw: calls?.length ? raw : undefined };
  }

  /** Retries temporary Gemini errors (429 rate limit, 500/503 overloaded) with exponential backoff: 1s, 2s, 4s. */
  private async withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e: any) {
        const status = Number(e?.status ?? e?.code);
        const temporary = [429, 500, 503].includes(status) || /UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(String(e?.message));
        if (!temporary || i >= attempts) throw e;
        const waitMs = 1000 * 2 ** (i - 1);
        console.warn(`Gemini temporarily unavailable (${status || 'error'}), retry ${i}/${attempts - 1} in ${waitMs} ms`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }
}
