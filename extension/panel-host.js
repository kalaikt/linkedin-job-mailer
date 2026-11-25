(function () {
  const HOST_ID = "job-mailer-panel";

  function place(frame) {
    const gutter = Math.max(0, (window.innerWidth - 1128) / 2);
    const width = gutter > 360 ? Math.min(400, gutter - 20) : 380;
    frame.style.width = width + "px";
  }

  function ensurePanel() {
    const existing = document.getElementById(HOST_ID);
    if (existing) return existing;
    const frame = document.createElement("iframe");
    frame.id = HOST_ID;
    frame.title = "LinkedIn Job Mailer";
    frame.src = chrome.runtime.getURL("popup.html");
    frame.style.position = "fixed";
    frame.style.top = "72px";
    frame.style.right = "12px";
    frame.style.height = "calc(100vh - 88px)";
    frame.style.border = "0";
    frame.style.borderRadius = "12px";
    frame.style.boxShadow = "0 12px 40px rgba(28, 25, 21, 0.2)";
    frame.style.zIndex = "2147483646";
    frame.style.background = "#f3efe6";
    place(frame);
    document.documentElement.appendChild(frame);
    frame.addEventListener("load", () => {
      frame.dataset.ready = "1";
    });
    return frame;
  }

  function toggle() {
    const existing = document.getElementById(HOST_ID);
    if (existing) {
      existing.remove();
      return;
    }
    ensurePanel();
  }

  let pendingPost = null;

  function deliverMail(frame) {
    if (!pendingPost || !frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ source: "job-mailer", type: "mailThisPost", post: pendingPost }, "*");
  }

  function openForMail(post) {
    pendingPost = post;
    const frame = ensurePanel();
    if (frame.dataset.ready === "1") deliverMail(frame);
    else frame.addEventListener("load", () => deliverMail(frame), { once: true });
  }

  function onShowPost(event) {
    const data = event.data;
    const frame = document.getElementById(HOST_ID);
    if (!data || data.source !== "job-mailer") return;
    if (!frame) return;
    const fromFrame = event.source === frame.contentWindow;
    let fromExtension = false;
    try {
      fromExtension = event.origin === new URL(chrome.runtime.getURL("/")).origin;
    } catch (_error) {
      fromExtension = false;
    }
    if (!fromFrame && !fromExtension) return;
    if (data.type === "mailReady") {
      deliverMail(frame);
      return;
    }
    if (data.type === "scanFeedPosts") {
      const scan = globalThis.__jobMailerScan;
      if (!scan) {
        frame.contentWindow.postMessage({ source: "job-mailer", type: "scanFeedPostsResult", ok: false, error: "Refresh this LinkedIn page, then scan again." }, "*");
        return;
      }
      Promise.resolve()
        .then(() => scan())
        .then((posts) => {
          frame.contentWindow.postMessage({ source: "job-mailer", type: "scanFeedPostsResult", ok: true, posts }, "*");
        })
        .catch((error) => {
          frame.contentWindow.postMessage({
            source: "job-mailer",
            type: "scanFeedPostsResult",
            ok: false,
            error: error instanceof Error ? error.message : "Scan failed."
          }, "*");
        });
      return;
    }
    if (data.type !== "showFeedPost") return;
    const show = globalThis.__jobMailerShow;
    if (!show) {
      frame.contentWindow.postMessage({ source: "job-mailer", type: "showFeedPostResult", ok: false, error: "Scan this page, then select the post again." }, "*");
      return;
    }
    show(data).then((result) => {
      frame.contentWindow.postMessage({
        source: "job-mailer",
        type: "showFeedPostResult",
        ok: !!(result && result.ok),
        error: result && result.error
      }, "*");
    }).catch((error) => {
      frame.contentWindow.postMessage({
        source: "job-mailer",
        type: "showFeedPostResult",
        ok: false,
        error: error instanceof Error ? error.message : "Could not show that post."
      }, "*");
    });
  }

  globalThis.__jobMailerToggle = toggle;
  globalThis.__jobMailerOpen = openForMail;
  if (!globalThis.__jobMailerMailBound) {
    globalThis.__jobMailerMailBound = true;
    window.addEventListener("job-mailer-mail", (event) => {
      if (event.detail) openForMail(event.detail);
    });
  }
  if (typeof globalThis.__jobMailerShowBridge === "function") {
    window.removeEventListener("message", globalThis.__jobMailerShowBridge);
  }
  globalThis.__jobMailerShowBridge = onShowPost;
  window.addEventListener("message", onShowPost);
  if (globalThis.__jobMailerPanelBound) return;
  globalThis.__jobMailerPanelBound = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "toggleJobMailerPanel") return;
    toggle();
  });
})();
