# IG Media Downloader

Chrome Extension (Manifest V3) to download images and videos from Instagram at maximum quality. Supports posts, carousels, reels, and stories.

## Features

- **Max quality extraction** — automatically selects the highest available resolution
- **Full support** — single posts, carousels (multiple images), reels, and stories
- **Popup gallery** — preview all detected media in a grid layout
- **Open in new tab** — button to open media at full quality in a new tab
- **Individual download** — download button on each gallery card
- **Multi-select** — checkboxes to select specific media and download them as a ZIP
- **Download all as ZIP** — bundle all media from a post into a single ZIP file
- **Progress bar** — visual indicator during ZIP creation
- **Dark theme** — interface consistent with Instagram's aesthetic

## Project Structure

```
ig-downloader-chrome-ext/
├── manifest.json                 # MV3 extension manifest
├── lib/jszip.min.js              # Bundled JSZip library for ZIP creation
├── icons/icon{16,48,128}.png     # Extension icons
├── content/extractor.js          # Content script: page detection + media extraction
├── popup/
│   ├── popup.html                # Gallery layout
│   ├── popup.css                 # Styles (dark theme)
│   └── popup.js                  # Rendering, selection, and download triggers
└── background/service-worker.js  # Download handler + ZIP creation
```

## Architecture

### Communication Flow

```
Popup ──sendMessage──▸ Content Script (extracts media from the IG page)
Popup ──sendMessage──▸ Service Worker (triggers downloads / ZIP creation)
Service Worker ──sendMessage──▸ Popup (progress updates)
```

### Extraction Strategy (3-layer fallback)

The content script (`content/extractor.js`) uses a 3-layer approach to maximize compatibility:

| Layer | Method | Description |
|-------|--------|-------------|
| 1 | **REST API** | `GET /p/{shortcode}/?__a=1&__d=dis` — returns JSON with `image_versions2.candidates[]` and `video_versions[]` |
| 2 | **GraphQL API** | `POST /api/graphql` with `doc_id` — returns `xdt_shortcode_media` with max quality URLs |
| 3 | **DOM Scraping** | Parses `<video>` elements and `<img srcset>` directly from the page HTML |

For **Stories**, a different route is used:
1. `/api/v1/users/web_profile_info/` to get the user ID
2. `/api/v1/feed/reels_media/?reel_ids={id}` to fetch story items

All API calls use `credentials: 'include'` (user's session cookies) + Instagram authentication headers (`X-IG-App-ID`, CSRF token).

### Max Quality Selection

For each media item, the candidate with the largest `width * height` is selected from the `image_versions2.candidates[]` or `video_versions[]` arrays.

### ZIP Creation (Service Worker)

- Uses the **JSZip** library loaded via `importScripts`
- Fetches each media URL as a blob in parallel (concurrency limited to 4)
- Sends progress updates to the popup during creation
- Triggers `chrome.downloads.download()` with `saveAs: true` so the user can choose where to save

### Page Type Detection

| Type | URL Pattern |
|------|-------------|
| Post | `/p/{shortcode}/` |
| Reel | `/reel/{shortcode}/` or `/reels/{shortcode}/` |
| Story | `/stories/{username}/{storyId}/` |

## Installation

### Requirements

- Google Chrome (or Chromium-based browser)
- Active Instagram session (you must be logged in)

### Steps

1. **Clone or download** the repository:
   ```bash
   git clone <repository-url>
   ```

2. Open Chrome and navigate to:
   ```
   chrome://extensions/
   ```

3. Enable **Developer mode** (top right corner)

4. Click **"Load unpacked"**

5. Select the `ig-downloader-chrome-ext` folder

6. The extension will appear in the toolbar with its icon

## Usage

### Individual Download

1. Navigate to any Instagram post, reel, or story
2. Click the extension icon in the toolbar
3. A popup will open with a gallery of detected media
4. Hover over a card to reveal two action buttons:
   - **↗** — opens the media at full quality in a new tab
   - **↓** — downloads the media directly

### Selective Download (ZIP)

1. Click on cards to select the media you want
2. The selection counter updates in the footer
3. Click **"Download Selected (ZIP)"** to download the selected media as a ZIP file

### Download All (ZIP)

1. Click **"Download All (ZIP)"** to download all media from the post in a single ZIP
2. The progress bar shows the download and ZIP creation status

### Select All

- Use the **"Select All"** checkbox in the footer to select or deselect all media

## Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Access the active tab to inject the content script |
| `downloads` | Trigger file downloads |
| `host_permissions` on `instagram.com` | Run the content script and make API calls |
| `host_permissions` on Instagram CDNs | Download media files from CDN servers |

## Limitations

- **Requires active session**: you must be logged into Instagram for the APIs to work
- **Private posts**: you can only download media from accounts visible with your session
- **Rate limiting**: Instagram may throttle requests if too many are made in a short time
- **API changes**: Instagram may change its internal endpoints, which could require updating the extension
