import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildIndex, chunkMarkdown, search } from '../src/indexer.js';

const md = fs.readFileSync(new URL('../docs/University_Tuition_Policies.md', import.meta.url), 'utf8');
const ms = buildIndex(chunkMarkdown(md));

describe('chunking', () => {
  it('creates one chunk per subsection with section numbers', () => {
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.find((c) => c.section === '3.1')?.title).toBe('Installment policy > Eligibility');
  });
});

describe('retrieval (3 distinct queries)', () => {
  it('fall payment deadline -> 2.1', () => {
    const r = search(ms, 'fall payment deadline');
    expect(r[0].section).toBe('2.1');
    expect(r[0].text).toContain('September 30, 2026');
  });
  it('installment eligibility -> 3.1 ($300 minimum)', () => {
    const r = search(ms, 'installment eligibility');
    expect(r[0]).toMatchObject({ section: '3.1', heading: 'Installment policy > Eligibility' });
    expect(r[0].text).toContain('$300');
  });
  it('late fee -> 4.1 (2% one-time)', () => {
    expect(search(ms, 'late fee')[0].section).toBe('4.1');
  });
  it('returns nothing for unrelated queries', () => {
    expect(search(ms, 'zzqx')).toEqual([]);
  });
});

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcpServer.js';

describe('MCP server over a real MCP client', () => {
  it('lists and calls search_tuition_policies', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ms).connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['search_tuition_policies']);
    const r: any = await client.callTool({ name: 'search_tuition_policies', arguments: { query: 'early withdrawal refund' } });
    const body = JSON.parse(r.content[0].text);
    expect(body).toMatchObject({ document: 'University_Tuition_Policies.md', documentId: 'UNI-TUITION-2026-01' });
    expect(body.matches[0].section).toBe('6.1');
  });
});
