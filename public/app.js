const $ = id => document.getElementById(id);
const fmtMoney = value => value == null || !Number.isFinite(Number(value)) ? '—' : `₹${Math.round(Number(value)).toLocaleString('en-IN')}`;
const fmtTime = value => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const fmtLongTime = value => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const metrics = {
  observed_at: { label: 'Observation time', format: value => fmtTime(value) },
  hours_before: { label: 'Hours before departure', format: value => `${Number(value).toFixed(1)} h` },
  fare_min: { label: 'Lowest fare', format: fmtMoney },
  fare_max: { label: 'Highest fare', format: fmtMoney },
  seats_left: { label: 'Seats left', format: value => String(Math.round(value)) },
  women_seats_left: { label: 'Women seats left', format: value => String(Math.round(value)) },
  men_seats_left: { label: 'Men seats left', format: value => String(Math.round(value)) },
};
let state = { observations: [], runs: [], selected: null, sourceStatus: null, collecting: false };
let exportPath = '/api/export.csv';
let loadNumber = 0;
let savedGraphs = [];

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function departureTime(row) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([AP]M))?$/i.exec(String(row.departure_time ?? '').trim());
  if (!match || !row.travel_date) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23) || (match[3] && hour < 1)) return null;
  if (match[3]) hour = (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  const timestamp = Date.parse(`${row.travel_date}T${String(hour).padStart(2, '0')}:${match[2]}:00+05:30`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hoursBefore(row) {
  const departure = departureTime(row);
  const observed = Date.parse(row.observed_at);
  return departure == null || !Number.isFinite(observed) ? null : (departure - observed) / 3_600_000;
}

function metricValue(row, key) {
  if (key === 'observed_at') return Date.parse(row.observed_at);
  if (key === 'hours_before') return hoursBefore(row);
  return row[key] == null ? null : Number(row[key]);
}

function latestServices(observations) {
  const latest = new Map();
  for (const row of observations) {
    const previous = latest.get(row.service_key);
    if (!previous || Date.parse(row.observed_at) > Date.parse(previous.observed_at)) latest.set(row.service_key, row);
  }
  return [...latest.values()].sort((a, b) => (a.fare_min ?? Infinity) - (b.fare_min ?? Infinity) || a.operator.localeCompare(b.operator));
}

function marketHistory(observations) {
  const ordered = [...observations].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const current = new Map();
  const points = [];
  for (let i = 0; i < ordered.length;) {
    const time = ordered[i].observed_at;
    while (i < ordered.length && ordered[i].observed_at === time) {
      current.set(ordered[i].service_key, ordered[i]);
      i++;
    }
    const fares = [...current.values()].filter(row => {
      const departure = departureTime(row);
      return Number.isFinite(row.fare_min) && (departure == null || departure > Date.parse(time));
    }).map(row => row.fare_min);
    if (fares.length) points.push({ x: Date.parse(time), min: Math.min(...fares), med: median(fares), services: fares.length });
  }
  return points;
}

function pointDetails(row, prefix = '') {
  return [prefix, `${row.operator} · ${row.bus_type}`, `Departs ${row.travel_date} at ${row.departure_time} IST`,
    `Observed ${fmtLongTime(row.observed_at)}`, `Fare ${fmtMoney(row.fare_min)}${row.fare_max != null && row.fare_max !== row.fare_min ? `–${fmtMoney(row.fare_max)}` : ''}`,
    `Seats ${row.seats_left ?? 'unknown'} · Women ${row.women_seats_left ?? 'unknown'} · Men ${row.men_seats_left ?? 'unknown'}`].filter(Boolean).join('\n');
}

function graph(series, options = {}) {
  const all = series.flatMap(item => item.points).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!all.length) return `<div class="empty">${escapeHtml(options.empty || 'No observations with these values yet.')}</div>`;
  const width = 760, height = options.small ? 92 : 280;
  const pad = options.small ? { l: 50, r: 16, t: 8, b: 23 } : { l: 64, r: 24, t: 18, b: options.xLabel ? 54 : 37 };
  const xs = all.map(point => point.x), ys = all.map(point => point.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yLow = Math.min(...ys), yHigh = Math.max(...ys);
  const yRange = Math.max(1, yHigh - yLow);
  const yMin = Math.max(0, yLow - yRange * .18), yMax = yHigh + yRange * .18;
  const x = value => pad.l + (xMax === xMin ? .5 : (value - xMin) / (xMax - xMin)) * (width - pad.l - pad.r);
  const y = value => height - pad.b - (value - yMin) / (yMax - yMin) * (height - pad.t - pad.b);
  const xFormat = options.xFormat || (value => fmtTime(value));
  const yFormat = options.yFormat || (value => Math.round(value).toLocaleString('en-IN'));
  const grid = [0, 1, 2, 3].map(i => {
    const value = yMin + (yMax - yMin) * i / 3;
    return `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(value)}" y2="${y(value)}" stroke="#e9eeea"/><text x="${pad.l - 9}" y="${y(value) + 4}" text-anchor="end" class="axis-tick">${escapeHtml(yFormat(value))}</text>`;
  }).join('');
  const ticks = `<text x="${pad.l}" y="${height - (options.xLabel ? 27 : 7)}" class="axis-tick">${escapeHtml(xFormat(xMin))}</text>${xMax > xMin ? `<text x="${width - pad.r}" y="${height - (options.xLabel ? 27 : 7)}" text-anchor="end" class="axis-tick">${escapeHtml(xFormat(xMax))}</text>` : ''}`;
  const axis = options.xLabel ? `<text x="${width / 2}" y="${height - 5}" text-anchor="middle" class="axis-label">${escapeHtml(options.xLabel)}</text>` : '';
  const marks = series.map(item => {
    const points = item.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).sort((a, b) => a.x - b.x);
    const path = item.connect && points.length > 1 ? `<path d="${points.map((point, index) => `${index ? 'L' : 'M'}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${item.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    const dots = points.map(point => `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="4.8" fill="${item.color}" stroke="white" stroke-width="1.3" tabindex="0" data-tip="${escapeHtml(point.tip || `${xFormat(point.x)} · ${yFormat(point.y)}`)}" aria-label="${escapeHtml(point.tip || `${xFormat(point.x)} · ${yFormat(point.y)}`)}"/>`).join('');
    return path + dots;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || 'Observation graph')}" preserveAspectRatio="none">${grid}${marks}${ticks}${axis}</svg><div class="chart-tooltip" hidden></div>`;
}

function attachTooltips(container) {
  function show(event) {
    const point = event.target.closest?.('circle[data-tip]');
    const tip = container.querySelector('.chart-tooltip');
    if (!point || !tip) return;
    tip.textContent = point.dataset.tip;
    tip.hidden = false;
    const bounds = container.getBoundingClientRect();
    const target = point.getBoundingClientRect();
    const px = 'clientX' in event ? event.clientX - bounds.left : target.left + target.width / 2 - bounds.left;
    const py = 'clientY' in event ? event.clientY - bounds.top : target.top - bounds.top;
    tip.style.left = `${Math.max(8, Math.min(px + 12, bounds.width - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, py - tip.offsetHeight - 12)}px`;
  }
  function hide() {
    const tip = container.querySelector('.chart-tooltip');
    if (tip) tip.hidden = true;
  }
  container.addEventListener('pointerover', show);
  container.addEventListener('pointermove', show);
  container.addEventListener('pointerout', hide);
  container.addEventListener('focusin', show);
  container.addEventListener('focusout', hide);
}

function customGraph(observations, { scope, xKey, yKey }) {
  const rows = scope === 'all' ? observations : observations.filter(row => row.service_key === state.selected);
  const points = rows.map(row => {
    const x = metricValue(row, xKey), y = metricValue(row, yKey);
    return { x, y, tip: pointDetails(row, `${metrics[xKey].label}: ${Number.isFinite(x) ? metrics[xKey].format(xKey === 'observed_at' ? row.observed_at : x) : 'unknown'}\n${metrics[yKey].label}: ${Number.isFinite(y) ? metrics[yKey].format(y) : 'unknown'}`) };
  }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  const html = graph([{ color: '#0d795e', points, connect: scope === 'selected' && xKey === 'observed_at' }], {
    label: `${metrics[yKey].label} by ${metrics[xKey].label}`,
    xFormat: value => xKey === 'observed_at' ? fmtTime(value) : metrics[xKey].format(value),
    yFormat: metrics[yKey].format,
    xLabel: metrics[xKey].label,
    empty: 'No snapshots have both selected values. Try another axis or service.',
  });
  return { html, note: `${points.length} of ${rows.length} snapshots have both values. Hover or focus a point for its full observation.` };
}

function currentGraphConfig() {
  return { scope: $('graph-scope').value, xKey: $('graph-x').value, yKey: $('graph-y').value };
}

function renderCustomGraph(observations) {
  const { html, note } = customGraph(observations, currentGraphConfig());
  $('graph-note').textContent = note;
  $('custom-chart').innerHTML = html;
}

function renderSavedGraphs(observations) {
  const container = $('saved-graphs');
  container.innerHTML = savedGraphs.map((config, index) => `<article class="saved-graph"><header><h3>${escapeHtml(metrics[config.yKey].label)} by ${escapeHtml(metrics[config.xKey].label)}</h3><button type="button" data-remove="${index}" aria-label="Remove saved graph ${index + 1}">Remove</button></header><p class="panel-note" data-saved-note="${index}"></p><div class="custom-chart" data-saved-chart="${index}"></div></article>`).join('');
  for (const [index, config] of savedGraphs.entries()) {
    const chart = container.querySelector(`[data-saved-chart="${index}"]`);
    const { html, note } = customGraph(observations, config);
    chart.innerHTML = html;
    container.querySelector(`[data-saved-note="${index}"]`).textContent = `${config.scope === 'selected' ? 'Selected service' : 'All services'} · ${note}`;
    attachTooltips(chart);
  }
}

function render() {
  const { observations, runs } = state;
  const latest = latestServices(observations);
  const prices = latest.map(row => row.fare_min).filter(Number.isFinite);
  const lastSeen = observations.reduce((max, row) => !max || row.observed_at > max ? row.observed_at : max, null);
  $('stat-buses').textContent = String(latest.length);
  $('stat-low').textContent = prices.length ? fmtMoney(Math.min(...prices)) : '—';
  $('stat-median').textContent = fmtMoney(median(prices));
  $('stat-time').textContent = fmtTime(lastSeen);
  $('stat-captures').textContent = `${observations.length} snapshots saved for this date`;
  const sourceError = ['error', 'partial'].includes(state.sourceStatus?.status) ? state.sourceStatus : null;
  const status = $('status-message');
  status.classList.toggle('error', Boolean(sourceError));
  status.textContent = sourceError ? `${sourceError.status === 'partial' ? 'Partial capture' : 'Latest source request failed'} (${sourceError.route}, ${sourceError.travel_date}): ${sourceError.error}` : latest.length ? `${latest.length} services tracked for this date · ${observations.length} snapshots saved` : 'No observations for this route and date yet. Choose a saved date to browse history.';
  $('collection-state').textContent = state.collecting ? '● Collecting' : sourceError ? sourceError.status === 'partial' ? '● Partial capture' : '● Source error' : latest.length ? '● Tracking' : '● Waiting for data';
  $('collection-state').classList.toggle('working', state.collecting || latest.length > 0);
  $('collect-button').disabled = Boolean(state.collecting);

  const market = marketHistory(observations);
  $('market-chart').innerHTML = graph([
    { color: '#0d795e', connect: true, points: market.map(point => ({ x: point.x, y: point.min, tip: `${fmtLongTime(point.x)}\nLowest known fare ${fmtMoney(point.min)}\nMedian known fare ${fmtMoney(point.med)}\n${point.services} services` })) },
    { color: '#e7aa53', connect: true, points: market.map(point => ({ x: point.x, y: point.med, tip: `${fmtLongTime(point.x)}\nMedian known fare ${fmtMoney(point.med)}\nLowest known fare ${fmtMoney(point.min)}\n${point.services} services` })) },
  ], { label: 'Lowest and median last known fares over time', yFormat: fmtMoney });

  if (!latest.some(row => row.service_key === state.selected)) state.selected = latest[0]?.service_key ?? null;
  const chosen = latest.find(row => row.service_key === state.selected);
  $('selected-title').textContent = chosen ? `${chosen.operator} · ${chosen.departure_time}` : 'Choose a bus';
  const picker = $('service-select');
  const signature = latest.map(row => row.service_key).join('|');
  if (picker.dataset.signature !== signature) {
    picker.innerHTML = latest.length ? [...latest].sort((a, b) => a.operator.localeCompare(b.operator) || a.departure_time.localeCompare(b.departure_time)).map(row => `<option value="${escapeHtml(row.service_key)}">${escapeHtml(row.operator)} · ${escapeHtml(row.departure_time)} · ${escapeHtml(row.bus_type)}</option>`).join('') : '<option value="">No services recorded</option>';
    picker.dataset.signature = signature;
  }
  picker.value = state.selected ?? '';
  picker.disabled = !latest.length;
  const history = observations.filter(row => row.service_key === state.selected).sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  $('service-chart').innerHTML = graph([{ color: '#0d795e', connect: true, points: history.map(row => ({ x: Date.parse(row.observed_at), y: row.fare_min, tip: pointDetails(row) })) }], { label: 'Selected service fare history', yFormat: fmtMoney });
  $('seat-chart').innerHTML = graph([{ color: '#e7aa53', connect: true, points: history.map(row => ({ x: Date.parse(row.observed_at), y: row.seats_left, tip: pointDetails(row) })) }], { small: true, label: 'Selected service seats remaining' });
  $('history-count').textContent = `${history.length} snapshots`;
  $('history-description').textContent = chosen ? `${chosen.operator} · ${chosen.bus_type} · ${chosen.departure_time} departure · First seen ${fmtLongTime(history[0]?.observed_at)} · Last seen ${fmtLongTime(history.at(-1)?.observed_at)}` : 'Choose a service to see its past fares and seats.';
  $('history-rows').innerHTML = history.length ? [...history].reverse().map(row => `<tr><td>${escapeHtml(fmtLongTime(row.observed_at))}</td><td class="fare">${fmtMoney(row.fare_min)}</td><td>${fmtMoney(row.fare_max)}</td><td>${row.seats_left ?? '—'}</td><td>${row.women_seats_left ?? '—'}</td><td>${row.men_seats_left ?? '—'}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-row">No snapshots for this service yet.</td></tr>';
  renderCustomGraph(observations);
  renderSavedGraphs(observations);

  const query = $('search').value.trim().toLowerCase();
  const filtered = latest.filter(row => `${row.operator} ${row.bus_type} ${row.departure_time}`.toLowerCase().includes(query));
  $('listing-count').textContent = `${filtered.length} services`;
  $('bus-rows').innerHTML = filtered.length ? filtered.map(row => `<tr data-key="${escapeHtml(row.service_key)}" class="${row.service_key === state.selected ? 'selected' : ''}" tabindex="0" aria-label="Show history for ${escapeHtml(row.operator)} at ${escapeHtml(row.departure_time)}">
    <td><div class="bus-name">${escapeHtml(row.operator)}</div><div class="bus-type">${escapeHtml(row.bus_type)}</div></td>
    <td>${escapeHtml(row.departure_time)}</td><td class="fare">${fmtMoney(row.fare_min)}${row.fare_max != null && row.fare_max > row.fare_min ? `<span class="seat-sub">to ${fmtMoney(row.fare_max)}</span>` : ''}</td>
    <td>${row.seats_left ?? '—'}<span class="seat-sub">${row.women_seats_left == null && row.men_seats_left == null ? 'Restrictions unavailable' : `Women: ${row.women_seats_left ?? '—'} · Men: ${row.men_seats_left ?? '—'}`}</span></td>
    <td>${escapeHtml(fmtTime(row.observed_at))}</td><td><a href="${escapeHtml(row.source_url)}" target="_blank" rel="noopener noreferrer">View ↗</a></td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty-row">No services to show for this filter and date.</td></tr>';
  for (const row of $('bus-rows').querySelectorAll('tr[data-key]')) {
    const select = event => {
      if (event.target.closest('a')) return;
      state.selected = row.dataset.key;
      render();
      $('history').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); } });
  }
}

async function loadDates() {
  const response = await fetch(`/api/dates?route=${encodeURIComponent($('route').value)}`);
  if (!response.ok) throw new Error(`Saved dates returned HTTP ${response.status}`);
  const { dates } = await response.json();
  $('saved-date').innerHTML = '<option value="">Choose a date with history</option>' + dates.map(item => `<option value="${escapeHtml(item.travel_date)}">${escapeHtml(item.travel_date)} · ${item.services} services · ${item.snapshots} snapshots</option>`).join('');
  $('saved-date').value = dates.some(item => item.travel_date === $('travel-date').value) ? $('travel-date').value : '';
}

async function load() {
  const route = $('route').value, date = $('travel-date').value;
  if (!route || !date) return;
  const request = ++loadNumber;
  const response = await fetch(`/api/data?route=${encodeURIComponent(route)}&date=${encodeURIComponent(date)}`);
  if (!response.ok) throw new Error(`Dashboard returned HTTP ${response.status}`);
  const data = await response.json();
  if (request !== loadNumber) return;
  state = { ...state, ...data };
  $('saved-date').value = [...$('saved-date').options].some(option => option.value === date) ? date : '';
  $('export-link').href = `${exportPath}?route=${encodeURIComponent(route)}&date=${encodeURIComponent(date)}`;
  render();
}

function showError(error) {
  $('status-message').textContent = error.message;
  $('status-message').classList.add('error');
  console.error(error);
}

async function start() {
  try {
    const stored = JSON.parse(localStorage.getItem('bus-fare-graphs') || '[]');
    if (Array.isArray(stored)) savedGraphs = stored.filter(config => config &&
      ['selected', 'all'].includes(config.scope) && Object.hasOwn(metrics, config.xKey) && Object.hasOwn(metrics, config.yKey)).slice(0, 6);
  } catch { savedGraphs = []; }
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error(`Configuration returned HTTP ${response.status}`);
  const config = await response.json();
  exportPath = config.exportPath ?? exportPath;
  if (config.canCollect === false) $('collect-button').hidden = true;
  $('route').innerHTML = config.routes.map(route => `<option value="${escapeHtml(route.key)}">${escapeHtml(route.label)}</option>`).join('');
  $('travel-date').value = config.tomorrow;
  for (const id of ['market-chart', 'service-chart', 'seat-chart', 'custom-chart']) attachTooltips($(id));
  $('route').addEventListener('change', async () => { try { await loadDates(); await load(); } catch (error) { showError(error); } });
  $('travel-date').addEventListener('change', () => load().catch(showError));
  $('saved-date').addEventListener('change', () => { if ($('saved-date').value) { $('travel-date').value = $('saved-date').value; load().catch(showError); } });
  $('service-select').addEventListener('change', () => { state.selected = $('service-select').value; render(); });
  for (const id of ['graph-scope', 'graph-x', 'graph-y']) $(id).addEventListener('change', () => renderCustomGraph(state.observations));
  $('save-graph').addEventListener('click', () => {
    const config = currentGraphConfig();
    if (savedGraphs.some(item => JSON.stringify(item) === JSON.stringify(config))) {
      $('save-status').textContent = 'This graph is already saved.';
      return;
    }
    if (savedGraphs.length >= 6) {
      $('save-status').textContent = 'Remove a saved graph before adding another.';
      return;
    }
    savedGraphs.push(config);
    let stored = true;
    try { localStorage.setItem('bus-fare-graphs', JSON.stringify(savedGraphs)); }
    catch { stored = false; }
    renderSavedGraphs(state.observations);
    $('save-status').textContent = stored ? 'Graph saved in this browser.' : 'Graph added for this session; browser storage is unavailable.';
  });
  $('saved-graphs').addEventListener('click', event => {
    const button = event.target.closest('button[data-remove]');
    if (!button) return;
    savedGraphs.splice(Number(button.dataset.remove), 1);
    try { localStorage.setItem('bus-fare-graphs', JSON.stringify(savedGraphs)); } catch { /* Session only. */ }
    renderSavedGraphs(state.observations);
    $('save-status').textContent = 'Saved graph removed.';
  });
  $('search').addEventListener('input', render);
  $('collect-button').addEventListener('click', async () => {
    const result = await fetch(`/api/collect?route=${encodeURIComponent($('route').value)}&date=${encodeURIComponent($('travel-date').value)}`, { method: 'POST' });
    if (!result.ok && result.status !== 409) alert('Could not start collection');
    await load();
  });
  await loadDates();
  await load();
  setInterval(() => load().catch(showError), 15_000);
}

start().catch(showError);
