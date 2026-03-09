// Runs in the MAIN world at document_start, before X's own scripts execute.
// Intercepts X's internal API fetch responses and caches parsed media data
// in a hidden DOM element, which is shared between the MAIN world and the
// isolated content script world (x-strategy.js).
//
// Storage layout: <script id="__xMediaCache" type="application/json">
//   { "{tweetId}": [ ...items ] }
// </script>

(function () {
  "use strict";

  // ── Minimal media parsers (mirrored from x-strategy.js) ───────────────

  function toMaxQualityImageUrl(mediaUrlHttps) {
    const base = (mediaUrlHttps || "").split("?")[0];
    return base + "?format=jpg&name=orig";
  }

  function bestVideoVariant(variants) {
    const mp4 = (variants || []).filter((v) => v.content_type === "video/mp4");
    if (!mp4.length) return null;
    return mp4.reduce((a, b) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a));
  }

  function xDateToTimestamp(createdAt) {
    if (!createdAt) return null;
    const ms = Date.parse(createdAt);
    return isNaN(ms) ? null : Math.floor(ms / 1000);
  }

  function findTweetResults(obj, depth) {
    if (!obj || typeof obj !== "object" || depth > 20) return [];
    if (obj.legacy && (obj.legacy.extended_entities || obj.legacy.entities)) {
      return [obj];
    }
    const found = [];
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object") {
            found.push(...findTweetResults(item, depth + 1));
          }
        }
      } else if (val && typeof val === "object") {
        found.push(...findTweetResults(val, depth + 1));
      }
    }
    return found;
  }

  function parseTweetResult(result) {
    const legacy = result.legacy || {};
    const mediaArr =
      legacy.extended_entities?.media || legacy.entities?.media || [];
    if (!mediaArr.length) return null;

    const tweetId = legacy.id_str || result.rest_id;
    if (!tweetId) return null;

    const username =
      result.core?.user_results?.result?.legacy?.screen_name || null;
    const takenAt = xDateToTimestamp(legacy.created_at);

    const items = mediaArr
      .map((m) => {
        const isVideo = m.type === "video" || m.type === "animated_gif";
        let url, thumbnail;
        if (isVideo) {
          const best = bestVideoVariant(m.video_info?.variants);
          if (!best) return null;
          url = best.url;
          thumbnail = m.media_url_https;
        } else {
          url = toMaxQualityImageUrl(m.media_url_https);
          thumbnail = m.media_url_https + "?format=jpg&name=small";
        }
        if (!url) return null;
        return {
          url,
          thumbnail: thumbnail || url,
          type: isVideo ? "video" : "image",
          width: m.original_info?.width || 0,
          height: m.original_info?.height || 0,
          username,
          taken_at: takenAt,
          prefix: "x_",
        };
      })
      .filter(Boolean);

    return items.length ? { tweetId, items } : null;
  }

  // ── DOM cache (shared with isolated content script world) ─────────────

  const CACHE_EL_ID = "__xMediaCache";

  function readCache() {
    const el = document.getElementById(CACHE_EL_ID);
    if (!el) return {};
    try { return JSON.parse(el.textContent) || {}; } catch (_) { return {}; }
  }

  function writeCache(data) {
    let el = document.getElementById(CACHE_EL_ID);
    if (!el) {
      el = document.createElement("script");
      el.id = CACHE_EL_ID;
      el.type = "application/json";
      // Append as early as possible; documentElement is always available.
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  // ── Process an intercepted API response ───────────────────────────────

  function processApiResponse(json) {
    try {
      const tweetResults = findTweetResults(json, 0);
      let updated = false;
      const cache = readCache();
      for (const result of tweetResults) {
        const parsed = parseTweetResult(result);
        if (!parsed) continue;
        cache[parsed.tweetId] = parsed.items;
        updated = true;
      }
      if (updated) writeCache(cache);
    } catch (_) {}
  }

  // ── Intercept fetch ───────────────────────────────────────────────────

  const _origFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const response = await _origFetch(input, init);

    // Intercept any X GraphQL response that may contain tweet media data.
    if (
      url.includes("TweetDetail") ||
      url.includes("HomeTimeline") ||
      url.includes("HomeLatestTimeline") ||
      url.includes("TweetResultByRestId") ||
      url.includes("UserTweets") ||
      url.includes("SearchTimeline")
    ) {
      try {
        response.clone().json().then(processApiResponse).catch(() => {});
      } catch (_) {}
    }

    return response;
  };
})();
