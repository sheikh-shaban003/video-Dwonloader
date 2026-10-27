/*
 * Shared backend configuration.
 * Leave API_BASE empty for the recommended single-origin Docker deployment.
 * For a separate frontend/backend deployment, enter the backend origin in the
 * Video Downloader or AI Image Generator page. The choice is saved in this browser.
 */
(() => {
  'use strict';
  const STORAGE_KEY = 'shaban.backendApiBase.v1';
  const DEFAULT_API_BASE = String(window.SHABAN_CONFIG?.API_BASE || '').trim().replace(/\/+$/, '');

  function normalise(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error('Enter a complete backend URL, for example https://your-backend.example.com.'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Backend URL must start with https:// (or http:// for local testing).');
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Backend URL must be only the server origin, without a username, password, query, or hash.');
    if (parsed.pathname && parsed.pathname !== '/') throw new Error('Enter only the backend origin, without /api or any other path.');
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('Use HTTPS for a remote backend. HTTP is only supported for localhost testing.');
    }
    return parsed.origin.replace(/\/+$/, '');
  }

  function getApiBase() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return normalise(stored !== null ? stored : DEFAULT_API_BASE);
    } catch {
      return normalise(DEFAULT_API_BASE);
    }
  }

  function setApiBase(value) {
    const clean = normalise(value);
    try { localStorage.setItem(STORAGE_KEY, clean); }
    catch { throw new Error('This browser blocked local storage, so the backend URL could not be saved.'); }
    window.dispatchEvent(new CustomEvent('shaban:api-base-change', { detail: { apiBase: clean } }));
    return clean;
  }

  window.SHABAN_CONFIG = { API_BASE: DEFAULT_API_BASE, getApiBase, setApiBase };
})();
