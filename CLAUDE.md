# IG Media Downloader - Chrome Extension

## Project Overview
Chrome Extension (Manifest V3) that extracts images/videos from Instagram posts, stories, and reels at maximum quality. Displays media in a popup gallery with single download, multi-select ZIP, and download-all ZIP support.

## Tech Stack
- **Platform**: Chrome Extension (Manifest V3)
- **Language**: Vanilla JavaScript (no build step, no framework)
- **ZIP creation**: JSZip 3.10.1 (bundled in `lib/jszip.min.js`)
- **Styling**: Plain CSS, dark theme

## File Structure
```
manifest.json                 # MV3 manifest
lib/jszip.min.js              # Bundled JSZip library
icons/icon{16,48,128}.png     # Extension icons
content/extractor.js          # Content script: page detection + media extraction
popup/popup.html              # Gallery UI
popup/popup.css               # Dark theme styling
popup/popup.js                # Grid rendering, selection, download triggers
background/service-worker.js  # Download handler + ZIP creation
```

## Architecture
- **Content script** → injected on `instagram.com`, extracts media via 3-layer fallback: REST API → GraphQL API → DOM scraping
- **Popup** → sends `extractMedia` message to content script, renders gallery, sends download requests to service worker
- **Service worker** → handles `downloadSingle` (direct chrome.downloads) and `downloadZip` (fetches blobs, creates ZIP via JSZip, sends progress to popup)

## Key Conventions
- No build tools or bundlers — all files are loaded directly
- Service worker loads JSZip via `importScripts("../lib/jszip.min.js")`
- All Instagram API calls use `credentials: 'include'` with `X-IG-App-ID` and CSRF token headers
- Card actions (open in tab + download) are grouped in a `.card-actions` container that appears on hover

## Testing
Load unpacked at `chrome://extensions/`, navigate to IG post/reel/story, click extension icon.
