(() => {
  "use strict";

  // ── Helpers ──────────────────────────────────────────────────────────

  function getShortcode() {
    const m = location.pathname.match(/\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function getStoryInfo() {
    const m = location.pathname.match(/\/stories\/([^/]+)\/(\d+)/);
    return m ? { username: m[1], storyId: m[2] } : null;
  }

  function getPageType() {
    const path = location.pathname;
    if (/\/stories\//.test(path)) return "story";
    if (/\/reel(s)?\//.test(path)) return "reel";
    if (/\/p\//.test(path)) return "post";
    return "unknown";
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  const FETCH_TIMEOUT_MS = 15000;

  function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );
  }

  const IG_APP_ID = "936619743392459";

  function igHeaders() {
    return {
      "X-IG-App-ID": IG_APP_ID,
      "X-CSRFToken": getCookie("csrftoken"),
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  function bestCandidate(candidates) {
    if (!candidates || !candidates.length) return null;
    return candidates.reduce((best, c) => {
      const area = (c.width || 0) * (c.height || 0);
      return area > ((best.width || 0) * (best.height || 0)) ? c : best;
    });
  }

  // ── REST API extraction (/p/{code}/?__a=1&__d=dis) ──────────────────

  async function extractViaREST(shortcode) {
    const resp = await fetchWithTimeout(
      `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
      { credentials: "include", headers: igHeaders() }
    );
    if (!resp.ok) return null;

    const json = await resp.json();
    const item = json?.items?.[0] || json?.graphql?.shortcode_media;
    if (!item) return null;

    console.log("[IG Downloader] REST API - media_type:", item.media_type,
      "carousel_media_count:", item.carousel_media_count,
      "carousel_media length:", item.carousel_media?.length,
      "edge_sidecar edges:", item.edge_sidecar_to_children?.edges?.length,
      "pk:", item.pk, "id:", item.id);

    // For carousel posts, ALWAYS use the media info endpoint
    // because the REST ?__a=1&__d=dis endpoint truncates carousel_media
    const isCarousel =
      item.media_type === 8 ||
      item.carousel_media_count > 0 ||
      (item.carousel_media && item.carousel_media.length > 1) ||
      (item.edge_sidecar_to_children?.edges && item.edge_sidecar_to_children.edges.length > 1);

    if (isCarousel) {
      const mediaId = item.pk || item.id;
      if (mediaId) {
        console.log("[IG Downloader] Carousel detected → trying Media Info API with id:", mediaId);
        const fullItems = await extractViaMediaInfo(mediaId);
        if (fullItems && fullItems.length) {
          console.log("[IG Downloader] Media Info API returned", fullItems.length, "items (full carousel)");
          return fullItems;
        }
      }
    }

    // Fallback: parse whatever the REST API gave us
    const results = parseMediaItem(item);
    console.log("[IG Downloader] REST fallback parseMediaItem returned", results.length, "items");
    return results;
  }

  // ── Media Info API (returns full carousel reliably) ────────────────

  async function extractViaMediaInfo(mediaId) {
    try {
      const resp = await fetchWithTimeout(
        `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
        { credentials: "include", headers: igHeaders() }
      );
      console.log("[IG Downloader] Media Info API status:", resp.status);
      if (!resp.ok) return null;

      const json = await resp.json();
      const item = json?.items?.[0];
      if (!item) return null;

      console.log("[IG Downloader] Media Info - carousel_media_count:", item.carousel_media_count,
        "carousel_media length:", item.carousel_media?.length);

      return parseMediaItem(item);
    } catch (e) {
      console.log("[IG Downloader] Media Info API failed:", e.message);
      return null;
    }
  }

  // ── Standalone Media Info via shortcode-to-id conversion ───────────
  // Instagram media IDs can be derived from shortcodes using base64 decoding

  function shortcodeToMediaId(shortcode) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = BigInt(0);
    for (const char of shortcode) {
      id = id * BigInt(64) + BigInt(alphabet.indexOf(char));
    }
    return id.toString();
  }

  async function extractViaMediaInfoFromShortcode(shortcode) {
    try {
      const mediaId = shortcodeToMediaId(shortcode);
      console.log("[IG Downloader] Converted shortcode", shortcode, "→ mediaId:", mediaId);
      return await extractViaMediaInfo(mediaId);
    } catch (e) {
      console.log("[IG Downloader] shortcode→mediaId extraction failed:", e.message);
      return null;
    }
  }

  function parseMediaItem(item) {
    const results = [];

    if (item.carousel_media) {
      for (const slide of item.carousel_media) {
        results.push(parseSingleMedia(slide));
      }
    } else if (item.edge_sidecar_to_children?.edges) {
      for (const edge of item.edge_sidecar_to_children.edges) {
        results.push(parseSingleMedia(edge.node));
      }
    } else {
      results.push(parseSingleMedia(item));
    }

    return results.filter(Boolean);
  }

  function parseSingleMedia(item) {
    const isVideo =
      item.media_type === 2 ||
      item.is_video === true ||
      !!item.video_url ||
      !!item.video_versions;

    let url, thumbnail;

    if (isVideo) {
      const best = bestCandidate(item.video_versions);
      url = best?.url || item.video_url;
      const imgBest = bestCandidate(
        item.image_versions2?.candidates || []
      );
      thumbnail = imgBest?.url || item.display_url || url;
    } else {
      const best = bestCandidate(
        item.image_versions2?.candidates || []
      );
      url = best?.url || item.display_url;
      thumbnail = url;
    }

    if (!url) return null;

    return {
      url,
      thumbnail: thumbnail || url,
      type: isVideo ? "video" : "image",
      width: item.original_width || item.dimensions?.width || 0,
      height: item.original_height || item.dimensions?.height || 0,
    };
  }

  // ── GraphQL API fallback ─────────────────────────────────────────────

  async function extractViaGraphQL(shortcode) {
    // Try multiple known doc_ids for resilience
    const docIds = [
      "8845758582119845",
      "9496329710372567",
      "7153639614738498",
    ];

    for (const docId of docIds) {
      try {
        const variables = JSON.stringify({
          shortcode,
          fetch_tagged_user_count: null,
          hoisted_comment_id: null,
          hoisted_reply_id: null,
        });

        const resp = await fetchWithTimeout("https://www.instagram.com/api/graphql", {
          method: "POST",
          credentials: "include",
          headers: {
            ...igHeaders(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            av: "17841400322010554",
            __d: "www",
            __user: "0",
            __a: "1",
            __req: "1",
            __hs: "20041.HYP:instagram_web_pkg.2.1...0",
            dpr: "1",
            __ccg: "UNKNOWN",
            __rev: "1018913498",
            __comet_req: "7",
            fb_dtsg: "",
            jazoest: "",
            lsd: "",
            __spin_r: "1018913498",
            __spin_b: "trunk",
            __spin_t: Math.floor(Date.now() / 1000).toString(),
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "PolarisPostActionLoadPostQueryQuery",
            variables,
            server_timestamps: "true",
            doc_id: docId,
          }),
        });

        if (!resp.ok) continue;

        const json = await resp.json();
        const media =
          json?.data?.xdt_shortcode_media || json?.data?.shortcode_media;
        if (!media) continue;

        const items = parseGraphQLMedia(media);
        if (items && items.length) return items;
      } catch (e) {
        console.log(`[IG Downloader] GraphQL doc_id ${docId} failed:`, e.message);
      }
    }

    return null;
  }

  function parseGraphQLMedia(media) {
    const results = [];

    if (media.edge_sidecar_to_children?.edges) {
      for (const edge of media.edge_sidecar_to_children.edges) {
        results.push(parseGraphQLNode(edge.node));
      }
    } else {
      results.push(parseGraphQLNode(media));
    }

    return results.filter(Boolean);
  }

  function parseGraphQLNode(node) {
    const isVideo = node.is_video || node.__typename === "GraphVideo" || node.__typename === "XDTGraphVideo";

    return {
      url: isVideo ? (node.video_url || node.display_url) : node.display_url,
      thumbnail: node.display_url || node.thumbnail_src,
      type: isVideo ? "video" : "image",
      width: node.dimensions?.width || 0,
      height: node.dimensions?.height || 0,
    };
  }

  // ── Embedded page data extraction ────────────────────────────────────

  function extractFromEmbeddedData() {
    try {
      // Try __additionalDataLoaded or similar embedded JSON in the page
      const scripts = document.querySelectorAll("script[type='application/json']");
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          const media = findMediaInObject(data);
          if (media) {
            const items = parseMediaItem(media);
            if (items && items.length) return items;
          }
        } catch (e) {
          // JSON parse failed for this script tag, skip it
        }
      }

      // Try window.__additionalData or _sharedData
      for (const key of ["__additionalDataLoaded", "__initialData"]) {
        if (window[key]) {
          const paths = Object.values(window[key]);
          for (const val of paths) {
            const media = findMediaInObject(val);
            if (media) {
              const items = parseMediaItem(media);
              if (items && items.length) return items;
            }
          }
        }
      }

      if (window._sharedData) {
        const media = findMediaInObject(window._sharedData);
        if (media) {
          const items = parseMediaItem(media);
          if (items && items.length) return items;
        }
      }
    } catch (e) {
      console.log("[IG Downloader] Embedded data extraction failed:", e.message);
    }

    return null;
  }

  function findMediaInObject(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 10) return null;

    // Look for objects that look like an IG media item with carousel data
    if (obj.carousel_media && Array.isArray(obj.carousel_media)) return obj;
    if (obj.edge_sidecar_to_children?.edges) return obj;

    // Look for shortcode_media
    if (obj.shortcode_media) return obj.shortcode_media;
    if (obj.xdt_shortcode_media) return obj.xdt_shortcode_media;

    // Recurse into object properties
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object") {
        const found = findMediaInObject(val, depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  // ── DOM scraping fallback ────────────────────────────────────────────

  function extractFromDOM() {
    const results = [];

    // Try to find the article element for the post
    const article = document.querySelector("article[role='presentation']") ||
                    document.querySelector("div[role='dialog'] article") ||
                    document.querySelector("main article");

    const scope = article || document;

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
        });
      }
    });

    // Images (from srcset for max quality)
    scope.querySelectorAll("img[srcset]").forEach((img) => {
      const srcset = img.srcset;
      if (!srcset || !srcset.includes("cdninstagram") && !srcset.includes("fbcdn")) return;

      // Parse srcset and pick highest resolution
      const candidates = srcset.split(",").map((entry) => {
        const parts = entry.trim().split(/\s+/);
        return { url: parts[0], w: parseInt(parts[1]) || 0 };
      });

      const best = candidates.reduce((a, b) => (b.w > a.w ? b : a));
      if (best.url) {
        results.push({
          url: best.url,
          thumbnail: img.src || best.url,
          type: "image",
          width: best.w || img.naturalWidth || 0,
          height: img.naturalHeight || 0,
        });
      }
    });

    // Fallback: large images without srcset
    if (results.length === 0) {
      scope.querySelectorAll("img").forEach((img) => {
        const src = img.src;
        if (src && (src.includes("cdninstagram") || src.includes("fbcdn")) && img.naturalWidth > 200) {
          results.push({
            url: src,
            thumbnail: src,
            type: "image",
            width: img.naturalWidth || 0,
            height: img.naturalHeight || 0,
          });
        }
      });
    }

    return results.length ? results : null;
  }

  // ── Story extraction ─────────────────────────────────────────────────

  async function extractStory(username, storyId) {
    // Step 1: Get user ID
    const profileResp = await fetchWithTimeout(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { credentials: "include", headers: igHeaders() }
    );
    if (!profileResp.ok) return null;

    const profileJson = await profileResp.json();
    const userId = profileJson?.data?.user?.id;
    if (!userId) return null;

    // Step 2: Get story reel
    const reelResp = await fetchWithTimeout(
      `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`,
      { credentials: "include", headers: igHeaders() }
    );
    if (!reelResp.ok) return null;

    const reelJson = await reelResp.json();
    const reels = reelJson?.reels_media || reelJson?.reels;
    if (!reels || !reels.length) {
      // Try alternative response shape
      const reelData = reelJson?.reels?.[userId];
      if (reelData?.items) {
        return parseStoryItems(reelData.items, storyId);
      }
      return null;
    }

    const items = reels[0]?.items || [];
    return parseStoryItems(items, storyId);
  }

  function parseStoryItems(items, targetStoryId) {
    const results = [];

    for (const item of items) {
      // If a specific story ID is given, we still return all items but mark the target
      const parsed = parseSingleMedia(item);
      if (parsed) {
        parsed.isTarget = String(item.pk) === targetStoryId || String(item.id)?.split("_")[0] === targetStoryId;
        results.push(parsed);
      }
    }

    // If we have a target, sort it first
    if (targetStoryId) {
      results.sort((a, b) => (b.isTarget ? 1 : 0) - (a.isTarget ? 1 : 0));
    }

    return results.length ? results : null;
  }

  // ── Main extraction logic ────────────────────────────────────────────

  async function extractMedia() {
    const pageType = getPageType();

    if (pageType === "story") {
      const info = getStoryInfo();
      if (!info) return { error: "Could not parse story URL", items: [] };

      const items = await extractStory(info.username, info.storyId);
      if (items) return { pageType, items };
      return { error: "Could not extract story media. Make sure you are logged in.", items: [] };
    }

    if (pageType === "post" || pageType === "reel") {
      const shortcode = getShortcode();
      if (!shortcode) return { error: "Could not find post shortcode", items: [] };

      // Strategy 1: Try direct Media Info API (shortcode → media ID conversion)
      // This is the most reliable for carousels - returns ALL items
      let items = null;
      try {
        items = await extractViaMediaInfoFromShortcode(shortcode);
        console.log("[IG Downloader] Direct Media Info result:", items?.length, "items");
      } catch (e) {
        console.log("[IG Downloader] Direct Media Info failed:", e.message);
      }

      if (items && items.length) return { pageType, items };

      // Strategy 2: REST API (with carousel fallback to Media Info via pk/id)
      try {
        items = await extractViaREST(shortcode);
        console.log("[IG Downloader] REST result:", items?.length, "items");
      } catch (e) {
        console.log("[IG Downloader] REST API failed:", e.message);
      }

      if (items && items.length) return { pageType, items };

      // Strategy 3: GraphQL API
      try {
        items = await extractViaGraphQL(shortcode);
        console.log("[IG Downloader] GraphQL result:", items?.length, "items");
      } catch (e) {
        console.log("[IG Downloader] GraphQL API failed:", e.message);
      }

      if (items && items.length) return { pageType, items };

      // Strategy 4: Embedded page data (JSON in script tags)
      try {
        items = extractFromEmbeddedData();
        console.log("[IG Downloader] Embedded data result:", items?.length, "items");
      } catch (e) {
        console.log("[IG Downloader] Embedded data extraction failed:", e.message);
      }

      if (items && items.length) return { pageType, items };

      // Strategy 5: DOM fallback
      items = extractFromDOM();
      console.log("[IG Downloader] DOM result:", items?.length, "items");
      if (items && items.length) return { pageType, items };

      return { error: "Could not extract media. The post may be private or the page hasn't fully loaded.", items: [] };
    }

    return { error: "Navigate to an Instagram post, reel, or story to extract media.", items: [] };
  }

  // ── Message listener ─────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "extractMedia") {
      extractMedia()
        .then(sendResponse)
        .catch((err) => {
          sendResponse({ error: err.message, items: [] });
        });
      return true; // async response
    }
  });
})();
