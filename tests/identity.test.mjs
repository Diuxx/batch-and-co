import test from 'node:test';
import assert from 'node:assert/strict';
import { IdentityApi, IdentityApiError } from '../src/assets/js/identity/api.mjs';
import { parseSession, safePicture, initialsFor } from '../src/assets/js/identity/profile.mjs';
import { planSync, syncIdentity } from '../src/assets/js/identity/sync.mjs';

const fakeStorage = () => {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
const snapshot = () => ({ schemaVersion: 3, budget: 42, plans: {}, ingredients: [], recipes: [], priceOverrides: {}, stock: {}, deletedSeedRecipeIds: [] });

test('auth URLs match Nicolabz Identity, including the unique app namespace', () => {
  const api = new IdentityApi({ baseUrl: 'https://auth.nicolabz.dev', appId: 'batch-and-co', fetchFunction: async () => ({ ok: true, json: async () => ({}) }) });
  const url = new URL(api.loginUrl('https://cooking.nicolabz.dev/?a=1'));
  assert.equal(url.pathname, '/auth/google/start');
  assert.equal(url.searchParams.get('app'), 'batch-and-co');
  assert.equal(url.searchParams.get('return_to'), 'https://cooking.nicolabz.dev/?a=1');
  assert.equal(new URL(api.driveConsentUrl('http://localhost:8080/')).pathname, '/auth/drive/start');
  assert.throws(() => new IdentityApi({ baseUrl: 'http://auth.nicolabz.dev', appId: 'batch-and-co' }));
});

test('HTTP client uses HttpOnly cookie credentials; PUT preserves CAS version', async () => {
  let actual;
  const api = new IdentityApi({ baseUrl: 'https://auth.nicolabz.dev', appId: 'batch-and-co', fetchFunction: async (url, init) => {
    actual = { path: url.pathname, ...init };
    return { ok: true, json: async () => ({ version: 2 }) };
  }});
  await api.write(1, snapshot());
  assert.equal(actual.path, '/api/sync/batch-and-co');
  assert.equal(actual.credentials, 'include');
  assert.deepEqual(JSON.parse(actual.body), { version: 1, data: snapshot() });
  assert.equal(actual.headers['Content-Type'], 'application/json');
});

test('server 409 is not swallowed', async () => {
  const api = new IdentityApi({ baseUrl: 'https://auth.nicolabz.dev', appId: 'batch-and-co', fetchFunction: async () => ({
    ok: false, status: 409, json: async () => ({ error: { code: 'SYNC_CONFLICT', message: 'Conflit' } })
  }) });
  await assert.rejects(api.write(1, {}), error => error instanceof IdentityApiError && error.code === 'SYNC_CONFLICT' && error.status === 409);
});

test('SQLite numeric user id and safe Google profile image', () => {
  const session = parseSession({ authenticated: true, driveConnected: true, user: { id: 7, name: 'Alex Martin', email: 'alex@example.org', picture: 'https://images.example.org/avatar.png' } });
  assert.equal(session.user.id, 7);
  assert.equal(initialsFor(session.user.name), 'AM');
  assert.equal(safePicture(session.user.picture), 'https://images.example.org/avatar.png');
  assert.equal(safePicture('javascript:alert(1)'), null);
  assert.equal(parseSession({ authenticated: true, user: { id: null } }).authenticated, false);
});

test('unlinked devices and two-way edits never overwrite automatically', () => {
  assert.equal(planSync({ anchor: null, localDigest: 'a', remoteDigest: 'b', remoteVersion: 1 }), 'conflict');
  assert.equal(planSync({ anchor: { version: 1, digest: 'a' }, localDigest: 'b', remoteDigest: 'c', remoteVersion: 2 }), 'conflict');
  assert.equal(planSync({ anchor: null, localDigest: 'a', remoteDigest: 'a', remoteVersion: 5 }), 'identical');
  assert.equal(planSync({ anchor: { version: 1, digest: 'a' }, localDigest: 'a', remoteDigest: 'b', remoteVersion: 2 }), 'remote');
  assert.equal(planSync({ anchor: { version: 1, digest: 'a' }, localDigest: 'b', remoteDigest: 'a', remoteVersion: 1 }), 'local');
});

test('empty cloud requires consent and creates backup with version zero', async () => {
  const local = snapshot();
  let written;
  const api = { appId: 'batch-and-co', read: async () => ({ version: 0, data: null }), write: async (v, data) => { written = { v, data }; return { version: 1 }; } };
  const result = await syncIdentity({ api, storage: fakeStorage(), userId: 12, getSnapshot: () => local, applySnapshot: () => { throw Error('must not pull'); }, choose: async () => 'local' });
  assert.equal(result, 'created');
  assert.deepEqual(written, { v: 0, data: local });
});

test('cancelled conflict leaves local and remote intact', async () => {
  let writes = 0, applies = 0;
  const api = { appId: 'batch-and-co', read: async () => ({ version: 3, data: { different: true } }), write: async () => { writes++; } };
  const result = await syncIdentity({ api, storage: fakeStorage(), userId: 12, getSnapshot: snapshot, applySnapshot: () => { applies++; }, choose: async () => 'cancel' });
  assert.equal(result, 'cancelled');
  assert.equal(writes, 0);
  assert.equal(applies, 0);
});

test('remote data is installed only with explicit choice on a new device', async () => {
  let local = snapshot();
  const newer = { ...snapshot(), budget: 30 };
  const api = { appId: 'batch-and-co', read: async () => ({ version: 5, data: newer }), write: async () => { throw Error('must not push'); } };
  const result = await syncIdentity({ api, storage: fakeStorage(), userId: 42,
    getSnapshot: () => local, applySnapshot: async incoming => { local = incoming; }, choose: async () => 'remote' });
  assert.equal(result, 'downloaded');
  assert.equal(local.budget, 30);
});

test('simultaneous local edits abort synchronization', async () => {
  let local = snapshot();
  const api = { appId: 'batch-and-co', read: async () => ({ version: 0, data: null }), write: async () => { throw Error('must not push'); } };
  await assert.rejects(syncIdentity({ api, storage: fakeStorage(), userId: 1,
    getSnapshot: () => local, applySnapshot: async () => {}, choose: async () => { local = { ...local, budget: 80 }; return 'local'; } }), /données locales ont changé/);
});
