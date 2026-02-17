# Privacy Policy — IG Media Downloader

**Last updated:** February 2026

## Overview

IG Media Downloader is a browser extension that helps users download publicly accessible media from Instagram. This policy describes how the extension handles user data.

## Data Collection

**This extension does not collect, store, or transmit any personal data.**

Specifically:

- No user data is sent to external servers or third parties.
- No analytics, telemetry, or tracking of any kind is implemented.
- No cookies are created or modified by the extension.
- No browsing history is recorded or stored.
- No accounts, registrations, or sign-ups are required.

## Data Usage

The extension operates entirely within your browser and performs the following actions:

1. **Reads Instagram page content** — The content script runs only on `instagram.com` to detect and extract media URLs from the current page.
2. **Uses your existing Instagram session** — API requests to Instagram are made using your browser's existing session cookies (`credentials: 'include'`). The extension does not read, store, or transmit these cookies elsewhere.
3. **Downloads media files** — Media files are fetched from Instagram's CDN servers (`cdninstagram.com`, `fbcdn.net`) and saved to your local device via Chrome's downloads API.
4. **Creates ZIP archives** — When downloading multiple files, ZIP archives are created locally in the browser's service worker memory and immediately offered for download. No data leaves your device.

## Permissions Justification

| Permission | Purpose |
|------------|---------|
| `activeTab` | Required to inject the content script into the active Instagram tab for media extraction |
| `downloads` | Required to save downloaded media files to the user's device |
| Host access to `instagram.com` | Required for the content script to run and make API requests to Instagram |
| Host access to `*.cdninstagram.com` and `*.fbcdn.net` | Required to fetch media files from Instagram's content delivery network |

## Third-Party Services

The extension communicates only with Instagram's servers (`instagram.com`, `cdninstagram.com`, `fbcdn.net`) using your existing browser session. No other third-party services are contacted.

## Local Storage

The extension uses `localStorage` solely to remember whether the user has dismissed the disclaimer banner in the popup. This stores a single key (`ig_dl_disclaimer_dismissed`) with the value `"1"`. No personal data, browsing data, or media content is ever stored.

## Changes to This Policy

Any changes to this privacy policy will be reflected in the extension update notes and this document.

## Contact

If you have questions about this privacy policy, please open an issue on the project's GitHub repository.
