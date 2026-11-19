import readline from 'node:readline/promises';
import { TuitionAgent } from './agent.js';
import { GeminiClient } from './gemini.js';
import { login, realTools } from './tools.js';

const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8000';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const agent = new TuitionAgent(new GeminiClient(process.env.GEMINI_API_KEY!), realTools(process.env.MCP_URL ?? 'http://localhost:4000/mcp', gateway));
const { token, studentNo } = await login(gateway, await rl.question('Student no: '), await rl.question('Password: '));
const s = agent.newSession(token, studentNo);
console.log(`Logged in as ${studentNo}. Ctrl+C to exit.`);
for (;;) {
  const out = await agent.chat(s, await rl.question('\nYou: '));
  for (const t of out.trace) console.log(`  [tool] ${t.tool}(${JSON.stringify(t.input)}) -> ${JSON.stringify(t.result).slice(0, 300)}`);
  console.log(`Assistant: ${out.reply}`);
}
