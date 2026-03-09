// Instagram extractor strategy.
// Depends on base-extractor.js and feed-injector.js being loaded first.

(() => {
  "use strict";

  const { fetchWithTimeout, getCookie, bestCandidate } = window.MediaDownloaderUtils;

  // ── Platform-specific selectors (easily identifiable constants) ────────

  const IG_FEED_SELECTORS = {
    postAnchor: 'a[href*="/p/"], a[href*="/reel/"]',
  };

  // ── IG API helpers ────────────────────────────────────────────────────

  const IG_APP_ID = "936619743392459";

  function igHeaders() {
    return {
      "X-IG-App-ID": IG_APP_ID,
      "X-CSRFToken": getCookie("csrftoken"),
      "X-Requested-With": "XMLHttpRequest",
    };
  }

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

  // ── Media parsers ─────────────────────────────────────────────────────

  function parseMediaItem(item) {
    const results = [];
    const meta = {
      username: item.user?.username || item.owner?.username || null,
      taken_at: item.taken_at || null,
    };

    if (item.carousel_media) {
      for (const slide of item.carousel_media) {
        results.push(parseSingleMedia(slide, meta));
      }
    } else if (item.edge_sidecar_to_children?.edges) {
      for (const edge of item.edge_sidecar_to_children.edges) {
        results.push(parseSingleMedia(edge.node, meta));
      }
    } else {
      results.push(parseSingleMedia(item, meta));
    }

    return results.filter(Boolean);
  }

  function parseSingleMedia(item, meta = {}) {
    const isVideo =
      item.media_type === 2 ||
      item.is_video === true ||
      !!item.video_url ||
      !!item.video_versions;

    let url, thumbnail;

    if (isVideo) {
      const best = bestCandidate(item.video_versions);
      url = best?.url || item.video_url;
      const imgBest = bestCandidate(item.image_versions2?.candidates || []);
      thumbnail = imgBest?.url || item.display_url || url;
    } else {
      const best = bestCandidate(item.image_versions2?.candidates || []);
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
      username: meta.username || item.user?.username || null,
      taken_at: meta.taken_at || item.taken_at || null,
      prefix: "ig_",
    };
  }

  function parseGraphQLMedia(media) {
    const results = [];
    const meta = {
      username: media.owner?.username || null,
      taken_at: media.taken_at_timestamp || null,
    };

    if (media.edge_sidecar_to_children?.edges) {
      for (const edge of media.edge_sidecar_to_children.edges) {
        results.push(parseGraphQLNode(edge.node, meta));
      }
    } else {
      results.push(parseGraphQLNode(media, meta));
    }

    return results.filter(Boolean);
  }

  function parseGraphQLNode(node, meta = {}) {
    const isVideo =
      node.is_video ||
      node.__typename === "GraphVideo" ||
      node.__typename === "XDTGraphVideo";

    return {
      url: isVideo ? (node.video_url || node.display_url) : node.display_url,
      thumbnail: node.display_url || node.thumbnail_src,
      type: isVideo ? "video" : "image",
      width: node.dimensions?.width || 0,
      height: node.dimensions?.height || 0,
      username: meta.username || node.owner?.username || null,
      taken_at: meta.taken_at || node.taken_at_timestamp || null,
      prefix: "ig_",
    };
  }

  // ── Extraction layers ─────────────────────────────────────────────────

  function shortcodeToMediaId(shortcode) {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = BigInt(0);
    for (const char of shortcode) {
      id = id * BigInt(64) + BigInt(alphabet.indexOf(char));
    }
    return id.toString();
  }

  async function extractViaMediaInfo(mediaId) {
    try {
      const resp = await fetchWithTimeout(
        `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
        { credentials: "include", headers: igHeaders() }
      );
      if (!resp.ok) return null;
      const json = await resp.json();
      const item = json?.items?.[0];
      if (!item) return null;
      return parseMediaItem(item);
    } catch (e) {
      console.log("[IG Downloader] Media Info API failed:", e.message);
      return null;
    }
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

  async function extractViaREST(shortcode) {
    const resp = await fetchWithTimeout(
      `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
      { credentials: "include", headers: igHeaders() }
    );
    if (!resp.ok) return null;

    const json = await resp.json();
    const item = json?.items?.[0] || json?.graphql?.shortcode_media;
    if (!item) return null;

    console.log(
      "[IG Downloader] REST API - media_type:", item.media_type,
      "carousel_media_count:", item.carousel_media_count,
      "pk:", item.pk
    );

    const isCarousel =
      item.media_type === 8 ||
      item.carousel_media_count > 0 ||
      (item.carousel_media && item.carousel_media.length > 1) ||
      (item.edge_sidecar_to_children?.edges &&
        item.edge_sidecar_to_children.edges.length > 1);

    if (isCarousel) {
      const mediaId = item.pk || item.id;
      if (mediaId) {
        console.log("[IG Downloader] Carousel detected → trying Media Info API with id:", mediaId);
        const fullItems = await extractViaMediaInfo(mediaId);
        if (fullItems && fullItems.length) return fullItems;
      }
    }

    const results = parseMediaItem(item);
    console.log("[IG Downloader] REST fallback parseMediaItem returned", results.length, "items");
    return results;
  }

  async function extractViaGraphQL(shortcode) {
    // Try multiple known doc_ids for resilience against API changes.
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

  function extractFromEmbeddedData() {
    try {
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
          // Skip unparseable script tags.
        }
      }

      for (const key of ["__additionalDataLoaded", "__initialData"]) {
        if (window[key]) {
          for (const val of Object.values(window[key])) {
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

    if (obj.carousel_media && Array.isArray(obj.carousel_media)) return obj;
    if (obj.edge_sidecar_to_children?.edges) return obj;
    if (obj.shortcode_media) return obj.shortcode_media;
    if (obj.xdt_shortcode_media) return obj.xdt_shortcode_media;

    for (const val of Object.values(obj)) {
      if (val && typeof val === "object") {
        const found = findMediaInObject(val, depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  function extractFromDOM() {
    const results = [];

    const article =
      document.querySelector("article[role='presentation']") ||
      document.querySelector("div[role='dialog'] article") ||
      document.querySelector("main article");

    const scope = article || document;

    scope.querySelectorAll("video").forEach((vid) => {
      const src = vid.src || vid.querySelector("source")?.src;
      if (src && src.startsWith("http")) {
        results.push({
          url: src,
          thumbnail: vid.poster || src,
          type: "video",
          width: vid.videoWidth || 0,
          height: vid.videoHeight || 0,
          prefix: "ig_",
        });
      }
    });

    scope.querySelectorAll("img[srcset]").forEach((img) => {
      const srcset = img.srcset;
      if (!srcset || (!srcset.includes("cdninstagram") && !srcset.includes("fbcdn"))) return;

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
          prefix: "ig_",
        });
      }
    });

    if (results.length === 0) {
      scope.querySelectorAll("img").forEach((img) => {
        const src = img.src;
        if (
          src &&
          (src.includes("cdninstagram") || src.includes("fbcdn")) &&
          img.naturalWidth > 200
        ) {
          results.push({
            url: src,
            thumbnail: src,
            type: "image",
            width: img.naturalWidth || 0,
            height: img.naturalHeight || 0,
            prefix: "ig_",
          });
        }
      });
    }

    return results.length ? results : null;
  }

  // ── Story extraction ──────────────────────────────────────────────────

  async function extractStory(username, storyId) {
    const profileResp = await fetchWithTimeout(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { credentials: "include", headers: igHeaders() }
    );
    if (!profileResp.ok) return null;

    const profileJson = await profileResp.json();
    const userId = profileJson?.data?.user?.id;
    if (!userId) return null;

    const reelResp = await fetchWithTimeout(
      `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`,
      { credentials: "include", headers: igHeaders() }
    );
    if (!reelResp.ok) return null;

    const reelJson = await reelResp.json();
    const reels = reelJson?.reels_media || reelJson?.reels;
    if (!reels || !reels.length) {
      const reelData = reelJson?.reels?.[userId];
      if (reelData?.items) {
        return parseStoryItems(reelData.items, storyId, username);
      }
      return null;
    }

    const items = reels[0]?.items || [];
    return parseStoryItems(items, storyId, username);
  }

  function parseStoryItems(items, targetStoryId, username) {
    const results = [];

    for (const item of items) {
      const parsed = parseSingleMedia(item, { username });
      if (parsed) {
        parsed.isTarget =
          String(item.pk) === targetStoryId ||
          String(item.id)?.split("_")[0] === targetStoryId;
        results.push(parsed);
      }
    }

    if (targetStoryId) {
      results.sort((a, b) => (b.isTarget ? 1 : 0) - (a.isTarget ? 1 : 0));
    }

    return results.length ? results : null;
  }

  // ── IGExtractorStrategy ───────────────────────────────────────────────

  class IGExtractorStrategy {
    getFilePrefix() {
      return "ig_";
    }

    getFeedSelectors() {
      return IG_FEED_SELECTORS;
    }

    async extractMedia() {
      const pageType = getPageType();

      if (pageType === "story") {
        const info = getStoryInfo();
        if (!info) return { error: "Could not parse story URL", items: [] };

        const items = await extractStory(info.username, info.storyId);
        if (items) return { pageType, items };
        return {
          error: "Could not extract story media. Make sure you are logged in.",
          items: [],
        };
      }

      if (pageType === "post" || pageType === "reel") {
        const shortcode = getShortcode();
        if (!shortcode) return { error: "Could not find post shortcode", items: [] };

        let items = null;

        // Layer 1: Direct Media Info API (shortcode → media ID)
        try {
          items = await extractViaMediaInfoFromShortcode(shortcode);
          console.log("[IG Downloader] Direct Media Info result:", items?.length, "items");
        } catch (e) {
          console.log("[IG Downloader] Direct Media Info failed:", e.message);
        }

        if (items && items.length) return { pageType, items };

        // Layer 2: REST API
        try {
          items = await extractViaREST(shortcode);
          console.log("[IG Downloader] REST result:", items?.length, "items");
        } catch (e) {
          console.log("[IG Downloader] REST API failed:", e.message);
        }

        if (items && items.length) return { pageType, items };

        // Layer 3: GraphQL API
        try {
          items = await extractViaGraphQL(shortcode);
          console.log("[IG Downloader] GraphQL result:", items?.length, "items");
        } catch (e) {
          console.log("[IG Downloader] GraphQL API failed:", e.message);
        }

        if (items && items.length) return { pageType, items };

        // Layer 4: Embedded page data
        try {
          items = extractFromEmbeddedData();
          console.log("[IG Downloader] Embedded data result:", items?.length, "items");
        } catch (e) {
          console.log("[IG Downloader] Embedded data extraction failed:", e.message);
        }

        if (items && items.length) return { pageType, items };

        // Layer 5: DOM scraping fallback
        items = extractFromDOM();
        console.log("[IG Downloader] DOM result:", items?.length, "items");
        if (items && items.length) return { pageType, items };

        return {
          error:
            "Could not extract media. The post may be private or the page hasn't fully loaded.",
          items: [],
        };
      }

      return {
        error: "Navigate to an Instagram post, reel, or story to extract media.",
        items: [],
      };
    }
  }

  // ── Message listener ──────────────────────────────────────────────────

  const strategy = new IGExtractorStrategy();

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

  function buildIGFeedFilename(item, idx, total) {
    const ext = item.type === "video" ? "mp4" : "jpg";
    const prefix = item.prefix || "ig_";
    if (item.username && item.taken_at) {
      const d = new Date(item.taken_at * 1000);
      const date = d.toISOString().slice(0, 10);
      const suffix = total > 1 ? `_${idx + 1}` : "";
      return `${prefix}${item.username}_${date}_${item.taken_at}${suffix}.${ext}`;
    }
    return `${prefix}media_${idx + 1}.${ext}`;
  }

  async function downloadFromIGShortcode(shortcode, btn) {
    btn.textContent = "⏳";
    btn.disabled = true;

    try {
      let items = null;

      try {
        items = await extractViaMediaInfoFromShortcode(shortcode);
      } catch (e) {
        console.log("[IG Downloader] Feed injector: MediaInfo failed:", e.message);
      }

      if (!items || !items.length) {
        try {
          items = await extractViaREST(shortcode);
        } catch (e) {
          console.log("[IG Downloader] Feed injector: REST failed:", e.message);
        }
      }

      if (!items || !items.length) {
        try {
          items = await extractViaGraphQL(shortcode);
        } catch (e) {
          console.log("[IG Downloader] Feed injector: GraphQL failed:", e.message);
        }
      }

      if (!items || !items.length) throw new Error("No media found");

      if (items.length === 1) {
        const filename = buildIGFeedFilename(items[0], 0, 1);
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
      console.log("[IG Downloader] Feed injector download failed:", e.message);
      btn.textContent = "✗";
    } finally {
      btn.disabled = false;
      setTimeout(() => { btn.textContent = "⬇"; }, 2000);
    }
  }

  // Only run the feed injector on feed/home pages, not on post/reel/story detail pages.
  if (getPageType() === "unknown") {
    new window.FeedInjector({
      selectors: IG_FEED_SELECTORS,
      extractPostId: (anchor) => {
        const m = anchor.href?.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
        return m ? m[1] : null;
      },
      onDownload: (shortcode, btn) => downloadFromIGShortcode(shortcode, btn),
    }).start();
  }
})();
