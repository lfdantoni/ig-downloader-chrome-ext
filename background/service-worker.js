importScripts("../lib/jszip.min.js");

const FETCH_TIMEOUT_MS = 30000;

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "downloadSingle") {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename || "ig_media.jpg",
      saveAs: true,
    });
    return;
  }

  if (msg.action === "downloadZip") {
    createAndDownloadZip(msg.items, sender);
    return;
  }
});

async function createAndDownloadZip(items, sender) {
  const zip = new JSZip();
  const total = items.length;
  let completed = 0;

  // Notify popup of progress
  function sendProgress(text) {
    chrome.runtime.sendMessage({
      action: "zipProgress",
      progress: completed / total,
      text,
    }).catch(() => {}); // popup may be closed
  }

  try {
    sendProgress(`Fetching media 0/${total}...`);

    // Fetch all media in parallel (with concurrency limit)
    const concurrency = 4;
    const queue = [...items];
    const workers = [];

    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      workers.push(processQueue());
    }

    async function processQueue() {
      while (queue.length > 0) {
        const item = queue.shift();
        const ext = item.type === "video" ? "mp4" : "jpg";
        const filename = `ig_media_${item.index + 1}.${ext}`;

        try {
          const resp = await fetchWithTimeout(item.url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          zip.file(filename, blob);
        } catch (err) {
          console.error(`[IG Downloader] Failed to fetch ${filename}:`, err);
          // Add a placeholder text file for failed downloads
          zip.file(
            `${filename}.error.txt`,
            `Failed to download: ${err.message}\nURL: ${item.url}`
          );
        }

        completed++;
        sendProgress(`Fetching media ${completed}/${total}...`);
      }
    }

    await Promise.all(workers);

    sendProgress("Creating ZIP...");

    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 1 }, // fast compression for media
    });

    // Convert blob to data URL for chrome.downloads
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(zipBlob);
    });

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

    chrome.downloads.download({
      url: dataUrl,
      filename: `ig_media_${timestamp}.zip`,
      saveAs: true,
    });

    chrome.runtime.sendMessage({ action: "zipComplete" }).catch(() => {});
  } catch (err) {
    console.error("[IG Downloader] ZIP creation failed:", err);
    chrome.runtime.sendMessage({
      action: "zipError",
      error: err.message,
    }).catch(() => {});
  }
}
