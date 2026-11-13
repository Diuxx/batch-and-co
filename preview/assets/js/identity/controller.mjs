import { IDENTITY_APP_ID, IDENTITY_BASE_URL } from './config.mjs';
import { IdentityApi } from './api.mjs';
import { getAnchor, syncIdentity, digestSnapshot } from './sync.mjs';
import { parseSession, renderProfile } from './profile.mjs';

const byId = id => document.getElementById(id);
const notify = message => {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4800);
};

function returnToUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('auth');
  return url.href;
}

/** Explicit three-way choice, never fallback to overwriting Drive silently. */
function chooseSyncVersion(kind) {
  return new Promise(resolve => {
    const dialog = byId('identity-conflict-dialog');
    const message = byId('identity-conflict-message');
    message.textContent = kind === 'empty'
      ? 'Aucune sauvegarde Batch & Co sur ce Google Drive. Enregistrer le planning local ?'
      : 'Ton navigateur et Google Drive contiennent des données différentes. Quelle version conserver ?';
    byId('identity-pull').hidden = kind === 'empty';
    const abort = new AbortController();
    let completed = false;
    const finish = choice => {
      if (completed) return;
      completed = true;
      abort.abort();
      dialog.close();
      resolve(choice);
    };
    for (const choice of ['local', 'remote', 'cancel']) {
      byId(`identity-${choice === 'local' ? 'push' : choice === 'remote' ? 'pull' : 'cancel'}`)
        .addEventListener('click', () => finish(choice), { signal: abort.signal });
    }
    dialog.addEventListener('close', () => finish('cancel'), { signal: abort.signal });
    dialog.showModal();
  });
}

export function initIdentity({ getSnapshot, applySnapshot }) {
  const api = new IdentityApi({ baseUrl: IDENTITY_BASE_URL, appId: IDENTITY_APP_ID });
  let session = { authenticated: false, user: null, driveConnected: false };
  let checking = true;
  let error = null;
  let dirty = false;
  let busy = false;
  let pending = null;

  function update() { renderProfile(document, { session, checking, error, dirty, busy }); }

  function refresh() {
    if (pending) return pending;
    checking = true;
    update();
    pending = (async () => {
      try {
        const previousUser = session.user?.id;
        session = parseSession(await api.session());
        error = null;
        if (previousUser !== session.user?.id) dirty = false;
      } catch (cause) {
        error = cause.message;
        console.error('[Batch & Co] Session Nicolabz Identity :', cause);
      } finally {
        checking = false;
        pending = null;
        update();
      }
    })();
    return pending;
  }

  function redirect(route) { location.assign(route(returnToUrl())); }
  function login() { redirect(url => api.loginUrl(url)); }
  function consent() { redirect(url => api.driveConsentUrl(url)); }

  async function logout() {
    try {
      await api.logout();
      session = { authenticated: false, user: null, driveConnected: false };
      dirty = false;
      error = null;
      byId('profile-menu').open = false;
      update();
      notify('Déconnecté. Le planning local reste disponible.');
    } catch (cause) { notify(`Déconnexion impossible : ${cause.message}`); }
  }

  async function sync() {
    if (busy) return;
    if (!session.authenticated) { login(); return; }
    if (!session.driveConnected) { consent(); return; }
    busy = true;
    update();
    try {
      const result = await syncIdentity({
        api, storage: localStorage, userId: session.user.id,
        getSnapshot, applySnapshot, choose: chooseSyncVersion
      });
      if (result !== 'cancelled') dirty = false;
      const messages = {
        cancelled: 'Synchronisation annulée, aucune donnée remplacée.',
        identical: 'Le planning est déjà synchronisé.',
        created: 'Première sauvegarde créée sur Google Drive.',
        uploaded: 'Planning envoyé sur Google Drive.',
        downloaded: 'Planning Drive récupéré et enregistré localement.'
      };
      notify(messages[result]);
    } catch (cause) {
      if (cause.code === 'SYNC_CONFLICT') {
        notify('Conflit 409 : Drive a changé. Relance une synchronisation pour recharger les versions.');
      } else if (['DRIVE_NOT_CONNECTED', 'DRIVE_RECONNECT_REQUIRED'].includes(cause.code)) {
        void refresh();
        notify('Autorisation Drive à renouveler depuis le menu utilisateur.');
      } else {
        notify(`Synchronisation impossible : ${cause.message}`);
      }
    } finally {
      busy = false;
      update();
    }
  }

  function markLocalModified() { dirty = true; update(); }
  function onClick(id, action) { byId(id).addEventListener('click', action); }
  onClick('profile-login', login);
  onClick('profile-consent', consent);
  onClick('profile-sync', () => void sync());
  onClick('profile-refresh', () => void refresh());
  onClick('profile-logout', () => void logout());
  onClick('profile-export', () => byId('btn-export').click());
  onClick('profile-import', () => byId('btn-import').click());

  byId('profile-menu').addEventListener('toggle', () => {
    if (byId('profile-menu').open) void refresh();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
  window.addEventListener('focus', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  const callbackUrl = new URL(location.href);
  if (callbackUrl.searchParams.has('auth')) {
    callbackUrl.searchParams.delete('auth');
    history.replaceState(null, '', callbackUrl.pathname + callbackUrl.search + callbackUrl.hash);
  }
  void refresh();
  return { markLocalModified, refresh, sync };
}
