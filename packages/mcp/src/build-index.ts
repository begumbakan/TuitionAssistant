// Run once at build time: chunks the policy document and writes index.json (not re-indexed per question).
import fs from 'node:fs';
import { buildIndex, chunkMarkdown } from './indexer.js';

const src = new URL('../docs/University_Tuition_Policies.md', import.meta.url);
const out = new URL('../index.json', import.meta.url);
const chunks = chunkMarkdown(fs.readFileSync(src, 'utf8'));
fs.writeFileSync(out, JSON.stringify(buildIndex(chunks)));
console.log(`Indexed ${chunks.length} chunks -> index.json`);
