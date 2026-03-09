# IG & X Media Downloader - Chrome Extension

## Project Overview
Chrome Extension (Manifest V3) that extracts images and videos from Instagram posts, stories, reels, and X (Twitter) tweets at maximum quality. Displays media in a popup gallery with single download, multi-select ZIP, and download-all ZIP support.

## Tech Stack
- **Platform**: Chrome Extension (Manifest V3)
- **Language**: Vanilla JavaScript (no build step, no framework)
- **ZIP creation**: JSZip 3.10.1 (bundled in `lib/jszip.min.js`)
- **Styling**: Plain CSS, dark theme

## File Structure
```
manifest.json                      # MV3 manifest
lib/jszip.min.js                   # Bundled JSZip library
icons/icon{16,48,128}.png          # Extension icons
content/base-extractor.js          # Shared utilities (fetchWithTimeout, getCookie, bestCandidate)
content/feed-injector.js           # Reusable feed button injection component (FeedInjector class)
content/ig-strategy.js             # Instagram: page detection + multi-layer media extraction
content/x-interceptor.js           # X/Twitter MAIN world script: intercepts fetch, caches media in DOM
content/x-strategy.js              # X/Twitter: extraction layers + feed injector setup
popup/popup.html                   # Gallery UI
popup/popup.css                    # Dark theme styling
popup/popup.js                     # Grid rendering, selection, download triggers
background/service-worker.js       # Download handler + ZIP creation + syndication proxy
```

## Architecture

### Instagram (ig-strategy.js)
Content script injected on `instagram.com`. Extracts media via multi-layer fallback:
1. Media Info API (shortcode → ID)
2. REST API (`/?__a=1`)
3. GraphQL API (multiple doc_id fallbacks)
4. Embedded `<script type="application/json">` page data
5. DOM scraping (cdninstagram / fbcdn URLs)

### X / Twitter (x-interceptor.js + x-strategy.js)
Two scripts work together across Chrome's two content script worlds:

- **x-interceptor.js** (MAIN world, `document_start`): Overrides `window.fetch` before X's own scripts run to intercept GraphQL API responses (`TweetDetail`, `HomeTimeline`, etc.). Parses media and stores it in a hidden DOM element (`<script id="__xMediaCache" type="application/json">`) shared between worlds.
- **x-strategy.js** (isolated world, `document_idle`): Extracts media via 4-layer fallback:
  1. DOM cache written by x-interceptor.js
  2. Syndication API (`cdn.syndication.twimg.com`) — routed through background service worker to bypass CORS
  3. X internal GraphQL API (returns 401 without valid `x-client-transaction-id`, kept as fallback)
  4. DOM scraping (`pbs.twimg.com/media` images, `<video>` elements)

### Popup (popup.js)
Sends `extractMedia` message to the active tab's content script (ig-strategy or x-strategy depending on platform), renders media gallery, sends download requests to service worker.

### Service Worker (service-worker.js)
Handles:
- `downloadSingle` — direct `chrome.downloads`
- `downloadZip` — fetches blobs, creates ZIP via JSZip, streams progress to popup
- `fetchSyndication` — proxies X syndication API fetch to bypass CORS (content scripts are subject to CORS; service worker is not)

## Key Conventions
- No build tools or bundlers — all files are loaded directly
- Service worker loads JSZip via `importScripts("../lib/jszip.min.js")`
- Instagram API calls use `credentials: 'include'` with `X-IG-App-ID` and CSRF token headers
- X GraphQL calls use `credentials: 'include'` with `Authorization: Bearer` and `x-csrf-token: ct0`
- Card actions (open in tab + download) are grouped in a `.card-actions` container that appears on hover
- Feed injector buttons use class `media-dl-feed-btn` (styled in feed-injector.js)
- Filenames are prefixed: `ig_` for Instagram, `x_` for X/Twitter
- DOM element `<script id="__xMediaCache">` bridges MAIN world → isolated world for X media cache

## Known Limitations
- X GraphQL API (`/i/api/graphql/`) requires a dynamic `x-client-transaction-id` proof-of-work header that cannot be computed independently; those requests always return 401. Kept as a fallback layer but effectively never succeeds.
- X syndication API does not support tweets from private/protected accounts.

## Testing
Load unpacked at `chrome://extensions/`, then:
- **Instagram**: navigate to a post/reel/story, click the extension icon
- **X/Twitter**: navigate to a tweet with media, click the extension icon; or scroll a feed to see per-tweet download buttons
