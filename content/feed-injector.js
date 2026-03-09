// Reusable feed button injection component.
// Receives platform-specific selector config and callbacks.
// Must be loaded before platform-specific strategy scripts in the same content_scripts group.

window.FeedInjector = class FeedInjector {
  /**
   * @param {object} config
   * @param {object} config.selectors
   * @param {string} config.selectors.postAnchor  - CSS selector for elements to inject on
   * @param {function(Element): string|null} config.extractPostId - extracts post/tweet ID from element
   * @param {function(string, HTMLButtonElement): void} config.onDownload - called on button click
   */
  constructor(config) {
    this.selectors = config.selectors;
    this.extractPostId = config.extractPostId;
    this.onDownload = config.onDownload;
    this._injected = new WeakSet();
  }

  // Starts the MutationObserver to watch for new posts in the feed.
  start() {
    this._injectStyles();
    this._scanAndInject();
    const observer = new MutationObserver(() => this._scanAndInject());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  _injectStyles() {
    if (document.getElementById("media-dl-feed-styles")) return;
    const style = document.createElement("style");
    style.id = "media-dl-feed-styles";
    style.textContent = `
      .media-dl-feed-btn {
        position: absolute; bottom: 6px; right: 6px;
        width: 28px; height: 28px; border-radius: 50%;
        border: none; background: rgba(139,92,246,0.85); color: #fff;
        font-size: 14px; cursor: pointer; z-index: 100;
        display: flex; align-items: center; justify-content: center;
      }
      .media-dl-feed-btn:hover { background: #7c3aed; }
    `;
    document.head.appendChild(style);
  }

  _scanAndInject() {
    document.querySelectorAll(this.selectors.postAnchor).forEach((el) => {
      this._injectButton(el);
    });
  }

  _injectButton(el) {
    if (this._injected.has(el)) return;
    if (el.closest('div[role="dialog"]')) return;

    const postId = this.extractPostId(el);
    if (!postId) return;

    this._injected.add(el);

    // Ensure the element is a positioning context for the absolute button.
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
    if (getComputedStyle(el).overflow === "hidden") {
      el.style.overflow = "visible";
    }

    const btn = this._createButton();
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onDownload(postId, btn, el);
    });

    el.appendChild(btn);
  }

  _createButton() {
    const btn = document.createElement("button");
    btn.className = "media-dl-feed-btn";
    btn.textContent = "⬇";
    btn.title = "Download";
    return btn;
  }
};
