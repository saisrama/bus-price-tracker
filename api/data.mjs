import { dataFor } from '../src/pg-db.mjs';
import { fail, selection, withDb } from '../src/api-shared.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { route, date } = selection(req);
    const data = await withDb(db => dataFor(db, route.key, date));
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) { fail(res, error); }
}
