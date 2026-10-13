/**
 * CrisisCore Cross-Platform Network Configuration
 * Handles automatic gateway routing between Web (Vite dev server)
 * and Native Android (Capacitor WebView).
 */

export function getApiBase() {
  if (typeof window === 'undefined') return '';
  const custom = localStorage.getItem('crisiscore_api_url');
  if (custom) return custom.replace(/\/$/, '');

  // Detect Android Capacitor WebView (hosted on http://localhost with no port, or capacitor://)
  const isCapacitor = Boolean(
    window.Capacitor !== undefined ||
    (window.location.hostname === 'localhost' && (!window.location.port || window.location.port === '80')) ||
    window.location.protocol === 'capacitor:'
  );

  if (isCapacitor) {
    // 10.0.2.2 is the Android Emulator alias for host PC localhost
    return 'http://10.0.2.2:3001';
  }
  return '';
}

export function apiUrl(path) {
  const base = getApiBase();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}

// Global fetch interceptor to automatically prefix /api requests in native Android WebView
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch;
  window.fetch = function (resource, init) {
    if (typeof resource === 'string' && resource.startsWith('/api')) {
      return originalFetch(apiUrl(resource), init);
    }
    return originalFetch(resource, init);
  };
}
