import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler } from '../functions/dispatch.mjs';

const payload = JSON.stringify({ trigger: { type: 'schedule' }, data: { scheduled_at: '2026-10-03T14:30:00Z' } });
const scheduledRequest = () => new Request('https://example.test/', {
  method: 'POST', headers: { 'x-neon-trigger-invocation-id': 'test' }, body: payload,
});

test('Neon dispatches the GitHub collector only for a valid schedule event', async () => {
  let calls = 0;
  const handler = createHandler({ getToken: () => 'test-token', fetchImpl: async (url, options) => {
    calls++;
    assert.match(url, /\/actions\/workflows\/collect\.yml\/dispatches$/);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options.body), { ref: 'main' });
    return new Response(null, { status: 204 });
  } });
  assert.equal((await handler(new Request('https://example.test/', { method: 'POST', body: payload }))).status, 403);
  const response = await handler(scheduledRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, scheduled_at: '2026-10-03T14:30:00Z' });
  assert.equal(calls, 1);
});

test('Neon dispatcher reports missing credentials and GitHub failures', async () => {
  assert.equal((await createHandler({ getToken: () => '' })(scheduledRequest())).status, 503);
  const handler = createHandler({ getToken: () => 'test-token', fetchImpl: async () => new Response(null, { status: 403 }) });
  assert.equal((await handler(scheduledRequest())).status, 502);
});
