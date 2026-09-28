export const TZ = 'Asia/Kolkata';
export const ROUTES = [
  { key: 'BLR-HYD', fromCity: 122, toCity: 124, label: 'Bengaluru → Hyderabad', slug: 'bangalore-to-hyderabad' },
  { key: 'HYD-BLR', fromCity: 124, toCity: 122, label: 'Hyderabad → Bengaluru', slug: 'hyderabad-to-bangalore' },
];

export function istDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function istHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date));
}

export function addDays(dateString, count) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

export function siteDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return `${String(day).padStart(2, '0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]}-${year}`;
}

export function hoursUntilDay(dateString, now = new Date()) {
  // Approximate interval selection for a route/date. The collector still discards departed buses.
  return (Date.parse(`${dateString}T00:00:00+05:30`) - now.getTime()) / 3_600_000;
}

export function intervalHours(dateString, now = new Date()) {
  const hours = hoursUntilDay(dateString, now);
  if (hours > 72) return 12;
  if (hours > 24) return 6;
  if (hours > 6) return 3;
  return 1;
}
