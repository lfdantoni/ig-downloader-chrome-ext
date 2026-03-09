# Privacy Policy — IG & X Media Downloader

**Last updated:** March 2026

## Overview

IG & X Media Downloader is a browser extension that helps users download publicly accessible media from Instagram and X (Twitter). This policy describes how the extension handles user data.

## Data Collection

**This extension does not collect, store, or transmit any personal data to external servers.**

Specifically:

- No user data is sent to the extension developer or any third party.
- No analytics, telemetry, or tracking of any kind is implemented.
- No cookies are created or modified by the extension.
- No browsing history is recorded or stored.
- No accounts, registrations, or sign-ups are required.

## Data Usage

The extension operates entirely within your browser and performs the following actions:

1. **Reads Instagram page content** — A content script runs only on `instagram.com` to detect and extract media URLs from the current page.
2. **Reads X (Twitter) page content** — A content script runs only on `x.com` and `twitter.com` to detect and extract media URLs. An additional script runs in the page's JavaScript context to intercept X's own internal API responses for media data (read-only; responses are not modified or forwarded anywhere).
3. **Uses your existing session cookies** — API requests to Instagram (`csrftoken`) and X/Twitter (`ct0`) are made using your browser's existing session cookies via `credentials: 'include'`. The extension reads these cookies only to attach them to same-site API requests. They are never stored or transmitted elsewhere.
4. **Fetches media metadata via X's syndication API** — For X/Twitter tweets, the extension's background service worker may contact `cdn.syndication.twimg.com` (X's public embed endpoint) to retrieve media information. No user-identifying data is sent in these requests.
5. **Downloads media files** — Media files are fetched from platform CDN servers and saved to your local device via Chrome's downloads API.
6. **Creates ZIP archives** — When downloading multiple files, ZIP archives are created locally in the browser's service worker memory and immediately offered for download. No data leaves your device.

## Permissions Justification

| Permission | Purpose |
|------------|---------|
| `activeTab` | Required to inject content scripts into the active Instagram or X tab for media extraction |
| `downloads` | Required to save downloaded media files to the user's device |
| Host access to `instagram.com` | Required for the content script to run and make API requests to Instagram |
| Host access to `*.cdninstagram.com` and `*.fbcdn.net` | Required to fetch media files from Instagram's content delivery network |
| Host access to `x.com` and `twitter.com` | Required for the content script to run on X/Twitter pages |
| Host access to `pbs.twimg.com` | Required to fetch image and video files from X's media CDN |
| Host access to `cdn.syndication.twimg.com` | Required to fetch tweet media metadata from X's public syndication (embed) API |

## Third-Party Services

The extension communicates only with the following servers using your existing browser session or public endpoints:

- Instagram servers: `instagram.com`, `*.cdninstagram.com`, `*.fbcdn.net`
- X/Twitter servers: `x.com`, `twitter.com`, `pbs.twimg.com`, `cdn.syndication.twimg.com`

No other third-party services are contacted.

## Local Storage

The extension uses `localStorage` solely to remember whether the user has dismissed the disclaimer banner in the popup. This stores a single key (`ig_dl_disclaimer_dismissed`) with the value `"1"`. No personal data, browsing data, or media content is ever stored.

## Changes to This Policy

Any changes to this privacy policy will be reflected in the extension update notes and this document.

## Contact

If you have questions about this privacy policy, please open an issue on the project's GitHub repository.
