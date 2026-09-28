import { dataFor } from '../src/pg-db.mjs';
import { fail, selection, withDb } from '../src/api-shared.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { route, date } = selection(req);
    const rows = (await withDb(db => dataFor(db, route.key, date))).observations;
    const fields = ['observed_at','operator','bus_type','departure_time','arrival_time','fare_min','fare_max','seats_left','women_seats_left','men_seats_left','source_url'];
    const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [fields.join(','), ...rows.map(row => fields.map(field => escape(row[field])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${route.key}-${date}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) { fail(res, error); }
}
