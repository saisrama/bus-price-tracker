import { ROUTES, addDays, istDate, intervalHours } from './config.mjs';
import { collectRouteDate } from './collector.mjs';
import * as store from './pg-db.mjs';

const db = store.openPg();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await store.initPg(db);
  const today = istDate();
  for (let day = 0; day <= 7; day++) {
    const date = addDays(today, day);
    for (const route of ROUTES) {
      const last = await store.latestRun(db, route.key, date);
      const waitHours = ['error', 'partial'].includes(last?.status)
        ? Math.min(0.5, intervalHours(date)) : intervalHours(date);
      if (last && Date.now() - Date.parse(last.started_at) < waitHours * 3_600_000) continue;
      const outcome = await collectRouteDate(db, route, date, { store });
      console.log(`${route.key} ${date}: ${outcome.status}, ${outcome.count ?? 0} buses${outcome.error ? `; ${outcome.error}` : ''}`);
      if (outcome.status !== 'success') {
        process.exitCode = 1;
        break;
      }
      await sleep(2500);
    }
    if (process.exitCode) break;
  }
} finally {
  await db.end();
}
