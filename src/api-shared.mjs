import { ROUTES, istDate } from './config.mjs';
import { openPg } from './pg-db.mjs';

export function selection(req) {
  const url = new URL(req.url, 'https://tracker.invalid');
  const route = ROUTES.find(item => item.key === url.searchParams.get('route')) ?? ROUTES[0];
  const date = url.searchParams.get('date') || istDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)))
    throw new Error('Invalid date');
  return { route, date };
}

export async function withDb(callback) {
  const db = openPg();
  try { return await callback(db); }
  finally { await db.end(); }
}

export function fail(res, error) {
  console.error(error);
  res.status(error.message === 'Invalid date' ? 400 : 503).json({ error: error.message === 'Invalid date' ? error.message : 'Data unavailable' });
}
