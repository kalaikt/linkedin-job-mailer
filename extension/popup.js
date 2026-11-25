const DEFAULTS = globalThis.JOB_MAILER_DEFAULTS;
const parse = globalThis.JobMailerParse;

const postsEl = document.querySelector("#posts");
const recipientEl = document.querySelector("#recipient");
const recipientList = document.querySelector("#recipient-list");
const subjectEl = document.querySelector("#subject");
const bodyEl = document.querySelector("#body");
const approvedEl = document.querySelector("#approved");
const draftButton = document.querySelector("#draft");
const sendButton = document.querySelector("#send");
const statusEl = document.querySelector("#status");

let settings = { ...DEFAULTS };
let tab = null;
let selected = null;
let settingsReady = false;
let pendingMail = null;

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "job-mailer" || data.type !== "mailThisPost" || !data.post) return;
  const fromParent = event.source === window.parent;
  const fromLinkedIn = /^https:\/\/([^/]+\.)?linkedin\.com$/.test(event.origin || "");
  if (!fromParent && !fromLinkedIn) return;
  pendingMail = data.post;
  if (settingsReady) applyMailedPost(pendingMail);
});

document.querySelector("#settings").addEventListener("click", () => {
  if (!globalThis.chrome?.runtime?.openOptionsPage) {
    setStatus("Open this panel from the extension icon.", "error");
    return;
  }
  chrome.runtime.openOptionsPage();
});

document.querySelector("#open-group").addEventListener("click", () => {
  if (!isLinkedInUrl(settings.groupUrl)) {
    setStatus("Add an https LinkedIn URL in Settings.", "error");
    return;
  }
  chrome.runtime.sendMessage({ type: "openUrl", url: settings.groupUrl }, (response) => {
    if (chrome.runtime.lastError) setStatus(chrome.runtime.lastError.message, "error");
    else if (!response?.ok) setStatus(response?.error || "Could not open that page.", "error");
  });
});

const scanButton = document.querySelector("#scan");
scanButton.addEventListener("click", () => {
  scan().catch((error) => setStatus(error.message, "error"));
});

draftButton.addEventListener("click", () => {
  draftSelected(true);
});

const attachmentInput = document.querySelector("#attachment");
const attachmentName = document.querySelector("#attachment-name");
attachmentInput.addEventListener("change", () => {
  const file = attachmentInput.files && attachmentInput.files[0];
  attachmentName.textContent = file ? file.name : "";
});

document.querySelector("#send").addEventListener("click", () => {
  if (!selected || !approvedEl.checked) {
    setStatus("Review the draft and check the approval box.", "error");
    return;
  }
  const to = cleanRecipient(recipientEl.value);
  recipientEl.value = to;
  if (!validEmail(to)) {
    setStatus("Edit the recipient so it is one address, like name@company.com.", "error");
    refreshSend();
    return;
  }
  setStatus("Sending…", "busy");
  sendButton.disabled = true;
  readAttachment(attachmentInput.files && attachmentInput.files[0]).then((attachment) => {
  chrome.runtime.sendMessage({
    type: "send",
    to,
    subject: subjectEl.value,
    text: bodyEl.value,
    approved: true,
    attachment
  }, (response) => {
    refreshSend();
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, "error");
      return;
    }
    if (!response?.ok) {
      setStatus(response?.error || "Send failed.", "error");
      return;
    }
    approvedEl.checked = false;
    refreshSend();
    setStatus(attachment ? "Sent to " + to + " with " + attachment.filename + "." : "Sent to " + to + ".", "ok");
  });
  }).catch((error) => {
    refreshSend();
    setStatus(error.message, "error");
  });
});

approvedEl.addEventListener("change", refreshSend);
subjectEl.addEventListener("input", refreshSend);
bodyEl.addEventListener("input", refreshSend);
recipientList.addEventListener("change", () => {
  if (recipientList.value) recipientEl.value = recipientList.value;
  approvedEl.checked = false;
  draftButton.disabled = !(selected && validEmail(recipientEl.value));
  refreshSend();
});
recipientEl.addEventListener("input", () => {
  approvedEl.checked = false;
  draftButton.disabled = !(selected && validEmail(recipientEl.value));
  refreshSend();
});

init().catch((error) => setStatus(error.message, "error"));

async function init() {
  if (!globalThis.chrome?.storage?.local) {
    setStatus("Open this panel from the extension icon.");
    return;
  }
  settings = { ...DEFAULTS, ...(await storageGet(DEFAULTS)) };
  if (!String(settings.relayToken || "").trim()) settings.relayToken = DEFAULTS.relayToken;
  if (globalThis.chrome?.tabs?.query) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0] || null;
  }
  if (!settings.apiKey || !settings.smtpHost || !settings.relayToken || !settings.fromEmail) {
    setStatus("Open Settings and save the model, mailbox, and relay token.", "error");
  } else if (tab && !isLinkedInUrl(tab.url)) {
    setStatus("Open the LinkedIn group, then scan this page.");
  } else {
    setStatus("Ready to scan this page.");
  }
  refreshSend();
  settingsReady = true;
  if (pendingMail) applyMailedPost(pendingMail);
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ source: "job-mailer", type: "mailReady" }, "*");
  }
}

function pageMessage(payload) {
  return new Promise((resolve, reject) => {
    const resultType = payload.type + "Result";
    const timer = setTimeout(() => {
      window.removeEventListener("message", onResult);
      reject(new Error("This page did not answer. Refresh LinkedIn, then try again."));
    }, 90000);
    const onResult = (event) => {
      if (!event.data || event.data.source !== "job-mailer" || event.data.type !== resultType) return;
      clearTimeout(timer);
      window.removeEventListener("message", onResult);
      resolve(event.data);
    };
    window.addEventListener("message", onResult);
    window.parent.postMessage(payload, "*");
  });
}

async function scan() {
  if (tab && !isLinkedInUrl(tab.url)) {
    setStatus("Open a LinkedIn page first.", "error");
    return;
  }
  setStatus("Scrolling this page for more posts…", "busy");
  scanButton.disabled = true;
  let response;
  try {
    response = window.parent && window.parent !== window
      ? await pageMessage({ source: "job-mailer", type: "scanFeedPosts" })
      : await runtimeMessage({ type: "scanPage" });
  } finally {
    scanButton.disabled = false;
  }
  if (!response?.ok) throw new Error(response?.error || "Scan failed.");
  const keywords = parse.keywordList(settings.keywords);
  const posts = (response.posts || [])
    .map((post) => ({ ...post, keywordMatch: parse.matchesKeywords(post.text, settings.keywords) }))
    .sort((left, right) => Number(right.keywordMatch) - Number(left.keywordMatch));
  renderPosts(posts);
  if (posts.length === 0) {
    setStatus("Nothing readable was found on this page. Scroll the group, then scan again.", "error");
    return;
  }
  const matched = posts.filter((post) => post.keywordMatch).length;
  const noun = posts.length === 1 ? " post" : " posts";
  if (keywords.length === 0) {
    setStatus(posts.length + noun + " from this page.", "ok");
    return;
  }
  setStatus(posts.length + noun + " on this page. " + matched + " match your keywords.", matched ? "ok" : "error");
}

function renderPosts(posts) {
  postsEl.replaceChildren();
  selected = null;
  fillRecipientList([]);
  recipientEl.value = "";
  draftButton.disabled = true;
  approvedEl.checked = false;
  refreshSend();
  for (const post of posts) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "post-open";
    const role = parse.roleFrom(post.text);
    const location = parse.locationFrom(post.text);
    const title = document.createElement("div");
    title.textContent = role;
    const meta = document.createElement("div");
    meta.className = "meta";
    const notes = [];
    if (location) notes.push(location);
    if (post.keywordMatch === false) notes.push("Outside your keywords");
    notes.push(post.emails.length ? post.emails.join(", ") : "No email address in this post");
    meta.textContent = notes.join(" · ");
    button.append(title, meta);
    button.addEventListener("click", () => selectPost(post, button, true));
    item.append(button);
    postsEl.append(item);
  }
  const buttons = [...postsEl.querySelectorAll(".post-open")];
  const preferred = posts.findIndex((post) => post.keywordMatch !== false && post.emails.length > 0);
  const withEmail = posts.findIndex((post) => post.emails.length > 0);
  const index = preferred >= 0 ? preferred : (withEmail >= 0 ? withEmail : 0);
  if (buttons[index]) selectPost(posts[index], buttons[index], false);
}

function applyMailedPost(post) {
  selected = post;
  for (const other of postsEl.querySelectorAll(".post-open")) other.setAttribute("aria-pressed", "false");
  fillRecipientList(post.emails || []);
  recipientEl.value = (post.emails && post.emails[0]) || "";
  draftButton.disabled = !validEmail(recipientEl.value);
  approvedEl.checked = false;
  refreshSend();
  recipientEl.scrollIntoView({ block: "center" });
  const kept = attachmentInput.files && attachmentInput.files[0];
  if (kept) attachmentName.textContent = kept.name;
  draftSelected();
}

function selectPost(post, button, reveal) {
  selected = post;
  for (const other of postsEl.querySelectorAll(".post-open")) other.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-pressed", "true");
  button.scrollIntoView({ block: "nearest" });
  fillRecipientList(post.emails);
  recipientEl.value = post.emails[0] || "";
  draftButton.disabled = !validEmail(recipientEl.value);
  subjectEl.value = "";
  bodyEl.value = "";
  approvedEl.checked = false;
  refreshSend();
  if (reveal) revealPost(post);
}

function modelPattern() {
  const url = new URL(settings.apiBase);
  if (url.protocol !== "https:") throw new Error("bad protocol");
  return url.origin + "/*";
}

function sendDraft(to) {
  const file = attachmentInput.files && attachmentInput.files[0];
  const cursor = /api\.cursor\.com|cursor\.com|\.cursor\.sh/i.test(String(settings.apiBase || ""));
  const writing = cursor ? "Writing the draft with Cursor. This usually takes up to a minute." : "Writing a draft…";
  setStatus(file ? writing + " " + file.name + " stays attached." : writing, "busy");
  draftButton.disabled = true;
  chrome.runtime.sendMessage({ type: "draft", to, text: selected.text }, (response) => {
    draftButton.disabled = !validEmail(recipientEl.value);
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, "error");
      return;
    }
    if (!response?.ok) {
      setStatus(response?.error || "Draft failed.", "error");
      return;
    }
    subjectEl.value = response.subject || "";
    bodyEl.value = response.body || "";
    approvedEl.checked = false;
    refreshSend();
    subjectEl.scrollIntoView({ block: "nearest" });
    const kept = attachmentInput.files && attachmentInput.files[0];
    setStatus(kept ? "Review the draft. " + kept.name + " is still attached. Choose another file to replace it." : "Review the draft, then send it. You can attach a file.", "ok");
  });
}

function draftSelected(fromClick) {
  if (!selected) {
    setStatus("Select a post first.", "error");
    return;
  }
  const to = cleanRecipient(recipientEl.value);
  recipientEl.value = to;
  if (!validEmail(to)) {
    setStatus("Edit the recipient so it is one address, like name@company.com.", "error");
    return;
  }
  if (!settings.apiKey || !settings.apiBase) {
    setStatus("Add a model and API key in Settings.", "error");
    return;
  }
  let pattern;
  try {
    pattern = modelPattern();
  } catch (_error) {
    setStatus("The model URL in Settings must start with https://", "error");
    return;
  }
  chrome.permissions.contains({ origins: [pattern] }, (allowed) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, "error");
      return;
    }
    if (allowed) {
      sendDraft(to);
      return;
    }
    if (!fromClick) {
      setStatus("Click Draft email once to allow the model, then use the envelope again.", "error");
      return;
    }
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, "error");
        return;
      }
      if (!granted) {
        setStatus("Allow access to the model host, then draft again.", "error");
        return;
      }
      sendDraft(to);
    });
  });
}

function revealPost(post) {
  const payload = {
    source: "job-mailer",
    type: "showFeedPost",
    title: post.title || "",
    needle: post.needle || String(post.text || "").replace(/\s+/g, " ").trim().slice(0, 180),
    urn: post.urn || "",
    mark: post.mark || "",
    email: (post.emails && post.emails[0]) || ""
  };
  setStatus("Opening that post on the page…", "busy");
  const showResult = (response) => {
    if (!response?.ok) setStatus(response?.error || "Could not show that post.", "error");
    else setStatus("That post is outlined on the page.", "ok");
  };
  if (window.parent && window.parent !== window) {
    revealOnPage(payload, showResult);
    return;
  }
  runtimeMessage(payload).then(showResult).catch((error) => showResult({ ok: false, error: error.message }));
}

function revealOnPage(payload, showResult) {
  if (!window.parent || window.parent === window) {
    showResult({ ok: false, error: "Scan this page, then select the post again." });
    return;
  }
  const onResult = (event) => {
    if (!event.data || event.data.source !== "job-mailer" || event.data.type !== "showFeedPostResult") return;
    window.removeEventListener("message", onResult);
    showResult(event.data);
  };
  window.addEventListener("message", onResult);
  window.parent.postMessage(payload, "*");
}

function fillRecipientList(emails) {
  recipientList.replaceChildren();
  if (emails.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No email address in this post";
    recipientList.append(empty);
    recipientList.disabled = true;
    return;
  }
  recipientList.disabled = false;
  for (const email of emails) {
    const option = document.createElement("option");
    option.value = email;
    option.textContent = email;
    recipientList.append(option);
  }
}

function readAttachment(file) {
  if (!file) return Promise.resolve(null);
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error("Attachment must be 5 MB or smaller."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "").split(",")[1] || "";
      resolve({ filename: file.name, contentType: file.type || "application/octet-stream", content });
    };
    reader.onerror = () => reject(new Error("Could not read the attachment."));
    reader.readAsDataURL(file);
  });
}

function cleanRecipient(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/i.test(cleanRecipient(value));
}

function refreshSend() {
  sendButton.disabled = !(selected && validEmail(recipientEl.value) && subjectEl.value.trim() && bodyEl.value.trim() && approvedEl.checked);
}

function isLinkedInUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.linkedin.com" || url.hostname === "linkedin.com");
  } catch (_error) {
    return false;
  }
}

function storageGet(defaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, resolve);
  });
}

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function setStatus(message, kind) {
  statusEl.className = "status" + (kind ? " " + kind : "");
  statusEl.replaceChildren();
  if (kind === "busy") {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    statusEl.append(spinner);
  }
  statusEl.append(document.createTextNode(message));
  statusEl.setAttribute("aria-busy", kind === "busy" ? "true" : "false");
}
