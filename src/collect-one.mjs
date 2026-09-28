import path from 'node:path';
import { ROUTES } from './config.mjs';
import { openDb } from './db.mjs';
import { collectRouteDate } from './collector.mjs';

const [routeKey, travelDate] = process.argv.slice(2);
const route = ROUTES.find(item => item.key === routeKey);
if (!route || !/^\d{4}-\d{2}-\d{2}$/.test(travelDate ?? '')) {
  console.error('Usage: npm run collect:one -- BLR-HYD 2026-10-05');
  process.exit(2);
}
const db = openDb(process.env.TRACKER_DB || path.resolve('data/tracker.sqlite'));
const result = await collectRouteDate(db, route, travelDate);
console.log(result);
db.close();
if (result.status !== 'success') process.exitCode = 1;
