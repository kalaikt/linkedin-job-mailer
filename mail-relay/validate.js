const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function validateSend(body) {
  if (!body || typeof body !== "object") throw new Error("Missing message.");
  const to = oneEmail(body.to, "Recipient");
  const subject = oneLine(body.subject, 140, "Subject");
  const text = String(body.text || "").replace(/\r\n/g, "\n").trim();
  if (!subject) throw new Error("Subject is required.");
  if (!text) throw new Error("Message is required.");
  if (text.length > 20000) throw new Error("Message is too long.");
  const smtp = validateSmtp(body.smtp);
  const attachment = validateAttachment(body.attachment);
  return { to, subject, text, smtp, attachment };
}

function validateAttachment(attachment) {
  if (!attachment) return null;
  if (typeof attachment !== "object") throw new Error("Attachment is invalid.");
  const filename = cleanFilename(attachment.filename);
  const content = String(attachment.content || "").replace(/\s+/g, "");
  if (!content || !/^[A-Za-z0-9+/=]+$/.test(content)) throw new Error("Attachment content is invalid.");
  const bytes = Buffer.from(content, "base64").length;
  if (bytes > 5 * 1024 * 1024) throw new Error("Attachment must be 5 MB or smaller.");
  const contentType = oneLine(attachment.contentType || "application/octet-stream", 120, "Attachment type");
  return { filename, content, contentType };
}

function cleanFilename(value) {
  const base = String(value || "").split(/[/\\]/).pop().replace(/[^\w.\- ()]/g, "").trim();
  if (!base || base === "." || base === "..") throw new Error("Attachment name is invalid.");
  if (base.length > 120) throw new Error("Attachment name is too long.");
  return base;
}

export function validateCheck(body) {
  if (!body || typeof body !== "object") throw new Error("Missing mail settings.");
  return { smtp: validateSmtp(body.smtp) };
}

function validateSmtp(smtp) {
  if (!smtp || typeof smtp !== "object") throw new Error("SMTP settings are required.");
  const host = oneLine(smtp.host, 253, "SMTP host");
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !host.includes(".")) {
    throw new Error("SMTP host must be a hostname.");
  }
  const port = Number(smtp.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP port is invalid.");
  const user = oneLine(smtp.user, 200, "SMTP username").toLowerCase();
  const pass = String(smtp.pass || "").replace(/\s+/g, "");
  if (!pass) throw new Error("SMTP password is required.");
  if (host === "smtp.gmail.com" && !/^[a-z0-9]{16}$/i.test(pass)) {
    throw new Error("Use a Gmail app password: 16 letters from https://myaccount.google.com/apppasswords. The normal Gmail password is rejected.");
  }
  const fromEmail = oneEmail(smtp.fromEmail, "From email");
  const fromName = oneLine(smtp.fromName || "", 120, "From name", true).replace(/["<>]/g, "");
  return {
    host,
    port,
    secure: Boolean(smtp.secure),
    user,
    pass,
    fromEmail,
    fromName
  };
}

export function formatFrom(smtp) {
  if (!smtp.fromName) return smtp.fromEmail;
  return `"${smtp.fromName}" <${smtp.fromEmail}>`;
}

function oneEmail(value, label) {
  const email = oneLine(value, 200, label).toLowerCase();
  if (!EMAIL_RE.test(email) || email.includes(",") || email.includes(";")) {
    throw new Error(label + " must be one email address.");
  }
  return email;
}

function oneLine(value, max, label, optional) {
  const text = String(value || "");
  if (/[\r\n]/.test(text)) throw new Error(label + " must be a single line.");
  const trimmed = text.trim();
  if (!trimmed && !optional) throw new Error(label + " is required.");
  if (trimmed.length > max) throw new Error(label + " is too long.");
  return trimmed;
}
