// Runs synchronously in <head> before the app bundle so the first paint already
// uses the stored theme. Kept as an external file so the Content-Security-Policy
// can forbid inline scripts (script-src 'self').
(function () {
  var root = document.documentElement;

  // The server injects the configured access path as a meta tag (no inline script).
  var baseMeta = document.querySelector('meta[name="nms-site-base-path"]');
  if (baseMeta && typeof window.__NMS_SITE_BASE_PATH__ !== 'string') {
    window.__NMS_SITE_BASE_PATH__ = baseMeta.getAttribute('content') || '/';
  }

  var stored = 'auto';
  try {
    var val = window.localStorage.getItem('nms_theme');
    if (val === 'light' || val === 'dark' || val === 'auto') stored = val;
  } catch {
    // storage unavailable (private mode, blocked site data)
  }
  var systemLight = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  var theme = stored === 'auto' ? (systemLight ? 'light' : 'dark') : stored;
  root.dataset.theme = theme;
  root.dataset.themeMode = stored;
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'light' ? '#f3f4f7' : '#0d1016';
})();
