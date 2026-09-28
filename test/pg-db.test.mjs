import test from 'node:test';
import assert from 'node:assert/strict';
import { saveObservations } from '../src/pg-db.mjs';

test('cloud storage omits bulky raw listings by default', async () => {
  const calls = [];
  const client = { query: async (sql, values) => { calls.push([sql, values]); }, release: () => {} };
  const db = { connect: async () => client };
  const previous = process.env.STORE_RAW_JSON;
  delete process.env.STORE_RAW_JSON;
  try {
    await saveObservations(db, 7, [{
      route: 'BLR-HYD', travelDate: '2026-10-05', serviceKey: 'key', sourceId: '1',
      operator: 'A', busType: 'Volvo', departureTime: '21:00', arrivalTime: '06:00',
      fareMin: 1200, fareMax: 1400, seatsLeft: 5, womenSeatsLeft: null, menSeatsLeft: null,
      sourceUrl: 'https://example.com', raw: { large: 'unneeded source payload' },
    }]);
    assert.equal(calls[1][1].at(-1), null);
    assert.equal(calls.at(-1)[0], 'COMMIT');
  } finally {
    if (previous === undefined) delete process.env.STORE_RAW_JSON;
    else process.env.STORE_RAW_JSON = previous;
  }
});
