/** Profile presentation is independent from the HTTP client and meal planner. */
export function parseSession(payload) {
  const id = payload?.user?.id;
  const validId = (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    || (typeof id === 'string' && id.length > 0);
  if (payload?.authenticated !== true || !validId) {
    return { authenticated: false, driveConnected: false, user: null };
  }
  return {
    authenticated: true,
    driveConnected: payload.driveConnected === true,
    user: {
      id, name: typeof payload.user.name === 'string' ? payload.user.name : '',
      email: typeof payload.user.email === 'string' ? payload.user.email : '',
      picture: typeof payload.user.picture === 'string' ? payload.user.picture : ''
    }
  };
}

export function safePicture(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function initialsFor(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0]).join('').toLocaleUpperCase('fr') || '?';
}

export function renderProfile(root, { session, checking, error, dirty, busy }) {
  const byId = id => root.getElementById(id);
  const user = session.authenticated ? session.user : null;
  const connected = Boolean(user);
  const imageUrl = safePicture(user?.picture);
  const img = byId('profile-picture');
  const fallback = byId('profile-initials');
  img.hidden = !imageUrl;
  if (imageUrl) img.src = imageUrl;
  else img.removeAttribute('src');
  fallback.hidden = Boolean(imageUrl);
  fallback.textContent = initialsFor(user?.name || user?.email);
  byId('profile-trigger').setAttribute('aria-label', connected
    ? `Compte Google : ${user.name || user.email}` : 'Connexion Google et sauvegardes');
  byId('profile-name').textContent = user?.name || (checking ? 'Vérification…' : 'Non connecté');
  byId('profile-email').textContent = user?.email || (error || 'Connexion via Nicolabz Identity');
  byId('profile-drive').textContent = connected
    ? (session.driveConnected ? 'Drive autorisé · sauvegarde manuelle' : 'Drive non autorisé')
    : 'Données conservées dans ce navigateur';

  const status = checking && !connected ? 'Vérification…' : error ? 'Service indisponible'
    : !connected ? 'Mode local' : !session.driveConnected ? 'Google connecté'
      : busy ? 'Synchronisation…' : dirty ? 'À synchroniser' : 'Drive connecté';
  byId('identity-status').textContent = status;
  byId('identity-status').dataset.state = error ? 'error' : connected ? 'connected' : 'local';
  for (const [id, visible] of [
    ['profile-login', !connected], ['profile-consent', connected && !session.driveConnected],
    ['profile-sync', connected && session.driveConnected], ['profile-logout', connected]
  ]) byId(id).hidden = !visible;
  byId('profile-sync').disabled = busy;
}
