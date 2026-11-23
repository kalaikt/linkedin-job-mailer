globalThis.JOB_MAILER_DEFAULTS = {
  provider: "openai",
  model: "gpt-4.1-mini",
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  fromName: "",
  fromEmail: "",
  relayUrl: "http://127.0.0.1:8787",
  relayToken: "the same token",
  keywords: "",
  senderName: "",
  senderBackground: "",
  groupUrl: ""
};

globalThis.JOB_MAILER_PRESETS = {
  openai: { model: "gpt-4.1-mini", apiBase: "https://api.openai.com/v1" },
  xai: { model: "grok-4", apiBase: "https://api.x.ai/v1" },
  groq: { model: "llama-3.3-70b-versatile", apiBase: "https://api.groq.com/openai/v1" },
  openrouter: { model: "openai/gpt-4.1-mini", apiBase: "https://openrouter.ai/api/v1" },
  cursor: { model: "default", apiBase: "https://api.cursor.com" },
  custom: { model: "", apiBase: "" }
};
