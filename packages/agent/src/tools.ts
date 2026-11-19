import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tools } from './types.js';

/** MCP path (separate from the gateway) + REST path (always via the API Gateway). */
export function realTools(mcpUrl: string, gatewayUrl: string): Tools {
  const api = async (path: string, token: string, init: RequestInit = {}) => {
    const r = await fetch(`${gatewayUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`API ${r.status}: ${body?.error?.code ?? ''} ${body?.error?.message ?? body?.message ?? ''}`.trim());
    return body;
  };
  return {
    async searchPolicies(query) {
      const client = new Client({ name: 'tuition-agent', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
      try {
        const r: any = await client.callTool({ name: 'search_tuition_policies', arguments: { query } });
        return r.content?.map((c: any) => c.text).join('\n') ?? '';
      } finally {
        await client.close();
      }
    },
    queryTuition: (token, studentNo, term) =>
      api(`/api/v1/banking/tuition/${encodeURIComponent(studentNo)}${term ? `?term=${encodeURIComponent(term)}` : ''}`, token),
    payTuition: (token, body) => api('/api/v1/banking/payments', token, { method: 'POST', body: JSON.stringify(body) }),
  };
}

export async function login(gatewayUrl: string, username: string, password: string) {
  const r = await fetch(`${gatewayUrl}/api/v1/auth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const body: any = await r.json();
  if (!r.ok) throw new Error(body?.error?.message ?? 'Login failed');
  if (body.role !== 'student') throw new Error('The assistant is for student accounts');
  return { token: body.accessToken as string, studentNo: body.studentNo as string };
}
