import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { pingDatabase, pool } from '../config/db.js';
import { env } from '../config/env.js';

async function listen() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function login(base, email) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: env.seedPassword })
  });
  const json = await response.json();
  return { status: response.status, token: json.data?.accessToken, body: json };
}

test('tenant isolation, realm separation, and lead scope', async (t) => {
  try {
    await pingDatabase();
  } catch {
    await pool.end();
    t.skip('MySQL is not reachable. Set .env and run npm run setup.');
    return;
  }
  const { server, base } = await listen();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  const rahul = await login(base, 'rahul.sharma@prestigehomes.in');
  const vikram = await login(base, 'vikram.singh@aureliaestates.in');
  const kabir = await login(base, 'kabir.malhotra@prestigehomes.in');
  const ananya = await login(base, 'ananya.gupta@prestigehomes.in');
  const arjun = await login(base, 'arjun.mehta@airo.internal');
  assert.equal(rahul.status, 200);
  assert.equal(vikram.status, 200);
  assert.equal(arjun.status, 200);

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const rahulLeads = await fetch(`${base}/api/leads?pageSize=50`, { headers: auth(rahul.token) }).then((r) => r.json());
  const vikramLeads = await fetch(`${base}/api/leads?pageSize=50`, { headers: auth(vikram.token) }).then((r) => r.json());
  const kabirLeads = await fetch(`${base}/api/leads?pageSize=50`, { headers: auth(kabir.token) }).then((r) => r.json());
  const rahulIds = new Set(rahulLeads.data.items.map((item) => item.id));
  const vikramIds = vikramLeads.data.items.map((item) => item.id);
  assert.ok(rahulIds.size > kabirLeads.data.items.length);
  assert.ok(vikramIds.length > 0);
  assert.ok(vikramIds.every((id) => !rahulIds.has(id)));
  assert.ok(kabirLeads.data.items.every((item) => item.assigneeName === 'Kabir Malhotra'));

  const crossed = await fetch(`${base}/api/leads/${vikramIds[0]}`, { headers: auth(rahul.token) });
  assert.equal(crossed.status, 404);

  const clientOnPlatform = await fetch(`${base}/api/admin/organizations`, { headers: auth(rahul.token) });
  assert.equal(clientOnPlatform.status, 403);
  const platformOnClient = await fetch(`${base}/api/command`, { headers: auth(arjun.token) });
  assert.equal(platformOnClient.status, 403);
  const platformOrgs = await fetch(`${base}/api/admin/organizations`, { headers: auth(arjun.token) });
  assert.equal(platformOrgs.status, 200);

  const viewerWrite = await fetch(`${base}/api/leads`, {
    method: 'POST',
    headers: { ...auth(ananya.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Should Fail', phone: '9810000000', project: 'Sector 62' })
  });
  assert.equal(viewerWrite.status, 403);
});
