import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROUTES, addDays, istDate, intervalHours } from './config.mjs';
import { openDb, latestRun } from './db.mjs';
import { collectRouteDate } from './collector.mjs';

const db = openDb(process.env.TRACKER_DB || path.resolve('data/tracker.sqlite'));
const port = Number(process.env.PORT || 3030);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let collecting = false;
let lastCycle = null;
let sourceCooldownUntil = 0;

async function collectDue(force = false) {
  if (collecting) return;
  if (!force && Date.now() < sourceCooldownUntil) return;
  collecting = true;
  try {
    const today = istDate();
    for (let day = 0; day <= 7; day++) {
      const date = addDays(today, day);
      for (const route of ROUTES) {
        const last = latestRun(db, route.key, date);
        const waitHours = ['error', 'partial'].includes(last?.status) ? Math.min(0.5, intervalHours(date)) : intervalHours(date);
        if (!force && last && Date.now() - Date.parse(last.started_at) < waitHours * 3_600_000) continue;
        const outcome = await collectRouteDate(db, route, date);
        console.log(`${new Date().toISOString()} ${route.key} ${date}: ${outcome.status}${outcome.count !== undefined ? ` ${outcome.count} buses` : ''}${outcome.error ? ` · ${outcome.error}` : ''}`);
        if (outcome.status !== 'success') {
          sourceCooldownUntil = Date.now() + 30 * 60_000;
          lastCycle = new Date().toISOString();
          return false;
        }
        await sleep(2500);
      }
    }
    lastCycle = new Date().toISOString();
    return true;
  } finally {
    collecting = false;
  }
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function validatedFilter(url) {
  const route = ROUTES.find(item => item.key === url.searchParams.get('route')) ?? ROUTES[0];
  const date = url.searchParams.get('date') || istDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date');
  return { route, date };
}

function dataFor(route, date) {
  const observations = db.prepare(`SELECT observed_at,service_key,source_id,operator,bus_type,departure_time,arrival_time,
      fare_min,fare_max,seats_left,women_seats_left,men_seats_left,source_url
    FROM observations WHERE route=? AND travel_date=? ORDER BY observed_at,operator,departure_time`).all(route.key, date);
  const runs = db.prepare(`SELECT id,started_at,finished_at,status,observed_count,error
    FROM runs WHERE route=? AND travel_date=? ORDER BY started_at DESC LIMIT 100`).all(route.key, date);
  const sourceStatus = db.prepare('SELECT route,travel_date,started_at,status,error FROM runs ORDER BY started_at DESC LIMIT 1').get();
  return { route, date, observations, runs, sourceStatus, collecting, lastCycle };
}

const appHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url));
const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url));
const appCss = fs.readFileSync(new URL('../public/style.css', import.meta.url));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/data') {
      const { route, date } = validatedFilter(url);
      return json(res, dataFor(route, date));
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, { routes: ROUTES, today: istDate(), tomorrow: addDays(istDate(), 1), canCollect: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/collect') {
      if (collecting) return json(res, { message: 'Collection already running' }, 409);
      const { route, date } = validatedFilter(url);
      collecting = true;
      collectRouteDate(db, route, date)
        .then(outcome => console.log(`${new Date().toISOString()} Manual capture ${route.key} ${date}:`, outcome))
        .catch(error => console.error('Collection failed:', error))
        .finally(() => { collecting = false; });
      return json(res, { message: `Collection started for ${route.key} ${date}` }, 202);
    }
    if (req.method === 'GET' && url.pathname === '/api/export.csv') {
      const { route, date } = validatedFilter(url);
      const rows = dataFor(route, date).observations;
      const fields = ['observed_at','operator','bus_type','departure_time','arrival_time','fare_min','fare_max','seats_left','women_seats_left','men_seats_left','source_url'];
      const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const csv = [fields.join(','), ...rows.map(row => fields.map(field => escape(row[field])).join(','))].join('\r\n');
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${route.key}-${date}.csv"` });
      return res.end(csv);
    }
    const staticFiles = {
      '/': [appHtml, 'text/html; charset=utf-8'],
      '/app.js': [appJs, 'text/javascript; charset=utf-8'],
      '/style.css': [appCss, 'text/css; charset=utf-8'],
    };
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [body, type] = staticFiles[url.pathname];
      res.writeHead(200, { 'content-type': type });
      return res.end(body);
    }
    json(res, { error: 'Not found' }, 404);
  } catch (error) {
    json(res, { error: error.message }, 400);
  }
});

if (process.argv.includes('--once')) {
  const completed = await collectDue();
  db.close();
  if (completed === false) process.exitCode = 1;
} else {
  server.listen(port, '127.0.0.1', () => console.log(`Tracker at http://127.0.0.1:${port}`));
  if (!process.argv.includes('--no-collect')) {
    collectDue().catch(error => console.error('Collection failed:', error));
    setInterval(() => collectDue().catch(error => console.error('Collection failed:', error)), 15 * 60_000).unref();
  }
}
