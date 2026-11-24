importScripts("defaults.js", "parse.js");

const DEFAULTS = globalThis.JOB_MAILER_DEFAULTS;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !isLinkedInTab(tab.url)) return;
  if (chrome.scripting && chrome.scripting.executeScript) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["parse.js", "content.js", "panel-host.js"] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (globalThis.__jobMailerToggle) globalThis.__jobMailerToggle();
      }
    });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggleJobMailerPanel" });
  } catch (_error) {
    /* The page has no panel yet. Reload the extension, then refresh LinkedIn. */
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
  const task = message.type === "draft"
    ? draftEmail(message)
    : message.type === "send"
      ? sendEmail(message)
      : message.type === "checkMail"
        ? checkMail()
        : message.type === "scanPage"
          ? scanPage(sender)
          : message.type === "openUrl"
            ? openLinkedIn(message.url)
            : message.type === "showFeedPost"
              ? showOnPage(sender, message)
              : null;
  if (!task) return;
  task.then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Request failed" });
  });
  return true;
});

function isLinkedInTab(value) {
  return /^https:\/\/([^/]+\.)?linkedin\.com\//.test(String(value || ""));
}

async function scanPage(sender) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId || !isLinkedInTab(sender.tab.url)) throw new Error("Open a LinkedIn page first.");
  if (!chrome.scripting) throw new Error("Reload the extension, then scan again.");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["parse.js", "content.js"] });
  const response = await chrome.tabs.sendMessage(tabId, { type: "scanFeedPosts" });
  if (!response?.ok) throw new Error(response?.error || "Scan failed.");
  return response;
}

async function showOnPage(sender, message) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId || !isLinkedInTab(sender.tab.url)) throw new Error("Open a LinkedIn page first.");
  if (chrome.scripting) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["parse.js", "content.js"] });
  }
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "showFeedPost",
    title: message.title || "",
    needle: message.needle || "",
    urn: message.urn || "",
    mark: message.mark || "",
    email: message.email || ""
  });
  if (!response?.ok) throw new Error(response?.error || "Could not show that post.");
  return response;
}

function openLinkedIn(value) {
  const url = String(value || "");
  if (!isLinkedInTab(url)) return Promise.reject(new Error("Add an https LinkedIn URL in Settings."));
  return chrome.tabs.create({ url }).then(() => ({ ok: true }));
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const settings = { ...DEFAULTS, ...stored };
  settings.relayToken = cleanRelayToken(settings.relayToken) || DEFAULTS.relayToken;
  return settings;
}

function cleanRelayToken(value) {
  let token = String(value || "").trim();
  const prefixed = token.match(/^RELAY_TOKEN=(.*)$/i);
  if (prefixed) token = prefixed[1].trim();
  if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1);
  }
  return token;
}

function isCursorHost(apiBase) {
  try {
    const host = new URL(String(apiBase || "").trim()).hostname.toLowerCase();
    return host === "api.cursor.com" || host === "cursor.com" || host.endsWith(".cursor.sh");
  } catch (_error) {
    return false;
  }
}

function chatEndpoint(apiBase) {
  const url = new URL(String(apiBase || "").trim());
  const host = url.hostname.toLowerCase();
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) return url.origin + path;
  if ((host === "api.x.ai" || host === "api.openai.com") && (path === "" || path === "/")) path = "/v1";
  if (host === "api.groq.com" && (path === "" || path === "/")) path = "/openai/v1";
  if (host === "openrouter.ai" && (path === "" || path === "/")) path = "/api/v1";
  return url.origin + path + "/chat/completions";
}

function apiOriginPattern(apiBase) {
  const url = new URL(apiBase);
  if (url.protocol !== "https:") throw new Error("The model URL must start with https://");
  return url.origin + "/*";
}

function relayOriginPattern(relayUrl) {
  const url = new URL(relayUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("The mail relay must be http://127.0.0.1");
  }
  return "http://127.0.0.1:*/*";
}

async function draftEmail(message) {
  const settings = await loadSettings();
  if (!settings.apiKey) throw new Error("Add an API key in Settings.");
  if (!settings.apiBase || (!settings.model && !isCursorHost(settings.apiBase))) throw new Error("Choose a model in Settings.");
  const to = String(message.to || "").trim().toLowerCase();
  const text = String(message.text || "").trim();
  if (!text) throw new Error("Select a post first.");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/i.test(to)) {
    throw new Error("Enter one email address, like name@company.com.");
  }

  const allowed = await chrome.permissions.contains({ origins: [apiOriginPattern(settings.apiBase)] });
  if (!allowed) throw new Error("Save Settings and allow access to the model host, then try again.");

  const instructions = "You draft a short email from a person who wants to be considered for a role. Use only facts in the job post and the sender background. Do not invent degrees, employers, or years of experience. Return one JSON object with keys subject and body. The body is plain text, with a greeting and a sign-off that uses the sender name.";
  const userContent = JSON.stringify({
    senderName: settings.senderName || settings.fromName || "The sender",
    senderBackground: settings.senderBackground || "",
    recipient: to,
    jobPost: text.slice(0, 4000)
  });
  if (isCursorHost(settings.apiBase)) return cursorDraft(settings, instructions + "\n\n" + userContent);

  const endpoint = chatEndpoint(settings.apiBase);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + settings.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: userContent }
      ]
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (typeof payload.error === "string" ? payload.error : payload.error?.message) || payload.message || response.statusText;
    if (/chat\/completions not found/i.test(String(detail))) {
      throw new Error("The API base URL has no chat route. In Settings, set it to the provider root ending in /v1, such as https://api.x.ai/v1 or https://api.openai.com/v1.");
    }
    throw new Error(detail || "The model request failed.");
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The model returned an empty draft.");
  return { ok: true, ...parseDraft(content) };
}

function cursorHeaders(apiKey, basic) {
  const key = String(apiKey || "").trim();
  const authorization = basic ? "Basic " + btoa(key + ":") : "Bearer " + key;
  return { Authorization: authorization, "Content-Type": "application/json" };
}

function apiDetail(payload, response) {
  return (typeof payload.error === "string" ? payload.error : payload.error?.message) || payload.message || response.statusText || "The model request failed.";
}

async function cursorDraft(settings, prompt) {
  const origin = "https://api.cursor.com";
  let headers = cursorHeaders(settings.apiKey, false);
  let response = await fetch(origin + "/v1/agents", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Job mail draft",
      mode: "plan",
      prompt: { text: "Reply with only the JSON object. Do not edit files or call tools.\n\n" + prompt }
    })
  });
  if (response.status === 401) {
    headers = cursorHeaders(settings.apiKey, true);
    response = await fetch(origin + "/v1/agents", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Job mail draft",
        mode: "plan",
        prompt: { text: "Reply with only the JSON object. Do not edit files or call tools.\n\n" + prompt }
      })
    });
  }
  const created = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiDetail(created, response));
  const agentId = created.agent?.id;
  const runId = created.run?.id || created.agent?.latestRunId;
  if (!agentId || !runId) throw new Error("Cursor did not start a draft.");
  try {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const runResponse = await fetch(origin + "/v1/agents/" + agentId + "/runs/" + runId, { headers });
      const run = await runResponse.json().catch(() => ({}));
      if (!runResponse.ok) throw new Error(apiDetail(run, runResponse));
      if (run.status === "FINISHED") {
        if (!run.result) throw new Error("Cursor returned an empty draft.");
        return { ok: true, ...parseDraft(run.result) };
      }
      if (run.status === "ERROR" || run.status === "CANCELLED" || run.status === "EXPIRED") {
        throw new Error(run.result || "Cursor could not draft the email.");
      }
    }
    throw new Error("Cursor is still writing the draft. Try again in a moment.");
  } finally {
    fetch(origin + "/v1/agents/" + agentId + "/archive", { method: "POST", headers }).catch(() => {});
  }
}

function parseDraft(content) {
  const trimmed = String(content).trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      const subject = oneLine(parsed.subject || "Question about the role", 140);
      const body = String(parsed.body || "").trim();
      if (body) return { subject, body: body.slice(0, 8000) };
    } catch (_error) {
      /* The text below is still usable as the message body. */
    }
  }
  return { subject: "Question about the role", body: trimmed.slice(0, 8000) };
}

function oneLine(value, max) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

async function sendEmail(message) {
  const settings = await loadSettings();
  const to = String(message.to || "").trim().toLowerCase();
  const subject = oneLine(message.subject, 140);
  const text = String(message.text || "").trim();
  if (!message.approved) throw new Error("Review the draft and confirm it before sending.");
  if (!to || !subject || !text) throw new Error("The recipient, subject, and message are required.");

  const relay = await postRelay(settings, "/send", {
    to,
    subject,
    text,
    attachment: message.attachment || null,
    smtp: smtpFrom(settings)
  });
  return { ok: true, id: relay.id || "" };
}

async function checkMail() {
  const settings = await loadSettings();
  const relay = await postRelay(settings, "/check", { smtp: smtpFrom(settings) });
  return { ok: true, message: relay.message || "SMTP login succeeded." };
}

function smtpFrom(settings) {
  return {
    host: settings.smtpHost,
    port: Number(settings.smtpPort),
    secure: Boolean(settings.smtpSecure),
    user: settings.smtpUser,
    pass: settings.smtpPass,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail
  };
}

async function postRelay(settings, path, body) {
  let pattern;
  try {
    pattern = relayOriginPattern(settings.relayUrl);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Relay URL is invalid.");
  }
  const allowed = await chrome.permissions.contains({ origins: [pattern] });
  if (!allowed) throw new Error("Allow the extension to reach 127.0.0.1, then try again.");
  const endpoint = settings.relayUrl.replace(/\/$/, "") + path;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": settings.relayToken
      },
      body: JSON.stringify(body)
    });
  } catch (_error) {
    throw new Error("The local mail relay is not running.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The mail relay rejected the request.");
  return payload;
}
