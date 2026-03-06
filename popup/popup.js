(() => {
  "use strict";

  const gallery = document.getElementById("gallery");
  const status = document.getElementById("status");
  const errorDiv = document.getElementById("error");
  const errorMsg = document.getElementById("errorMsg");
  const pageTypeBadge = document.getElementById("pageType");
  const footer = document.getElementById("footer");
  const selectAllCb = document.getElementById("selectAll");
  const selectedCount = document.getElementById("selectedCount");
  const btnDownloadSelected = document.getElementById("btnDownloadSelected");
  const btnDownloadAll = document.getElementById("btnDownloadAll");
  const btnOpenAllTabs = document.getElementById("btnOpenAllTabs");
  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  let mediaItems = [];
  let selectedSet = new Set();

  // ── Disclaimer ───────────────────────────────────────────────────────

  const disclaimer = document.getElementById("disclaimer");
  const disclaimerClose = document.getElementById("disclaimerClose");

  if (localStorage.getItem("ig_dl_disclaimer_dismissed")) {
    disclaimer.classList.add("hidden");
  }

  disclaimerClose.addEventListener("click", () => {
    disclaimer.classList.add("hidden");
    localStorage.setItem("ig_dl_disclaimer_dismissed", "1");
  });

  // ── Init ─────────────────────────────────────────────────────────────

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes("instagram.com")) {
      showError("Navigate to Instagram to use this extension.");
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "extractMedia" });

      if (!response) {
        showError("Could not communicate with the page. Try refreshing Instagram.");
        return;
      }

      if (response.error && (!response.items || !response.items.length)) {
        showError(response.error);
        return;
      }

      mediaItems = response.items || [];

      if (response.pageType) {
        pageTypeBadge.textContent = response.pageType;
        pageTypeBadge.classList.remove("hidden");
      }

      renderGallery();
    } catch (err) {
      showError("Could not extract media. Try refreshing the Instagram page.");
    }
  }

  function showError(msg) {
    status.classList.add("hidden");
    errorMsg.textContent = msg;
    errorDiv.classList.remove("hidden");
  }

  // ── Gallery rendering ────────────────────────────────────────────────

  function renderGallery() {
    status.classList.add("hidden");

    if (!mediaItems.length) {
      showError("No media found on this page.");
      return;
    }

    gallery.innerHTML = "";

    mediaItems.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.index = idx;

      const checkbox = document.createElement("div");
      checkbox.className = "checkbox";

      const img = document.createElement("img");
      img.src = item.thumbnail || item.url;
      img.alt = `Media ${idx + 1}`;
      img.loading = "lazy";

      const typeBadge = document.createElement("span");
      typeBadge.className = "type-badge";
      typeBadge.textContent = item.type === "video" ? "VID" : "IMG";

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "action-btn open-btn";
      openBtn.textContent = "↗";
      openBtn.title = "Open in new tab";
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: item.url });
      });

      const dlBtn = document.createElement("button");
      dlBtn.className = "action-btn";
      dlBtn.textContent = "↓";
      dlBtn.title = "Download";
      dlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadSingle(item, idx);
      });

      actions.appendChild(openBtn);
      actions.appendChild(dlBtn);

      card.appendChild(checkbox);
      card.appendChild(img);
      card.appendChild(typeBadge);
      card.appendChild(actions);

      card.addEventListener("click", () => toggleSelect(card, idx));

      gallery.appendChild(card);
    });

    gallery.classList.remove("hidden");
    footer.classList.remove("hidden");

    // Show batch controls only when >1 item; for single item the individual buttons suffice
    if (mediaItems.length <= 1) {
      btnOpenAllTabs.classList.add("hidden");
      btnDownloadAll.classList.add("hidden");
      btnDownloadSelected.classList.add("hidden");
      selectAllCb.parentElement.classList.add("hidden");
      selectedCount.classList.add("hidden");
    }
  }

  // ── Selection logic ──────────────────────────────────────────────────

  function toggleSelect(card, idx) {
    if (selectedSet.has(idx)) {
      selectedSet.delete(idx);
      card.classList.remove("selected");
    } else {
      selectedSet.add(idx);
      card.classList.add("selected");
    }
    updateSelectionUI();
  }

  function updateSelectionUI() {
    selectedCount.textContent = `${selectedSet.size} selected`;
    btnDownloadSelected.disabled = selectedSet.size === 0;
    selectAllCb.checked = selectedSet.size === mediaItems.length && mediaItems.length > 0;
  }

  selectAllCb.addEventListener("change", () => {
    const cards = gallery.querySelectorAll(".card");
    if (selectAllCb.checked) {
      cards.forEach((card, idx) => {
        selectedSet.add(idx);
        card.classList.add("selected");
      });
    } else {
      selectedSet.clear();
      cards.forEach((card) => card.classList.remove("selected"));
    }
    updateSelectionUI();
  });

  // ── Downloads ────────────────────────────────────────────────────────

  function buildFilename(item, idx, total) {
    const ext = item.type === "video" ? "mp4" : "jpg";
    const user = item.username || "ig";
    if (item.taken_at) {
      const d = new Date(item.taken_at * 1000);
      const date = d.toISOString().slice(0, 10);
      const suffix = total > 1 ? `_${idx + 1}` : "";
      return `${user}_${date}_${item.taken_at}${suffix}.${ext}`;
    }
    return `ig_media_${idx + 1}.${ext}`;
  }

  function downloadSingle(item, idx) {
    chrome.runtime.sendMessage({
      action: "downloadSingle",
      url: item.url,
      filename: buildFilename(item, idx, mediaItems.length),
    });
  }

  btnOpenAllTabs.addEventListener("click", () => {
    mediaItems.forEach((item) => chrome.tabs.create({ url: item.url, active: false }));
  });

  btnDownloadSelected.addEventListener("click", () => {
    if (selectedSet.size === 0) return;
    const indices = [...selectedSet].sort();
    const items = indices.map((idx) => ({
      url: mediaItems[idx].url,
      type: mediaItems[idx].type,
      username: mediaItems[idx].username,
      taken_at: mediaItems[idx].taken_at,
      index: idx,
    }));
    requestZipDownload(items);
  });

  btnDownloadAll.addEventListener("click", () => {
    const items = mediaItems.map((item, idx) => ({
      url: item.url,
      type: item.type,
      username: item.username,
      taken_at: item.taken_at,
      index: idx,
    }));
    requestZipDownload(items);
  });

  function requestZipDownload(items) {
    progressWrap.classList.remove("hidden");
    progressFill.style.width = "0%";
    progressText.textContent = "Preparing ZIP...";
    btnDownloadSelected.disabled = true;
    btnDownloadAll.disabled = true;

    chrome.runtime.sendMessage({
      action: "downloadZip",
      items,
    });
  }

  // ── Progress listener ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "zipProgress") {
      const pct = Math.round(msg.progress * 100);
      progressFill.style.width = pct + "%";
      progressText.textContent = msg.text || `Downloading... ${pct}%`;
    }

    if (msg.action === "zipComplete") {
      progressFill.style.width = "100%";
      progressText.textContent = "ZIP ready!";
      setTimeout(() => {
        progressWrap.classList.add("hidden");
        btnDownloadSelected.disabled = selectedSet.size === 0;
        btnDownloadAll.disabled = false;
      }, 1500);
    }

    if (msg.action === "zipError") {
      progressText.textContent = "Error: " + (msg.error || "ZIP creation failed");
      progressFill.style.width = "0%";
      setTimeout(() => {
        progressWrap.classList.add("hidden");
        btnDownloadSelected.disabled = selectedSet.size === 0;
        btnDownloadAll.disabled = false;
      }, 3000);
    }
  });

  // ── Start ────────────────────────────────────────────────────────────

  init();
})();
