// X (Twitter) extractor strategy.
// Depends on base-extractor.js and feed-injector.js being loaded first.

(() => {
  "use strict";

  const { fetchWithTimeout, getCookie } = window.MediaDownloaderUtils;

  // ── Constants ─────────────────────────────────────────────────────────

  // Public bearer token embedded in the X web client JS bundle.
  const X_BEARER_TOKEN =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I5lnZgEaFkw%3DEUifiRBkKG5E2XYMLgORHKFedQzWzbiYLWBeT7ty2gDfa%2F5xAI";

  // Known TweetDetail queryIds — try multiple for resilience against API changes.
  const X_GRAPHQL_QUERY_IDS = [
    "zZXycP0V6H7-W6Qu5MNbg",
    "8jTynMG48pAMnkGmRyHjsA",
    "3XDB26fBve-MmjHaWTUZxA",
  ];

  // GraphQL features sent with TweetDetail requests.
  const X_GRAPHQL_FEATURES = JSON.stringify({
    rweb_lists_timeline_redesign_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_enhance_cards_enabled: false,
  });

  // ── Platform-specific selectors (easily identifiable constants) ────────

  const X_FEED_SELECTORS = {
    // Target tweet articles directly; the button is appended to the article container.
    postAnchor: 'article[data-testid="tweet"]',
  };

  // ── URL helpers ───────────────────────────────────────────────────────

  function getTweetId(url) {
    const m = (url || location.href).match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function detectXPageType() {
    return getTweetId(location.href) ? "tweet" : "unknown";
  }

  // ── X API headers ─────────────────────────────────────────────────────

  function xHeaders() {
    return {
      Authorization: `Bearer ${X_BEARER_TOKEN}`,
      "x-csrf-token": getCookie("ct0"),
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
    };
  }

  // ── Response parsers ──────────────────────────────────────────────────

  // Recursively finds tweet result objects that contain media (those with
  // a `legacy` field that has `extended_entities` or `entities` with media).
  function findTweetResults(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 20) return [];

    // A tweet result has `legacy` with media arrays.
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

  // Converts an X `created_at` string (e.g. "Mon Mar 04 18:15:05 +0000 2024")
  // to a Unix timestamp in seconds, matching the `taken_at` format used by IG.
  function xDateToTimestamp(createdAt) {
    if (!createdAt) return null;
    const ms = Date.parse(createdAt);
    return isNaN(ms) ? null : Math.floor(ms / 1000);
  }

  // Returns the MP4 URL with the highest bitrate from a variants array.
  function bestXVideoVariant(variants) {
    const mp4 = (variants || []).filter((v) => v.content_type === "video/mp4");
    if (!mp4.length) return null;
    return mp4.reduce((a, b) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a));
  }

  // Builds a max-quality image URL from a pbs.twimg.com media URL.
  function toMaxQualityImageUrl(mediaUrlHttps) {
    const base = (mediaUrlHttps || "").split("?")[0];
    return base + "?format=jpg&name=orig";
  }

  function parseTweetResult(result) {
    const legacy = result.legacy || {};
    const mediaArr =
      legacy.extended_entities?.media || legacy.entities?.media || [];

    if (!mediaArr.length) return [];

    const username =
      result.core?.user_results?.result?.legacy?.screen_name ||
      result.user?.screen_name ||
      null;
    const takenAt = xDateToTimestamp(legacy.created_at);

    return mediaArr
      .map((m) => {
        const isVideo = m.type === "video" || m.type === "animated_gif";
        let url, thumbnail;

        if (isVideo) {
          const best = bestXVideoVariant(m.video_info?.variants);
          if (!best) return null;
          url = best.url;
          thumbnail = m.media_url_https;
        } else {
          // Image — always request original quality.
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
  }

  // ── Syndication API parser ─────────────────────────────────────────────

  // The syndication endpoint returns a different shape from the GraphQL API:
  // top-level `mediaDetails` array instead of `extended_entities.media`.
  function parseSyndicationResult(json) {
    const mediaArr = json.mediaDetails || [];
    if (!mediaArr.length) return null;

    const username = json.user?.screen_name || null;
    const takenAt = xDateToTimestamp(json.created_at);

    const items = mediaArr
      .map((m) => {
        const isVideo = m.type === "video" || m.type === "animated_gif";
        let url, thumbnail;
        if (isVideo) {
          const best = bestXVideoVariant(m.video_info?.variants);
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

    return items.length ? items : null;
  }

  // ── Extraction layers ─────────────────────────────────────────────────

  // Reads media items cached by x-interceptor.js (MAIN world) via a shared DOM element.
  // The DOM is accessible from both worlds; JS namespaces are not.
  function extractViaCache(tweetId) {
    try {
      const el = document.getElementById("__xMediaCache");
      if (!el) return null;
      const cache = JSON.parse(el.textContent);
      const items = cache?.[tweetId];
      return Array.isArray(items) && items.length ? items : null;
    } catch (_) {
      return null;
    }
  }

  // Calls X's syndication (embed) endpoint via the background service worker.
  // The fetch must run in the service worker context to bypass CORS restrictions
  // (the syndication API only allows Access-Control-Allow-Origin: platform.twitter.com).
  async function extractViaSyndication(tweetId) {
    try {
      const result = await chrome.runtime.sendMessage({
        action: "fetchSyndication",
        tweetId,
      });
      if (!result?.ok) {
        console.log("[X Downloader] Syndication failed:", result?.error);
        return null;
      }
      const items = parseSyndicationResult(result.json);
      if (items) console.log("[X Downloader] Syndication extracted", items.length, "items");
      return items;
    } catch (e) {
      console.log("[X Downloader] Syndication failed:", e.message);
      return null;
    }
  }

  async function extractViaXGraphQL(tweetId) {
    for (const queryId of X_GRAPHQL_QUERY_IDS) {
      try {
        const variables = JSON.stringify({
          focalTweetId: tweetId,
          referrer: "tweet",
          count: 20,
          includePromotedContent: true,
          withCommunity: true,
          withQuickPromoteEligibilityTweetFields: true,
          withBirdwatchNotes: true,
          withVoice: true,
          withV2Timeline: true,
        });

        // Use the current hostname so the request is always same-origin
        // (x.com → x.com/i/api/..., twitter.com → twitter.com/i/api/...).
        const url =
          `https://${location.hostname}/i/api/graphql/${queryId}/TweetDetail` +
          `?variables=${encodeURIComponent(variables)}` +
          `&features=${encodeURIComponent(X_GRAPHQL_FEATURES)}`;

        const resp = await fetchWithTimeout(url, {
          credentials: "include",
          headers: xHeaders(),
        });

        if (!resp.ok) {
          console.log(`[X Downloader] GraphQL queryId ${queryId} HTTP ${resp.status}`);
          continue;
        }

        const json = await resp.json();
        const tweetResults = findTweetResults(json);

        if (!tweetResults.length) {
          console.log(`[X Downloader] GraphQL queryId ${queryId}: no tweet results found`);
          continue;
        }

        // The first result is the focal tweet.
        const items = parseTweetResult(tweetResults[0]);
        if (items.length) {
          console.log("[X Downloader] GraphQL extracted", items.length, "items");
          return items;
        }
      } catch (e) {
        console.log(`[X Downloader] GraphQL queryId ${queryId} failed:`, e.message);
      }
    }

    return null;
  }

  // scopeEl: optional element to search within (e.g. a specific article in the feed).
  // Falls back to the first tweet article on the page, then the whole document.
  function extractFromXDOM(scopeEl) {
    const results = [];

    const scope =
      scopeEl ||
      document.querySelector('article[data-testid="tweet"]') ||
      document;

    // Extract metadata from the tweet DOM so filenames are properly formatted.
    // Username: read from the status link href inside the scope.
    let username = null;
    const statusLink = scope.querySelector('a[href*="/status/"]');
    if (statusLink) {
      const m = new URL(statusLink.href).pathname.match(/^\/([^/]+)\/status\//);
      if (m) username = m[1];
    }
    // On tweet detail pages the URL itself contains the username as a fallback.
    if (!username) {
      const m = location.pathname.match(/^\/([^/]+)\/status\//);
      if (m) username = m[1];
    }

    // Timestamp: read from the <time datetime="..."> element inside the scope.
    let taken_at = null;
    const timeEl = scope.querySelector("time[datetime]");
    if (timeEl) {
      const ms = Date.parse(timeEl.getAttribute("datetime"));
      if (!isNaN(ms)) taken_at = Math.floor(ms / 1000);
    }

    // Videos
    scope.querySelectorAll("video").forEach((vid) => {
      const src = vid.src || vid.querySelector("source")?.src;
      if (src && src.startsWith("http")) {
        results.push({
          url: src,
          thumbnail: vid.poster || src,
          type: "video",
          width: vid.videoWidth || 0,
          height: vid.videoHeight || 0,
          username,
          taken_at,
          prefix: "x_",
        });
      }
    });

    // Images — upgrade to original quality.
    scope.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach((img) => {
      const url = toMaxQualityImageUrl(img.src);
      if (!results.some((r) => r.url === url)) {
        results.push({
          url,
          thumbnail: img.src,
          type: "image",
          width: img.naturalWidth || 0,
          height: img.naturalHeight || 0,
          username,
          taken_at,
          prefix: "x_",
        });
      }
    });

    return results.length ? results : null;
  }

  // ── XExtractorStrategy ────────────────────────────────────────────────

  class XExtractorStrategy {
    getFilePrefix() {
      return "x_";
    }

    getFeedSelectors() {
      return X_FEED_SELECTORS;
    }

    async extractMedia() {
      const tweetId = getTweetId(location.href);
      if (!tweetId) {
        return {
          error: "Navigate to an X post (tweet) to extract media.",
          items: [],
        };
      }

      let items = null;

      // Layer 1: interceptor cache (populated by x-interceptor.js from X's own requests).
      items = extractViaCache(tweetId);
      if (items && items.length) {
        console.log("[X Downloader] Cache hit:", items.length, "items");
        return { pageType: "tweet", items };
      }

      // Layer 2: Syndication API (public, no auth needed).
      items = await extractViaSyndication(tweetId);
      if (items && items.length) return { pageType: "tweet", items };

      // Layer 3: X internal GraphQL API.
      try {
        items = await extractViaXGraphQL(tweetId);
        console.log("[X Downloader] GraphQL result:", items?.length, "items");
      } catch (e) {
        console.log("[X Downloader] GraphQL extraction failed:", e.message);
      }

      if (items && items.length) return { pageType: "tweet", items };

      // Layer 4: DOM scraping fallback.
      items = extractFromXDOM();
      console.log("[X Downloader] DOM result:", items?.length, "items");
      if (items && items.length) return { pageType: "tweet", items };

      return {
        error:
          "Could not extract media. The tweet may have no media, be private, or the page hasn't fully loaded.",
        items: [],
      };
    }
  }

  // ── Message listener ──────────────────────────────────────────────────

  const strategy = new XExtractorStrategy();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "extractMedia") {
      strategy
        .extractMedia()
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message, items: [] }));
      return true; // async response
    }
  });

  // ── Feed injector ─────────────────────────────────────────────────────

  function buildXFeedFilename(item, idx, total) {
    const ext = item.type === "video" ? "mp4" : "jpg";
    const prefix = item.prefix || "x_";
    if (item.username && item.taken_at) {
      const d = new Date(item.taken_at * 1000);
      const date = d.toISOString().slice(0, 10);
      const suffix = total > 1 ? `_${idx + 1}` : "";
      return `${prefix}${item.username}_${date}_${item.taken_at}${suffix}.${ext}`;
    }
    return `${prefix}media_${idx + 1}.${ext}`;
  }

  // articleEl is the injected article element, used as scope for the DOM fallback.
  async function downloadFromTweetId(tweetId, btn, articleEl) {
    btn.textContent = "⏳";
    btn.disabled = true;

    try {
      // Check interceptor cache first (fastest, no auth needed).
      let items = extractViaCache(tweetId);

      // Syndication API (public, no auth needed).
      if (!items || !items.length) {
        items = await extractViaSyndication(tweetId);
      }

      // GraphQL API fallback.
      if (!items || !items.length) {
        items = await extractViaXGraphQL(tweetId);
      }

      // DOM fallback: scrape media from the specific article element.
      if (!items || !items.length) {
        items = articleEl ? extractFromXDOM(articleEl) : null;
      }

      if (!items || !items.length) {
        throw new Error("No media found");
      }

      if (items.length === 1) {
        const filename = buildXFeedFilename(items[0], 0, 1);
        chrome.runtime.sendMessage({ action: "downloadSingle", url: items[0].url, filename });
      } else {
        const zipItems = items.map((item, idx) => ({
          url: item.url,
          type: item.type,
          username: item.username,
          taken_at: item.taken_at,
          prefix: item.prefix,
          index: idx,
        }));
        chrome.runtime.sendMessage({ action: "downloadZip", items: zipItems });
      }

      btn.textContent = "✓";
    } catch (e) {
      console.log("[X Downloader] Feed injector download failed:", e.message);
      btn.textContent = "✗";
    } finally {
      btn.disabled = false;
      setTimeout(() => { btn.textContent = "⬇"; }, 2000);
    }
  }

  // Only run the feed injector on timeline/feed pages, not on tweet detail pages.
  if (detectXPageType() !== "tweet") {
    new window.FeedInjector({
      selectors: X_FEED_SELECTORS,
      // The timestamp anchor (<a> wrapping <time>) reliably identifies the tweet itself.
      extractPostId: (article) => {
        const hasMedia =
          article.querySelector('img[src*="pbs.twimg.com/media"]') ||
          article.querySelector("video") ||
          article.querySelector('[data-testid="videoComponent"]');
        if (!hasMedia) return null;
        const timeLink = article.querySelector('a[href*="/status/"] time');
        const anchor = timeLink?.closest("a");
        return getTweetId(anchor?.href);
      },
      onDownload: (tweetId, btn, articleEl) => downloadFromTweetId(tweetId, btn, articleEl),
    }).start();
  }
})();
