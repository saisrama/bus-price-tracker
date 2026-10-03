import { availableDates } from '../src/pg-db.mjs';
import { fail, selection, withDb } from '../src/api-shared.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { route } = selection(req);
    const dates = await withDb(db => availableDates(db, route.key));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ dates });
  } catch (error) { fail(res, error); }
}
