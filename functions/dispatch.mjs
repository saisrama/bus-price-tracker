const WORKFLOW_URL = 'https://api.github.com/repos/saisrama/bus-price-tracker/actions/workflows/collect.yml/dispatches';

export function createHandler({ fetchImpl = fetch, getToken = () => process.env.GITHUB_DISPATCH_TOKEN } = {}) {
  return async function handler(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!request.headers.get('x-neon-trigger-invocation-id'))
      return new Response('Trigger required', { status: 403 });
    let event;
    try { event = await request.json(); }
    catch { return new Response('Invalid JSON', { status: 400 }); }
    if (event?.trigger?.type !== 'schedule' || !Number.isFinite(Date.parse(event?.data?.scheduled_at)))
      return new Response('Invalid schedule event', { status: 400 });

    const token = getToken();
    if (!token) {
      console.error('GITHUB_DISPATCH_TOKEN is missing');
      return Response.json({ ok: false, error: 'Dispatcher is not configured' }, { status: 503 });
    }
    try {
      const response = await fetchImpl(WORKFLOW_URL, {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'bus-price-tracker-scheduler',
        },
        body: JSON.stringify({ ref: 'main' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.error(`GitHub workflow dispatch returned HTTP ${response.status}`);
        return Response.json({ ok: false, error: `GitHub returned HTTP ${response.status}` }, { status: 502 });
      }
      console.log(`GitHub collector dispatched for ${event.data.scheduled_at}`);
      return Response.json({ ok: true, scheduled_at: event.data.scheduled_at });
    } catch (error) {
      console.error(`GitHub workflow dispatch failed: ${error.message}`);
      return Response.json({ ok: false, error: 'GitHub request failed' }, { status: 502 });
    }
  };
}

export default { fetch: createHandler() };
