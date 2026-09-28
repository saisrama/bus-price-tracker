import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDb(filename = path.resolve('data/tracker.sqlite')) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
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
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      observed_at TEXT NOT NULL,
      route TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      service_key TEXT NOT NULL,
      source_id TEXT,
      operator TEXT NOT NULL,
      bus_type TEXT NOT NULL,
      departure_time TEXT NOT NULL,
      arrival_time TEXT,
      fare_min REAL,
      fare_max REAL,
      seats_left INTEGER,
      women_seats_left INTEGER,
      men_seats_left INTEGER,
      source_url TEXT,
      raw_json TEXT,
      UNIQUE(run_id, service_key)
    );
    CREATE INDEX IF NOT EXISTS observation_lookup ON observations(route, travel_date, service_key, observed_at);
  `);
  return db;
}

export function beginRun(db, route, travelDate) {
  return db.prepare('INSERT INTO runs(route,travel_date,started_at,status) VALUES(?,?,?,?)').run(route, travelDate, new Date().toISOString(), 'running').lastInsertRowid;
}

export function finishRun(db, id, status, count = 0, error = null) {
  db.prepare('UPDATE runs SET finished_at=?,status=?,observed_count=?,error=? WHERE id=?')
    .run(new Date().toISOString(), status, count, error?.slice(0, 1000) ?? null, id);
}

export function saveObservations(db, runId, items) {
  const insert = db.prepare(`INSERT OR IGNORE INTO observations
    (run_id,observed_at,route,travel_date,service_key,source_id,operator,bus_type,departure_time,arrival_time,fare_min,fare_max,seats_left,women_seats_left,men_seats_left,source_url,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const observedAt = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const item of items) insert.run(runId, observedAt, item.route, item.travelDate,
      item.serviceKey, item.sourceId, item.operator, item.busType, item.departureTime,
      item.arrivalTime, item.fareMin, item.fareMax, item.seatsLeft, item.womenSeatsLeft,
      item.menSeatsLeft, item.sourceUrl, JSON.stringify(item.raw));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function latestRun(db, route, date) {
  return db.prepare('SELECT * FROM runs WHERE route=? AND travel_date=? ORDER BY started_at DESC LIMIT 1').get(route, date);
}
