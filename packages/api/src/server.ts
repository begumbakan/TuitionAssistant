import pg from 'pg';
import { createApp } from './app.js';
import { PgStore } from './pgStore.js';
import { initDb } from './seed.js';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) throw new Error('JWT_SECRET (>= 16 chars) is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
await initDb(pool, process.env.SEED_DEMO_DATA === 'true');
const port = Number(process.env.PORT ?? 3000);
createApp(new PgStore(pool), secret, undefined, { gatewaySecret: process.env.GATEWAY_SECRET }).listen(port, () => console.log(`Tuition API listening on :${port}`));
