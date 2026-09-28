const $ = id => document.getElementById(id);
const fmtMoney = value => value == null ? '—' : `₹${Math.round(value).toLocaleString('en-IN')}`;
const fmtTime = value => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let state = { observations: [], runs: [], selected: null };

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function graph(series, options = {}) {
  const all = series.flatMap(item => item.points).filter(point => Number.isFinite(point.y));
  if (!all.length) return '<div class="empty">No observations yet. The graph will appear after a successful capture.</div>';
  const width = 660, height = options.small ? 80 : 235;
  const pad = options.small ? { l: 42, r: 15, t: 10, b: 21 } : { l: 48, r: 16, t: 18, b: 36 };
  const xMin = Math.min(...all.map(point => point.x));
  const xMax = Math.max(...all.map(point => point.x));
  const yMin0 = Math.min(...all.map(point => point.y));
  const yMax0 = Math.max(...all.map(point => point.y));
  const yMin = Math.max(0, yMin0 - Math.max(2, (yMax0 - yMin0) * .22));
  const yMax = yMax0 + Math.max(2, (yMax0 - yMin0) * .22);
  const x = n => pad.l + (xMax === xMin ? .5 : (n - xMin) / (xMax - xMin)) * (width - pad.l - pad.r);
  const y = n => height - pad.b - (n - yMin) / (yMax - yMin) * (height - pad.t - pad.b);
  const yTicks = [0, 1, 2, 3].map(i => yMin + (yMax - yMin) * i / 3);
  const grid = yTicks.map(n => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(n)}" y2="${y(n)}" stroke="#edf1ed"/><text x="${pad.l - 9}" y="${y(n) + 4}" text-anchor="end" font-size="10" fill="#9ba8a2">${options.money ? fmtMoney(n) : Math.round(n)}</text>`).join('');
  const start = fmtTime(new Date(xMin).toISOString()), end = fmtTime(new Date(xMax).toISOString());
  const labels = `<text x="${pad.l}" y="${height - 5}" font-size="10" fill="#9ba8a2">${escapeHtml(start)}</text>${xMax > xMin ? `<text x="${width - pad.r}" y="${height - 5}" font-size="10" text-anchor="end" fill="#9ba8a2">${escapeHtml(end)}</text>` : ''}`;
  const lines = series.map(item => {
    const points = item.points.filter(point => Number.isFinite(point.y)).sort((a, b) => a.x - b.x);
    const color = item.color;
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(' ');
    const dots = points.map(point => `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="${points.length === 1 ? 4 : 3}" fill="${color}"><title>${escapeHtml(`${fmtTime(new Date(point.x).toISOString())}: ${options.money ? fmtMoney(point.y) : Math.round(point.y)}`)}</title></circle>`).join('');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || 'Time series graph')}" preserveAspectRatio="none">${grid}${lines}${labels}</svg>`;
}

function latestBuses(observations) {
  if (!observations.length) return [];
  const newest = observations[observations.length - 1].observed_at;
  return observations.filter(row => row.observed_at === newest).sort((a, b) => (a.fare_min ?? Infinity) - (b.fare_min ?? Infinity));
}

function render() {
  const { observations, runs } = state;
  const latest = latestBuses(observations);
  const prices = latest.map(row => row.fare_min).filter(Number.isFinite);
  $('stat-buses').textContent = String(latest.length);
  $('stat-low').textContent = prices.length ? fmtMoney(Math.min(...prices)) : '—';
  $('stat-median').textContent = fmtMoney(median(prices));
  $('stat-time').textContent = latest.length ? fmtTime(latest[0].observed_at) : '—';
  $('stat-captures').textContent = `${runs.filter(run => run.status === 'success').length} successful captures stored`;
  const last = runs[0];
  const sourceError = ['error', 'partial'].includes(state.sourceStatus?.status) ? state.sourceStatus : null;
  const status = $('status-message');
  status.classList.toggle('error', Boolean(sourceError));
  status.textContent = sourceError ? `${sourceError.status === 'partial' ? 'Partial capture' : 'Latest source request failed'} (${sourceError.route}, ${sourceError.travel_date}): ${sourceError.error}` : latest.length ? `${latest.length} buses in latest snapshot · ${runs.length} runs recorded` : 'No successful observations for this route and date yet.';
  $('collection-state').textContent = state.collecting ? '● Collecting' : sourceError ? sourceError.status === 'partial' ? '● Partial capture' : '● Source error' : latest.length ? '● Tracking' : '● Waiting for data';
  $('collection-state').classList.toggle('working', state.collecting || latest.length > 0);
  $('collect-button').disabled = Boolean(state.collecting);

  const grouped = new Map();
  for (const row of observations) {
    if (row.fare_min == null) continue;
    if (!grouped.has(row.observed_at)) grouped.set(row.observed_at, []);
    grouped.get(row.observed_at).push(row.fare_min);
  }
  const market = [...grouped].map(([time, fares]) => ({ x: Date.parse(time), min: Math.min(...fares), med: median(fares) }));
  $('market-chart').innerHTML = graph([
    { color: '#0d795e', points: market.map(point => ({ x: point.x, y: point.min })) },
    { color: '#e7aa53', points: market.map(point => ({ x: point.x, y: point.med })) },
  ], { money: true, label: 'Lowest and median fare over time' });

  if (!latest.some(row => row.service_key === state.selected)) state.selected = latest[0]?.service_key ?? null;
  const chosen = latest.find(row => row.service_key === state.selected);
  $('selected-title').textContent = chosen ? `${chosen.operator} · ${chosen.departure_time}` : 'Choose a bus';
  const history = observations.filter(row => row.service_key === state.selected);
  $('service-chart').innerHTML = graph([{ color: '#0d795e', points: history.map(row => ({ x: Date.parse(row.observed_at), y: row.fare_min })) }], { money: true, label: 'Selected service fare over time' });
  $('seat-chart').innerHTML = graph([{ color: '#e7aa53', points: history.map(row => ({ x: Date.parse(row.observed_at), y: row.seats_left })) }], { small: true, label: 'Selected service seats remaining over time' });

  const query = $('search').value.trim().toLowerCase();
  const filtered = latest.filter(row => `${row.operator} ${row.bus_type}`.toLowerCase().includes(query));
  $('listing-count').textContent = `${filtered.length} buses`;
  $('bus-rows').innerHTML = filtered.length ? filtered.map(row => `<tr data-key="${escapeHtml(row.service_key)}" class="${row.service_key === state.selected ? 'selected' : ''}">
    <td><div class="bus-name">${escapeHtml(row.operator)}</div><div class="bus-type">${escapeHtml(row.bus_type)}</div></td>
    <td>${escapeHtml(row.departure_time)}</td><td class="fare">${fmtMoney(row.fare_min)}${row.fare_max != null && row.fare_max > row.fare_min ? `<span class="seat-sub">to ${fmtMoney(row.fare_max)}</span>` : ''}</td>
    <td>${row.seats_left ?? '—'}<span class="seat-sub">${row.women_seats_left == null && row.men_seats_left == null ? 'Restrictions unavailable' : `Women: ${row.women_seats_left ?? '—'} · Men: ${row.men_seats_left ?? '—'}`}</span></td>
    <td>${escapeHtml(fmtTime(row.observed_at))}</td><td><a href="${escapeHtml(row.source_url)}" target="_blank" rel="noopener noreferrer">View ↗</a></td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty-row">No buses to show for this filter and date.</td></tr>';
  for (const row of $('bus-rows').querySelectorAll('tr[data-key]')) row.addEventListener('click', event => {
    if (event.target.closest('a')) return;
    state.selected = row.dataset.key;
    render();
  });
}

async function load() {
  const route = $('route').value, date = $('travel-date').value;
  if (!route || !date) return;
  const response = await fetch(`/api/data?route=${encodeURIComponent(route)}&date=${encodeURIComponent(date)}`);
  if (!response.ok) throw new Error(`Dashboard returned HTTP ${response.status}`);
  state = { ...state, ...await response.json() };
  $('export-link').href = `/api/export.csv?route=${encodeURIComponent(route)}&date=${encodeURIComponent(date)}`;
  render();
}

async function start() {
  const config = await (await fetch('/api/config')).json();
  $('route').innerHTML = config.routes.map(route => `<option value="${route.key}">${escapeHtml(route.label)}</option>`).join('');
  $('travel-date').value = config.tomorrow;
  $('route').addEventListener('change', load);
  $('travel-date').addEventListener('change', load);
  $('search').addEventListener('input', render);
  $('collect-button').addEventListener('click', async () => {
    const response = await fetch(`/api/collect?route=${encodeURIComponent($('route').value)}&date=${encodeURIComponent($('travel-date').value)}`, { method: 'POST' });
    if (!response.ok && response.status !== 409) alert('Could not start collection');
    await load();
  });
  await load();
  setInterval(() => load().catch(console.error), 15_000);
}

start().catch(error => { $('status-message').textContent = error.message; $('status-message').classList.add('error'); });
