import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initPg, openPg } from './pg-db.mjs';

const local = new DatabaseSync(process.env.TRACKER_DB || path.resolve('data/tracker.sqlite'), { readOnly: true });
const remote = openPg(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
try {
  await initPg(remote);
  const runs = local.prepare('SELECT * FROM runs ORDER BY id').all();
  let importedRuns = 0, importedObservations = 0;
  for (const run of runs) {
    const existing = await remote.query(
      'SELECT id FROM runs WHERE route=$1 AND travel_date=$2 AND started_at=$3 LIMIT 1',
      [run.route, run.travel_date, run.started_at]);
    let remoteId = existing.rows[0]?.id;
    if (!remoteId) {
      const inserted = await remote.query(`INSERT INTO runs
        (route,travel_date,started_at,finished_at,status,observed_count,error)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [run.route, run.travel_date, run.started_at, run.finished_at, run.status, run.observed_count, run.error]);
      remoteId = inserted.rows[0].id;
      importedRuns++;
    }
    const observations = local.prepare('SELECT * FROM observations WHERE run_id=?').all(run.id);
    for (const item of observations) {
      const inserted = await remote.query(`INSERT INTO observations
        (run_id,observed_at,route,travel_date,service_key,source_id,operator,bus_type,departure_time,arrival_time,fare_min,fare_max,seats_left,women_seats_left,men_seats_left,source_url,raw_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (run_id,service_key) DO NOTHING RETURNING id`,
      [remoteId, item.observed_at, item.route, item.travel_date, item.service_key, item.source_id,
        item.operator, item.bus_type, item.departure_time, item.arrival_time, item.fare_min,
        item.fare_max, item.seats_left, item.women_seats_left, item.men_seats_left,
        item.source_url, item.raw_json]);
      importedObservations += inserted.rowCount;
    }
  }
  console.log(`Imported ${importedRuns} runs and ${importedObservations} observations.`);
} finally {
  local.close();
  await remote.end();
}
