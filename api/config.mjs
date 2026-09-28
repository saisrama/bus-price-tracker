import { ROUTES, addDays, istDate } from '../src/config.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ routes: ROUTES, today: istDate(), tomorrow: addDays(istDate(), 1), canCollect: false, exportPath: '/api/export' });
}
