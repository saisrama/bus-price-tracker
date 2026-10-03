import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, intervalHours, intervalHoursForBus, siteDate } from '../src/config.mjs';
import { openDb } from '../src/db.mjs';
import { collectRouteDate, extractBuses, isTargetBus, normalizeBus, searchGroups } from '../src/collector.mjs';

test('all Volvo and Scania models qualify', () => {
  for (const busType of ['Volvo B11R Multi-Axle Sleeper', 'Volvo 9600', 'Scania Multi-Axle A/C Seater', 'VOLVO B9R']) {
    assert.equal(isTargetBus(busType), true);
  }
  assert.equal(isTargetBus('Bharat Benz A/C Sleeper'), false);
});

test('normalizes listing values and preserves unknown seat restrictions', () => {
  const listing = { routeId: 42, travelsName: 'Operator', busType: 'Volvo B11R (2+1)', departureTime: '21:30', fare: '₹1,299', availableSeats: '12 Seats' };
  const item = normalizeBus(listing, ROUTES[0], '2026-10-05');
  assert.equal(item.fareMin, 1299);
  assert.equal(item.seatsLeft, 12);
  assert.equal(item.womenSeatsLeft, null);
  assert.equal(item.sourceUrl.endsWith('onward=05-Oct-2026'), true);
  assert.equal(normalizeBus({ ...listing, busType: 'Bharat Benz' }, ROUTES[0], '2026-10-05'), null);
  const variedFare = normalizeBus({ ...listing, departureTime: '2026-10-05 21:30:00', fareList: [1399, 1699, 1499] }, ROUTES[0], '2026-10-05');
  assert.equal(variedFare.fareMin, 1399);
  assert.equal(variedFare.fareMax, 1699);
  assert.equal(variedFare.departureTime, '21:30');
});

test('extracts nested search results', () => {
  const payload = { data: { searchData: [{ private: [{ travelsName: 'A', busType: 'Scania', departureTime: '20:00' }] }] } };
  assert.equal(extractBuses(payload).length, 1);
  const groups = searchGroups({ data: { metaData: { sections: [{ sectionId: 0, groups: [{ operatorId: 33000, count: 18, displayName: 'KSRTC' }] }] } } });
  assert.deepEqual(groups, [{ groupId: 33000, sectionId: 0, count: 18, label: 'KSRTC' }]);
});

test('collects all pages and stores only target buses', async () => {
  const db = openDb(':memory:');
  const payloads = [
    { searchData: [{ totalBusCount: 3, private: [
      { routeId: 1, travelsName: 'A', busType: 'Volvo B11R', departureTime: '20:00', fare: 1500, availableSeats: 8 },
      { routeId: 2, travelsName: 'B', busType: 'Bharat Benz', departureTime: '21:00', fare: 900 },
    ] }] },
    { searchData: [{ totalBusCount: 3, private: [
      { routeId: 3, travelsName: 'C', busType: 'Scania Multi-Axle', departureTime: '22:00', fare: 1200, availableSeats: 3 },
    ] }] },
  ];
  const offsets = [];
  const mockFetch = async url => {
    offsets.push(Number(url.searchParams.get('offset')));
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => payloads.shift() };
  };
  const result = await collectRouteDate(db, ROUTES[0], '2026-10-05', { fetchImpl: mockFetch, pageDelayMs: 0 });
  assert.equal(result.status, 'success');
  assert.equal(result.count, 2);
  assert.deepEqual(offsets, [0, 2]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM observations').get().count, 2);
  db.close();
});

test('collects grouped operator results as well as private listings', async () => {
  const db = openDb(':memory:');
  const urls = [];
  const mockFetch = async url => {
    urls.push([url.searchParams.get('groupId'), url.searchParams.get('offset')]);
    const grouped = url.searchParams.get('groupId') === '33000';
    const payload = grouped
      ? { data: { inventories: [{ routeId: 2, travelsName: 'State bus', busType: 'Volvo B11R', departureTime: '2026-10-05 22:00:00', fareList: [1500] }] } }
      : { data: { metaData: { sections: [{ sectionId: 0, privateCount: 1, groups: [{ operatorId: 33000, count: 1 }] }] }, inventories: [{ routeId: 1, travelsName: 'Private bus', busType: 'Scania', departureTime: '2026-10-05 21:00:00', fareList: [1200] }] } };
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => payload };
  };
  const result = await collectRouteDate(db, ROUTES[0], '2026-10-05', { fetchImpl: mockFetch, pageDelayMs: 0 });
  assert.equal(result.count, 2);
  assert.deepEqual(urls, [['0', '0'], ['33000', '0']]);
  db.close();
});

test('keeps captured listings and flags partial runs when a later group fails', async () => {
  const db = openDb(':memory:');
  const mockFetch = async url => {
    if (url.searchParams.get('groupId') === '33000') throw new Error('connection reset');
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({
      data: { metaData: { sections: [{ privateCount: 1, groups: [{ operatorId: 33000, count: 1 }] }] },
        inventories: [{ travelsName: 'A', busType: 'Volvo B11R', departureTime: '20:00', fareList: [1200] }] },
    }) };
  };
  const result = await collectRouteDate(db, ROUTES[0], '2026-10-05', { fetchImpl: mockFetch, pageDelayMs: 0 });
  assert.equal(result.status, 'partial');
  assert.equal(result.count, 1);
  assert.equal(db.prepare('SELECT status FROM runs').get().status, 'partial');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM observations').get().count, 1);
  db.close();
});

test('stops if a source repeats the same page at a new offset', async () => {
  const db = openDb(':memory:');
  const mockFetch = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({
    data: { metaData: { sections: [{ privateCount: 100 }] }, inventories: [{ routeId: 1, travelsName: 'A', busType: 'Scania', departureTime: '20:00', fareList: [999] }] },
  }) });
  const result = await collectRouteDate(db, ROUTES[0], '2026-10-05', { fetchImpl: mockFetch, pageDelayMs: 0 });
  assert.equal(result.status, 'partial');
  assert.match(result.error, /repeated a result page/);
  db.close();
});

test('capture cadence increases near departure', () => {
  assert.equal(siteDate('2026-10-05'), '05-Oct-2026');
  assert.equal(intervalHours('2026-10-05', new Date('2026-09-28T00:00:00Z')), 12);
  assert.equal(intervalHours('2026-10-05', new Date('2026-10-04T18:30:00Z')), 1);
  const now = new Date('2026-10-04T06:30:00Z');
  assert.equal(intervalHoursForBus('2026-10-05', '06:00', now), 3);
  assert.equal(intervalHoursForBus('2026-10-05', '23:00', now), 6);
  assert.equal(intervalHoursForBus('2026-10-05', '11:00 PM', now), 6);
  assert.equal(intervalHoursForBus('2026-10-05', '23:00:00', now), 6);
});

test('each service keeps its own departure-based snapshot interval and earlier history', async () => {
  const db = openDb(':memory:');
  const date = '2026-10-05';
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({
    data: { metaData: { sections: [{ privateCount: 2 }] }, inventories: [
      { routeId: 1, travelsName: 'Early', busType: 'Volvo', departureTime: '06:00', fareList: [1200] },
      { routeId: 2, travelsName: 'Late', busType: 'Scania', departureTime: '23:00', fareList: [1400] },
    ] },
  }) });
  const first = await collectRouteDate(db, ROUTES[0], date, { fetchImpl, now: new Date('2026-10-04T06:30:00Z') });
  assert.equal(first.savedCount, 2);
  db.prepare("UPDATE observations SET observed_at='2026-10-04T06:30:00.000Z'").run();
  const second = await collectRouteDate(db, ROUTES[0], date, { fetchImpl, now: new Date('2026-10-04T10:00:00Z') });
  assert.equal(second.count, 2);
  assert.equal(second.savedCount, 1);
  assert.deepEqual(db.prepare(`SELECT departure_time, COUNT(*) AS snapshots FROM observations
    GROUP BY departure_time ORDER BY departure_time`).all().map(row => ({ ...row })), [
    { departure_time: '06:00', snapshots: 2 }, { departure_time: '23:00', snapshots: 1 },
  ]);
  const afterEarlyDeparture = await collectRouteDate(db, ROUTES[0], date,
    { fetchImpl, now: new Date('2026-10-05T01:30:00Z') });
  assert.equal(afterEarlyDeparture.savedCount, 1);
  assert.deepEqual(db.prepare(`SELECT departure_time, COUNT(*) AS snapshots FROM observations
    GROUP BY departure_time ORDER BY departure_time`).all().map(row => ({ ...row })), [
    { departure_time: '06:00', snapshots: 2 }, { departure_time: '23:00', snapshots: 2 },
  ]);
  db.close();
});

test('cloud collection waits for asynchronous storage before reporting success', async () => {
  const events = [];
  const store = {
    beginRun: async () => { events.push('begin'); return 7; },
    latestObservations: async () => new Map(),
    saveObservations: async (_db, _id, items) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(items.length, 1);
      events.push('saved');
    },
    finishRun: async (_db, _id, status) => { events.push(status); },
  };
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({
    data: { metaData: { sections: [{ privateCount: 1 }] }, inventories: [
      { routeId: 1, travelsName: 'A', busType: 'Volvo B11R', departureTime: '20:00', fareList: [1200] },
    ] },
  }) });
  const result = await collectRouteDate(null, ROUTES[0], '2026-10-05', { store, fetchImpl, pageDelayMs: 0 });
  assert.equal(result.status, 'success');
  assert.deepEqual(events, ['begin', 'saved', 'success']);
});
