import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/start\(\)\.catch\(showError\);\s*$/, 'globalThis.model = { latestServices, marketHistory, metricValue, graph, customGraph };');
const context = vm.createContext({});
vm.runInContext(source, context);
const { latestServices, marketHistory, metricValue, graph, customGraph } = context.model;

test('dashboard controls referenced by the script exist in the page', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...source.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes(`id="${id}"`)), []);
});

test('dashboard retains each service when snapshots arrive at different times', () => {
  const common = { travel_date: '2026-10-05', bus_type: 'Volvo', departure_time: '20:00' };
  const rows = [
    { ...common, service_key: 'a', operator: 'A', observed_at: '2026-10-04T10:00:00Z', fare_min: 1200, seats_left: 8 },
    { ...common, service_key: 'b', operator: 'B', observed_at: '2026-10-04T10:00:00Z', fare_min: 1400, seats_left: 3 },
    { ...common, service_key: 'a', operator: 'A', observed_at: '2026-10-04T11:00:00Z', fare_min: 1100, seats_left: 7 },
  ];
  const latest = latestServices(rows);
  assert.equal(latest.length, 2);
  assert.equal(latest.find(row => row.service_key === 'b').fare_min, 1400);
  const market = marketHistory(rows);
  assert.deepEqual(Array.from(market, point => [point.min, point.med, point.services]), [
    [1200, 1300, 2], [1100, 1250, 2],
  ]);
  assert.equal(metricValue({ ...rows[0], seats_left: 0 }, 'seats_left'), 0);
  assert.ok(metricValue(rows[0], 'hours_before') > 0);
  assert.match(graph([{ color: '#0d795e', points: [{ x: 8, y: 1200, tip: 'Seats 8; fare ₹1,200' }] }]), /data-tip="Seats 8; fare ₹1,200"/);
  const scatter = customGraph([{ ...rows[0], seats_left: 0 }], { scope: 'all', xKey: 'seats_left', yKey: 'fare_min' });
  assert.match(scatter.html, /Seats left: 0/);
  assert.match(scatter.note, /1 of 1 snapshots/);
});

test('custom graphs connect each service in observation order without joining different buses', () => {
  const common = { travel_date: '2026-10-05', bus_type: 'Volvo', departure_time: '20:00' };
  const rows = [
    { ...common, service_key: 'a', operator: 'A', observed_at: '2026-10-04T10:00:00Z', fare_min: 1200, seats_left: 8 },
    { ...common, service_key: 'b', operator: 'B', observed_at: '2026-10-04T10:30:00Z', fare_min: 1300, seats_left: 5 },
    { ...common, service_key: 'a', operator: 'A', observed_at: '2026-10-04T11:00:00Z', fare_min: 1100, seats_left: 7 },
    { ...common, service_key: 'b', operator: 'B', observed_at: '2026-10-04T11:30:00Z', fare_min: 1250, seats_left: 4 },
  ];
  const { html, note } = customGraph(rows, { scope: 'all', xKey: 'seats_left', yKey: 'fare_min' });
  const paths = [...html.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  assert.ok(paths.every(path => (path.match(/L/g) || []).length === 1));
  assert.match(paths[0], /^M736\.0,[\d.]+ L568\.0,[\d.]+$/);
  assert.match(paths[1], /^M232\.0,[\d.]+ L64\.0,[\d.]+$/);
  assert.equal((html.match(/<circle /g) || []).length, 4);
  assert.match(html, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(html, /<div class="chart-tooltip" role="status"/);
  assert.match(note, /Lines connect each service's observations in time order/);
});

test('dashboard renders past service history and custom graph controls', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      let html = '', value = '';
      const events = {};
      const item = {
        dataset: {}, events, classList: { toggle() {}, add() {} },
        get innerHTML() { return html; },
        set innerHTML(next) {
          html = next;
          if (['route', 'saved-date'].includes(id)) value = /<option value="([^"]*)"/.exec(next)?.[1] ?? '';
        },
        get value() { return value; }, set value(next) { value = next; },
        get options() { return [...html.matchAll(/<option value="([^"]*)"/g)].map(match => ({ value: match[1] })); },
        addEventListener(type, handler) { events[type] = handler; },
        querySelectorAll() { return []; },
      };
      elements.set(id, item);
    }
    return elements.get(id);
  }
  element('graph-scope').value = 'selected';
  element('graph-x').value = 'observed_at';
  element('graph-y').value = 'fare_min';
  const common = { travel_date: '2026-10-05', bus_type: 'Volvo', departure_time: '20:00', source_url: 'https://example.com' };
  const observations = [
    { ...common, service_key: 'a', operator: 'A', observed_at: '2026-10-04T10:00:00Z', fare_min: 1200, seats_left: 8 },
    { ...common, service_key: 'b', operator: 'B', observed_at: '2026-10-04T10:00:00Z', fare_min: 1400, seats_left: 3 },
    { ...common, service_key: 'a', operator: 'A', observed_at: '2026-10-04T11:00:00Z', fare_min: 1100, seats_left: 7 },
  ];
  const responses = {
    '/api/config': { routes: [{ key: 'BLR-HYD', label: 'Bengaluru to Hyderabad' }], tomorrow: '2026-10-05', canCollect: false },
    '/api/dates': { dates: [{ travel_date: '2026-10-05', services: 2, snapshots: 3 }] },
    '/api/data': { observations, runs: [], sourceStatus: null, collecting: false },
  };
  const runtime = vm.createContext({
    document: { getElementById: element }, localStorage: { getItem: () => null },
    fetch: async url => ({ ok: true, json: async () => responses[Object.keys(responses).find(path => url.startsWith(path))] }),
    setInterval() {}, console,
  });
  vm.runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
    .replace(/start\(\)\.catch\(showError\);\s*$/, 'globalThis.started = start();'), runtime);
  await runtime.started;
  assert.equal(element('stat-buses').textContent, '2');
  assert.equal(element('history-count').textContent, '2 snapshots');
  assert.match(element('history-rows').innerHTML, /₹1,100/);
  assert.match(element('saved-date').innerHTML, /2026-10-05/);
  element('graph-x').value = 'seats_left';
  element('graph-x').events.change();
  assert.match(element('custom-chart').innerHTML, /Seats left/);
});
