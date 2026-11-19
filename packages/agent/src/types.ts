export interface FunctionCall { name: string; args: Record<string, any> }
export type Part = { thoughtSignature?: string; text?: string; functionCall?: FunctionCall; functionResponse?: { name: string; response: Record<string, any> } };
export interface Content { role: 'user' | 'model'; parts: Part[] }

/** What the agent needs from an LLM: given history + tool declarations, return text or function calls. */
export interface LlmClient {
  generate(history: Content[]): Promise<{ text?: string; functionCalls?: FunctionCall[]; raw?: Content }>;
}

export interface TraceEntry { tool: string; input: unknown; result: unknown }

export interface PendingPayment { term: string; amount: number; transactionId: string; currentBalance?: number; currency?: string }

export interface Session {
  token: string;
  studentNo: string;
  history: Content[];
  pending?: PendingPayment;
}

export interface Tools {
  searchPolicies(query: string): Promise<string>;
  queryTuition(token: string, studentNo: string, term?: string): Promise<unknown>;
  payTuition(token: string, body: { studentNo: string; term: string; amount: number; transactionId: string }): Promise<unknown>;
}
