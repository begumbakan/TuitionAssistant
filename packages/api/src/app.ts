import express, { type NextFunction, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import fs from 'node:fs';
import { AppError } from './errors.js';
import { assertCanAccessStudent, requireAuth } from './auth.js';
import { TuitionService } from './service.js';
import type { Store } from './types.js';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

export function createApp(store: Store, jwtSecret: string, now?: () => Date, opts: { gatewaySecret?: string } = {}) {
  const svc = new TuitionService(store, jwtSecret, now);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.text({ type: 'text/csv', limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // When deployed, only the API Gateway (which injects this shared secret) may reach the API.
  if (opts.gatewaySecret) {
    app.use('/api', (req, _res, next) =>
      req.header('x-gateway-secret') === opts.gatewaySecret ? next() : next(new AppError(403, 'GATEWAY_ONLY', 'Requests must go through the API Gateway')));
  }

  // ---- Versioned routes: mount another router at /api/v2 to evolve the contract without breaking v1 ----
  const v1 = express.Router();
  const student = requireAuth(jwtSecret, ['student', 'bank']);
  const admin = requireAuth(jwtSecret, ['admin']);

  // Documentation
  const specUrl = new URL('../openapi.yaml', import.meta.url);
  const specText = fs.existsSync(specUrl) ? fs.readFileSync(specUrl, 'utf8') : 'openapi: 3.0.3\ninfo: {title: missing, version: "0"}\npaths: {}';
  v1.get('/openapi.yaml', (_req, res) => res.type('text/yaml').send(specText));
  v1.use('/docs', swaggerUi.serve, swaggerUi.setup(YAML.parse(specText)));

  // Auth (public): issues a JWT
  v1.post('/auth/token', wrap(async (req, res) => { res.json(await svc.login(req.body?.username, req.body?.password)); }));

  // University Mobile App - Query Tuition (no auth, max 3 per student per day, keyed by studentNo)
  v1.get('/mobile/tuition/:studentNo', wrap(async (req, res) => {
    res.json(await svc.queryTuition(req.params.studentNo, req.query.term, { mobileQuota: true }));
  }));

  // Banking App - Query Tuition (auth)
  v1.get('/banking/tuition/:studentNo', student, wrap(async (req, res) => {
    assertCanAccessStudent(req.auth, req.params.studentNo);
    res.json(await svc.queryTuition(req.params.studentNo, req.query.term));
  }));

  // Banking App - Pay Tuition (auth + explicit confirmation is enforced by the AI agent before calling)
  v1.post('/banking/payments', student, wrap(async (req, res) => {
    res.status(201).json(await svc.payTuition(req.body, req.auth));
  }));

  // Admin
  v1.post('/admin/tuition', admin, wrap(async (req, res) => {
    const r = await svc.addTuition(req.body);
    res.status(r.status === 'CREATED' ? 201 : 200).json(r);
  }));
  v1.post('/admin/tuition/batch', admin, wrap(async (req, res) => { res.json(await svc.addTuitionBatch(req.body)); }));
  v1.get('/admin/tuition/unpaid', admin, wrap(async (req, res) => {
    res.json(await svc.unpaidStatus(req.query.term, req.query.page, req.query.pageSize));
  }));

  app.use('/api/v1', v1);

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  });
  return app;
}
