/** HTTP contract shared with Budget (Marge): no Google SDK in the browser. */
export class IdentityApiError extends Error {
  constructor(message, code, status, options = {}) {
    super(message, options);
    this.name = 'IdentityApiError';
    this.code = code;
    this.status = status;
  }
}

export class IdentityApi {
  constructor({ baseUrl, appId, fetchFunction = fetch }) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && url.hostname !== 'localhost')) {
      throw new Error('Nicolabz Identity requiert HTTPS, sauf sur localhost.');
    }
    if (!/^[a-z0-9_-]{1,48}$/i.test(appId)) throw new Error('Identifiant d’application invalide.');
    this.baseUrl = url.origin;
    this.appId = appId;
    this.fetchFunction = fetchFunction.bind(globalThis);
  }

  redirect(path, returnTo) {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('app', this.appId);
    url.searchParams.set('return_to', returnTo);
    return url.href;
  }

  loginUrl(returnTo) { return this.redirect('/auth/google/start', returnTo); }
  driveConsentUrl(returnTo) { return this.redirect('/auth/drive/start', returnTo); }

  async request(path, options = {}) {
    let response;
    try {
      response = await this.fetchFunction(new URL(path, this.baseUrl), {
        ...options,
        credentials: 'include',
        cache: 'no-store',
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
      });
    } catch (cause) {
      throw new IdentityApiError('API d’authentification inaccessible. Vérifie son adresse et CORS.', 'NETWORK_ERROR', 0, { cause });
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new IdentityApiError('Réponse non JSON de Nicolabz Identity.', 'INVALID_RESPONSE', response.status); }
    if (!response.ok) {
      throw new IdentityApiError(payload?.error?.message || `Erreur HTTP ${response.status}`,
        payload?.error?.code || 'API_ERROR', response.status);
    }
    return payload;
  }

  session() { return this.request('/api/session'); }
  logout() { return this.request('/api/logout', { method: 'POST' }); }
  read() { return this.request(`/api/sync/${this.appId}`); }
  write(version, data) {
    return this.request(`/api/sync/${this.appId}`, { method: 'PUT', body: JSON.stringify({ version, data }) });
  }
}
