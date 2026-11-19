import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadIndex, search, type Chunk } from './indexer.js';
import type MiniSearch from 'minisearch';

/** Loads the prebuilt index.json (built once by `npm run build-index`). */
export function loadPrebuiltIndex() {
  return loadIndex(fs.readFileSync(new URL('../index.json', import.meta.url), 'utf8'));
}

export function createMcpServer(index: MiniSearch<Chunk> = loadPrebuiltIndex()) {
  const server = new McpServer({ name: 'tuition-policies', version: '1.0.0' });
  server.registerTool(
    'search_tuition_policies',
    {
      title: 'Search tuition policies',
      description: 'Full-text search over the University Tuition Policies document. Returns the most relevant passages with section ID (e.g. 3.2), heading, document ID and text. Use for rules: deadlines, installments, late fees, scholarships, refunds, banking instructions. Does NOT contain any student balances.',
      inputSchema: { query: z.string().min(2).describe('Natural-language search query, e.g. "installment eligibility"') },
    },
    async ({ query }) => {
      const results = search(index, query);
      return {
        content: [{ type: 'text', text: JSON.stringify({ document: 'University_Tuition_Policies.md', documentId: 'UNI-TUITION-2026-01', query, matches: results }) }],
      };
    },
  );
  return server;
}
