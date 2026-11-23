const DEFAULTS = globalThis.JOB_MAILER_DEFAULTS;
const PRESETS = globalThis.JOB_MAILER_PRESETS;
const form = document.querySelector("#settings");
const status = document.querySelector("#status");
const provider = document.querySelector("#provider");

const fields = [
  "provider", "model", "apiBase", "apiKey", "smtpHost", "smtpPort", "smtpUser",
  "smtpPass", "fromName", "fromEmail", "relayUrl", "relayToken", "keywords",
  "senderName", "senderBackground", "groupUrl"
];

provider.addEventListener("change", () => {
  const preset = PRESETS[provider.value];
  if (!preset || provider.value === "custom") return;
  document.querySelector("#model").value = preset.model;
  document.querySelector("#apiBase").value = preset.apiBase;
});

const smtpPassInput = document.querySelector("#smtpPass");
const toggleSmtpPass = document.querySelector("#toggleSmtpPass");
let smtpPassTyped = null;
smtpPassInput.addEventListener("input", () => {
  smtpPassTyped = smtpPassInput.value;
});
toggleSmtpPass.addEventListener("click", () => {
  const showing = smtpPassInput.type === "password";
  smtpPassInput.type = showing ? "text" : "password";
  toggleSmtpPass.setAttribute("aria-pressed", showing ? "true" : "false");
  toggleSmtpPass.setAttribute("aria-label", showing ? "Hide password" : "Show password");
});

document.querySelector("#test").addEventListener("click", () => {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    setStatus("Open this page from the extension’s settings.", "error");
    return;
  }
  const settings = readForm();
  if (smtpPassTyped !== null) settings.smtpPass = smtpPassTyped;
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass || !settings.fromEmail) {
    setStatus("Fill in the SMTP host, username, app password, and from email. Then test again.", "error");
    return;
  }
  setStatus("Checking the mailbox…");
  chrome.storage.local.set({
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpSecure: settings.smtpSecure,
    smtpUser: settings.smtpUser,
    smtpPass: settings.smtpPass,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    relayUrl: settings.relayUrl,
    relayToken: settings.relayToken
  }, () => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, "error");
      return;
    }
    chrome.runtime.sendMessage({ type: "checkMail" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, "error");
      return;
    }
    if (!response?.ok) {
      setStatus(response?.error || "Mail connection failed.", "error");
      return;
    }
    setStatus(response.message || "SMTP login succeeded.", "ok");
    });
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const settings = readForm();
  const error = validate(settings);
  if (error) {
    setStatus(error, "error");
    return;
  }
  if (!globalThis.chrome?.storage?.local || !globalThis.chrome?.permissions) {
    setStatus("Open this page from the extension’s settings.", "error");
    return;
  }
  const pattern = new URL(settings.apiBase).origin + "/*";
  chrome.permissions.request({ origins: [pattern] }, (granted) => {
    if (!granted) {
      setStatus("Allow access to the model host to save.", "error");
      return;
    }
    chrome.storage.local.set(settings, () => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, "error");
        return;
      }
      setStatus("Saved in this browser.", "ok");
    });
  });
});

function apply(settings) {
  const merged = { ...DEFAULTS, ...settings };
  if (!String(merged.relayToken || "").trim()) merged.relayToken = DEFAULTS.relayToken;
  for (const field of fields) {
    const input = document.querySelector("#" + field);
    if (input) input.value = merged[field] ?? "";
  }
  document.querySelector("#smtpSecure").value = merged.smtpSecure ? "true" : "false";
}

function load() {
  apply(DEFAULTS);
  if (!globalThis.chrome?.storage?.local) {
    setStatus("Open this page from the extension’s Settings to save. The form below shows the fields the extension stores in this browser.", "error");
    return;
  }
  chrome.storage.local.get(DEFAULTS, (stored) => apply({ ...DEFAULTS, ...stored }));
}

function readForm() {
  const settings = {};
  for (const field of fields) {
    settings[field] = document.querySelector("#" + field).value.trim();
  }
  settings.smtpPort = Number(settings.smtpPort);
  settings.smtpSecure = document.querySelector("#smtpSecure").value === "true";
  settings.relayToken = cleanRelayToken(settings.relayToken);
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

function validate(settings) {
  if (!settings.model) return "Enter a model name.";
  let api;
  try {
    api = new URL(settings.apiBase);
  } catch (_error) {
    return "Enter a valid model URL.";
  }
  if (api.protocol !== "https:") return "The model URL must start with https://";
  let relay;
  try {
    relay = new URL(settings.relayUrl);
  } catch (_error) {
    return "Enter a valid relay URL.";
  }
  if (relay.protocol !== "http:" || relay.hostname !== "127.0.0.1") {
    return "The relay URL must stay on http://127.0.0.1.";
  }
  if (!Number.isInteger(settings.smtpPort) || settings.smtpPort < 1 || settings.smtpPort > 65535) {
    return "Enter an SMTP port from 1 to 65535.";
  }
  if (settings.groupUrl) {
    try {
      const group = new URL(settings.groupUrl);
      const linkedin = group.protocol === "https:" && (group.hostname === "www.linkedin.com" || group.hostname === "linkedin.com");
      if (!linkedin) return "The group URL must be an https LinkedIn page.";
    } catch (_error) {
      return "Enter a valid LinkedIn URL.";
    }
  }
  if (settings.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.fromEmail)) {
    return "Enter a valid from email.";
  }
  return "";
}

function setStatus(message, kind) {
  status.textContent = message;
  status.className = "status" + (kind ? " " + kind : "");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", load);
} else {
  load();
}
