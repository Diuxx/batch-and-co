const ANCHOR_PREFIX = 'batch-and-co.identity.anchor.v1:';
const anchorKey = (appId, userId) => `${ANCHOR_PREFIX}${appId}:${userId}`;

export function getAnchor(storage, appId, userId) {
  if (userId === null || userId === undefined) return null;
  try {
    const saved = JSON.parse(storage.getItem(anchorKey(appId, userId)) || 'null');
    return Number.isSafeInteger(saved?.version) && saved.version >= 0 && typeof saved.digest === 'string'
      ? saved : null;
  } catch { return null; }
}

function saveAnchor(storage, appId, userId, version, digest) {
  storage.setItem(anchorKey(appId, userId), JSON.stringify({ version, digest, updatedAt: new Date().toISOString() }));
}

export async function digestSnapshot(snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

/** Identical snapshots have priority, even on a new device. Never auto-merge JSON. */
export function planSync({ anchor, localDigest, remoteDigest, remoteVersion }) {
  if (localDigest === remoteDigest) return 'identical';
  if (!anchor) return 'conflict';
  const localChanged = localDigest !== anchor.digest;
  const remoteChanged = remoteVersion !== anchor.version || remoteDigest !== anchor.digest;
  if (localChanged && remoteChanged) return 'conflict';
  if (remoteChanged) return 'remote';
  if (localChanged) return 'local';
  return 'conflict';
}

/**
 * CAS is enforced by the backend (409). A new device asks before choosing a side.
 * applySnapshot MUST validate and persist before we record a successful sync.
 */
export async function syncIdentity({ api, storage, userId, getSnapshot, applySnapshot, choose }) {
  if (userId === null || userId === undefined) throw new Error('Compte Google non connecté.');
  const local = structuredClone(getSnapshot());
  const localDigest = await digestSnapshot(local);
  const remote = await api.read();
  if (!Number.isSafeInteger(remote?.version) || remote.version < 0) throw new Error('Version Drive invalide.');

  if (remote.data === null) {
    if (remote.version !== 0) throw new Error('Réponse Drive incohérente.');
    if (await choose('empty') !== 'local') return 'cancelled';
    // A user edit while the dialog is open must not be silently lost.
    if (await digestSnapshot(getSnapshot()) !== localDigest) throw new Error('Les données locales ont changé : recommence la synchronisation.');
    const result = await api.write(0, local);
    saveAnchor(storage, api.appId, userId, result.version, localDigest);
    return 'created';
  }

  // Validate the cloud document before deciding whether it can replace the local data.
  // applySnapshot is intentionally called only after a positive user decision.
  const remoteDigest = await digestSnapshot(remote.data);
  const anchor = getAnchor(storage, api.appId, userId);
  let decision = planSync({ anchor, localDigest, remoteDigest, remoteVersion: remote.version });
  if (decision === 'conflict') decision = await choose('conflict');
  if (decision === 'cancel') return 'cancelled';
  if (decision === 'identical') {
    saveAnchor(storage, api.appId, userId, remote.version, remoteDigest);
    return 'identical';
  }
  if (await digestSnapshot(getSnapshot()) !== localDigest) throw new Error('Les données locales ont changé : recommence la synchronisation.');
  if (decision === 'remote') {
    await applySnapshot(remote.data);
    saveAnchor(storage, api.appId, userId, remote.version, remoteDigest);
    return 'downloaded';
  }
  if (decision === 'local') {
    const result = await api.write(remote.version, local);
    saveAnchor(storage, api.appId, userId, result.version, localDigest);
    return 'uploaded';
  }
  throw new Error('Choix de synchronisation inconnu.');
}
