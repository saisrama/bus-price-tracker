import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { siteDate } from './config.mjs';
import { beginRun, finishRun, saveObservations } from './db.mjs';

const SOURCE = 'https://www.redbus.in';
const PAGE_SIZE = 50;
const MAX_PAGES = 25;
const execFileAsync = promisify(execFile);

export function isTargetBus(busType) {
  return /\b(?:volvo|scania)\b/i.test(String(busType ?? ''));
}

function readNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(record, keys) {
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function firstText(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function walk(value, visit, depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
    return;
  }
  visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (!['tracking', 'filterData', 'filters', 'seo'].includes(key)) walk(child, visit, depth + 1);
  }
}

export function extractBuses(payload) {
  const found = [];
  const seen = new Set();
  walk(payload, item => {
    const busType = firstText(item, ['busType', 'bus_type', 'busName', 'vehicleType']);
    const operator = firstText(item, ['travelsName', 'operatorName', 'operator', 'travels']);
    const departure = firstText(item, ['departureTime', 'departure', 'depTime', 'startTime']);
    if (!busType || !operator || !departure) return;
    const key = `${operator}|${busType}|${departure}|${firstText(item, ['routeId', 'routeID', 'id']) ?? ''}`;
    if (!seen.has(key)) { seen.add(key); found.push(item); }
  });
  return found;
}

export function normalizeBus(item, route, travelDate) {
  const busType = firstText(item, ['busType', 'bus_type', 'busName', 'vehicleType']);
  if (!isTargetBus(busType)) return null;
  const operator = firstText(item, ['travelsName', 'operatorName', 'operator', 'travels']);
  const rawDeparture = firstText(item, ['departureTime', 'departure', 'depTime', 'startTime']);
  const departureTime = /^\d{4}-\d{2}-\d{2} /.test(rawDeparture ?? '') ? rawDeparture.slice(11, 16) : rawDeparture;
  if (!operator || !departureTime) return null;
  const sourceId = firstText(item, ['routeId', 'routeID', 'inventoryId', 'id']);
  const fares = Array.isArray(item.fareList) ? item.fareList.map(readNumber).filter(value => value !== null) : [];
  const price = fares.length ? Math.min(...fares) : firstNumber(item, ['fare', 'finalFare', 'ticketPrice', 'price', 'minFare', 'lowestFare', 'displayFare']);
  const maxPrice = fares.length ? Math.max(...fares) : firstNumber(item, ['maxFare', 'highestFare']);
  const stable = [route.key, travelDate, sourceId ?? '', operator.toLowerCase(), departureTime].join('|');
  const serviceKey = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 24);
  return {
    route: route.key,
    travelDate,
    serviceKey,
    sourceId,
    operator,
    busType,
    departureTime,
    arrivalTime: firstText(item, ['arrivalTime', 'arrival', 'arrTime', 'endTime'])?.replace(/^\d{4}-\d{2}-\d{2} /, '').slice(0, 5) ?? null,
    fareMin: price,
    fareMax: maxPrice,
    seatsLeft: firstNumber(item, ['availableSeats', 'seatsAvailable', 'availableSeatCount', 'seatCount', 'seatsLeft']),
    womenSeatsLeft: firstNumber(item, ['availableWomenSeats', 'womenSeatsAvailable', 'ladiesSeatsAvailable']),
    menSeatsLeft: firstNumber(item, ['availableMenSeats', 'menSeatsAvailable', 'maleSeatsAvailable']),
    sourceUrl: `${SOURCE}/bus-tickets/${route.slug}?onward=${siteDate(travelDate)}`,
    raw: item,
  };
}

export function totalCount(payload) {
  let count = null;
  walk(payload, item => {
    for (const key of ['totalBusCount', 'totalCount', 'totalResults']) {
      const candidate = readNumber(item[key]);
      if (candidate !== null) count = Math.max(count ?? 0, candidate);
    }
  });
  return count;
}

export function searchGroups(payload) {
  const sections = payload?.data?.metaData?.sections ?? [];
  return sections.flatMap(section => (section.groups ?? []).map(group => ({
    groupId: group.operatorId,
    sectionId: section.sectionId ?? 0,
    count: group.count ?? null,
    label: group.displayName ?? String(group.operatorId),
  }))).filter(group => Number.isFinite(Number(group.groupId)));
}

function privateCount(payload) {
  const sections = payload?.data?.metaData?.sections ?? [];
  const counts = sections.map(section => readNumber(section.privateCount)).filter(value => value !== null);
  return counts.length ? counts.reduce((sum, value) => sum + value, 0) : null;
}

function searchUrl(route, travelDate, offset, groupId = 0, sectionId = 0) {
  const url = new URL('/rpw/api/searchResults', SOURCE);
  for (const [key, value] of Object.entries({
    fromCity: route.fromCity, toCity: route.toCity, DOJ: siteDate(travelDate),
    limit: PAGE_SIZE, offset, meta: offset === 0 && !groupId, groupId, sectionId,
    sort: 0, sortOrder: 0, bT: 1,
  })) url.searchParams.set(key, String(value));
  return url;
}

export async function fetchPage(route, travelDate, offset, fetchImpl, groupId = 0, sectionId = 0) {
  const url = searchUrl(route, travelDate, offset, groupId, sectionId);
  const body = JSON.stringify(groupId ? { travelsList: [groupId] } : {});
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    referer: `${SOURCE}/bus-tickets/${route.slug}?onward=${siteDate(travelDate)}`,
  };
  if (!fetchImpl) {
    const args = ['--silent', '--show-error', '--fail-with-body', '--compressed', '--max-time', '20',
      '--request', 'POST', '--header', 'content-type: application/json', '--header', 'accept: application/json',
      '--header', `referer: ${headers.referer}`, '--data', body, url.toString()];
    const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
    let stdout;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ({ stdout } = await execFileAsync(command, args, { maxBuffer: 12 * 1024 * 1024, timeout: 25_000 }));
        break;
      } catch (error) {
        const code = error.code ?? 'unknown';
        const retryable = ['ETIMEDOUT', 'ECONNRESET'].includes(String(code)) || [6, 7, 28, 35, 52, 56].includes(Number(code));
        if (attempt < 2 && retryable) {
          await pause(3000 * (attempt + 1));
          continue;
        }
        throw new Error(`Source transport failed (curl ${code}): ${String(error.stderr || (code === 'ETIMEDOUT' ? 'timed out' : '')).trim().slice(0, 200)}`);
      }
    }
    try { return JSON.parse(stdout); }
    catch { throw new Error('Source returned non-JSON response'); }
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error(`Expected JSON; source returned ${type || 'unknown content type'}`);
  return response.json();
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function collectRouteDate(db, route, travelDate, options = {}) {
  const runId = beginRun(db, route.key, travelDate);
  const results = new Map();
  try {
    let fetched = 0;
    const initial = await fetchPage(route, travelDate, 0, options.fetchImpl);
    const groups = searchGroups(initial);
    async function pageThrough(groupId, sectionId, expected, firstPayload = null) {
      let offset = 0;
      let groupFetched = 0;
      const seenPages = new Set();
      for (let page = 0; page < MAX_PAGES; page++) {
        const payload = page === 0 && firstPayload ? firstPayload : await fetchPage(route, travelDate, offset, options.fetchImpl, groupId, sectionId);
        const buses = extractBuses(payload);
        const fingerprint = buses.map(bus => `${bus.routeId ?? ''}:${bus.departureTime ?? ''}`).join('|');
        if (buses.length && seenPages.has(fingerprint)) throw new Error(`Source repeated a result page at offset ${offset}`);
        seenPages.add(fingerprint);
        if (page === 0 && buses.length === 0 && !groupId) throw new Error('Source response contained no recognizable bus listings');
        groupFetched += buses.length;
        fetched += buses.length;
        for (const bus of buses) {
          const normalized = normalizeBus(bus, route, travelDate);
          if (normalized) results.set(normalized.serviceKey, normalized);
        }
        if (buses.length === 0 || (expected !== null && groupFetched >= expected)) break;
        offset += buses.length;
        if (page === MAX_PAGES - 1) throw new Error(`Pagination exceeded ${MAX_PAGES} pages`);
        await pause(options.pageDelayMs ?? 2000);
      }
    }
    await pageThrough(0, 0, privateCount(initial) ?? totalCount(initial), initial);
    for (const group of groups) {
      await pause(options.pageDelayMs ?? 2000);
      await pageThrough(group.groupId, group.sectionId, readNumber(group.count));
    }
    saveObservations(db, runId, [...results.values()]);
    finishRun(db, runId, 'success', results.size);
    return { runId, status: 'success', count: results.size, totalListings: fetched };
  } catch (error) {
    if (results.size) {
      saveObservations(db, runId, [...results.values()]);
      finishRun(db, runId, 'partial', results.size, error.message);
      return { runId, status: 'partial', count: results.size, error: error.message };
    }
    finishRun(db, runId, 'error', 0, error.message);
    return { runId, status: 'error', error: error.message };
  }
}
