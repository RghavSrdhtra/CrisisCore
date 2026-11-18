/**
 * CrisisCore Cross-Platform Network Configuration
 * Handles automatic gateway routing between Web (Vite dev server)
 * and Native Android (Capacitor WebView).
 */

export const DEFAULT_HOST_IP = '192.168.1.5';
export const DEFAULT_PORT = '3001';
export const DEFAULT_GATEWAY_URL = `http://${DEFAULT_HOST_IP}:${DEFAULT_PORT}`;

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
    // Default to the host PC LAN IP, which works across physical phones
    // and emulators on the same local Wi-Fi network
    return DEFAULT_GATEWAY_URL;
  }

  // If accessed from a mobile browser on LAN (e.g., http://192.168.1.5:5173/)
  if (window.location && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `http://${window.location.hostname}:${DEFAULT_PORT}`;
  }

  return '';
}

export function setApiGateway(url) {
  if (!url) {
    localStorage.removeItem('crisiscore_api_url');
  } else {
    localStorage.setItem('crisiscore_api_url', url.replace(/\/$/, ''));
  }
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
