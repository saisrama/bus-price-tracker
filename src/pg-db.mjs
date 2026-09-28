import pg from 'pg';

export function openPg(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 10000 });
}

export async function initPg(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id BIGSERIAL PRIMARY KEY,
      route TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      observed_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_lookup ON runs(route, travel_date, started_at DESC);
    CREATE TABLE IF NOT EXISTS observations (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES runs(id),
      observed_at TEXT NOT NULL,
      route TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      service_key TEXT NOT NULL,
      source_id TEXT,
      operator TEXT NOT NULL,
      bus_type TEXT NOT NULL,
      departure_time TEXT NOT NULL,
      arrival_time TEXT,
      fare_min DOUBLE PRECISION,
      fare_max DOUBLE PRECISION,
      seats_left INTEGER,
      women_seats_left INTEGER,
      men_seats_left INTEGER,
      source_url TEXT,
      raw_json JSONB,
      UNIQUE(run_id, service_key)
    );
    CREATE INDEX IF NOT EXISTS observation_lookup ON observations(route, travel_date, service_key, observed_at);
  `);
}

export async function beginRun(db, route, travelDate) {
  const { rows } = await db.query(
    'INSERT INTO runs(route,travel_date,started_at,status) VALUES($1,$2,$3,$4) RETURNING id',
    [route, travelDate, new Date().toISOString(), 'running']);
  return rows[0].id;
}

export async function finishRun(db, id, status, count = 0, error = null) {
  await db.query('UPDATE runs SET finished_at=$1,status=$2,observed_count=$3,error=$4 WHERE id=$5',
    [new Date().toISOString(), status, count, error?.slice(0, 1000) ?? null, id]);
}

export async function saveObservations(db, runId, items) {
  if (!items.length) return;
  const observedAt = new Date().toISOString();
  const keepRaw = process.env.STORE_RAW_JSON === '1';
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(`INSERT INTO observations
        (run_id,observed_at,route,travel_date,service_key,source_id,operator,bus_type,departure_time,arrival_time,fare_min,fare_max,seats_left,women_seats_left,men_seats_left,source_url,raw_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (run_id,service_key) DO NOTHING`,
      [runId, observedAt, item.route, item.travelDate, item.serviceKey, item.sourceId,
        item.operator, item.busType, item.departureTime, item.arrivalTime, item.fareMin,
        item.fareMax, item.seatsLeft, item.womenSeatsLeft, item.menSeatsLeft,
        item.sourceUrl, keepRaw ? JSON.stringify(item.raw) : null]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function latestRun(db, route, date) {
  const { rows } = await db.query(
    'SELECT * FROM runs WHERE route=$1 AND travel_date=$2 ORDER BY started_at DESC LIMIT 1', [route, date]);
  return rows[0];
}

export async function dataFor(db, route, date) {
  const [observations, runs, sourceStatus] = await Promise.all([
    db.query(`SELECT observed_at,service_key,source_id,operator,bus_type,departure_time,arrival_time,
      fare_min,fare_max,seats_left,women_seats_left,men_seats_left,source_url
      FROM observations WHERE route=$1 AND travel_date=$2 ORDER BY observed_at,operator,departure_time`, [route, date]),
    db.query(`SELECT id,started_at,finished_at,status,observed_count,error
      FROM runs WHERE route=$1 AND travel_date=$2 ORDER BY started_at DESC LIMIT 100`, [route, date]),
    db.query('SELECT route,travel_date,started_at,status,error FROM runs ORDER BY started_at DESC LIMIT 1'),
  ]);
  return { route, date, observations: observations.rows, runs: runs.rows,
    sourceStatus: sourceStatus.rows[0] ?? null, collecting: false, lastCycle: null };
}
