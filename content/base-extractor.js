// Shared utilities for media downloader strategies.
// Must be loaded before platform-specific strategy scripts in the same content_scripts group.

window.MediaDownloaderUtils = (() => {
  "use strict";

  const FETCH_TIMEOUT_MS = 15000;

  function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  // Picks the highest-resolution candidate by width × height.
  function bestCandidate(candidates) {
    if (!candidates || !candidates.length) return null;
    return candidates.reduce((best, c) => {
      const area = (c.width || 0) * (c.height || 0);
      return area > ((best.width || 0) * (best.height || 0)) ? c : best;
    });
  }

  return { FETCH_TIMEOUT_MS, fetchWithTimeout, getCookie, bestCandidate };
})();
