import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { TuitionAgent } from './agent.js';
import { GeminiClient } from './gemini.js';
import { login, realTools } from './tools.js';
import type { Session } from './types.js';

const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8000';
const mcpUrl = process.env.MCP_URL ?? 'http://localhost:4000/mcp';
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');
const agent = new TuitionAgent(new GeminiClient(process.env.GEMINI_API_KEY), realTools(mcpUrl, gateway));
const sessions = new Map<string, Session>();

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (_req, res) => res.type('html').send(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')));

app.post('/login', async (req, res) => {
  try {
    const { token, studentNo } = await login(gateway, req.body?.username, req.body?.password);
    const sessionId = randomUUID();
    sessions.set(sessionId, agent.newSession(token, studentNo));
    res.json({ sessionId, studentNo });
  } catch (e: any) {
    res.status(401).json({ error: e.message });
  }
});

app.post('/chat', async (req, res) => {
  const s = sessions.get(req.body?.sessionId);
  if (!s) return res.status(401).json({ error: 'Unknown session, please log in' });
  if (typeof req.body?.message !== 'string' || !req.body.message.trim()) return res.status(400).json({ error: 'message required' });
  try {
    const out = await agent.chat(s, req.body.message);
    console.log(JSON.stringify({ studentNo: s.studentNo, question: req.body.message, trace: out.trace, answer: out.reply }));
    res.json(out);
  } catch (e: any) {
    console.error(e);
    res.status(502).json({ error: 'The language model call failed. Try again.' });
  }
});

const port = Number(process.env.PORT ?? 3002);
app.listen(port, () => console.log(`Agent on :${port}`));
