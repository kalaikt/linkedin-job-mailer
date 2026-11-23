import http from "node:http";
import { pathToFileURL } from "node:url";
import nodemailer from "nodemailer";
import { formatFrom, validateCheck, validateSend } from "./validate.js";

const PORT = Number(process.env.PORT || 8787);
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (res.headersSent) return;
      const message = explainMailError(error);
      sendJson(res, clientError(message) ? 400 : 502, { error: message });
    });
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log("Mail relay listening on http://127.0.0.1:" + PORT);
  });
}

async function handleRequest(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "POST" || (req.url !== "/send" && req.url !== "/check")) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const body = await readJson(req);
  if (req.url === "/check") {
    const { smtp } = validateCheck(body);
    await verifySmtp(smtp);
    sendJson(res, 200, { ok: true, message: "SMTP login succeeded." });
    return;
  }

  const message = validateSend(body);
  const info = await deliver(message);
  console.log("Sent one message to " + message.to);
  sendJson(res, 200, { ok: true, id: info.messageId || "" });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8000000) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (_error) {
        reject(new Error("Request body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function transporterFor(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

function verifySmtp(smtp) {
  return transporterFor(smtp).verify();
}

function deliver(message) {
  const mail = {
    from: formatFrom(message.smtp),
    to: message.to,
    subject: message.subject,
    text: message.text
  };
  if (message.attachment) {
    mail.attachments = [{
      filename: message.attachment.filename,
      content: Buffer.from(message.attachment.content, "base64"),
      contentType: message.attachment.contentType
    }];
  }
  return transporterFor(message.smtp).sendMail(mail);
}

function explainMailError(error) {
  const message = error instanceof Error ? error.message : "Mail relay failed.";
  if (/535|BadCredentials|Username and Password not accepted/i.test(message)) {
    return "Gmail rejected the username or password. Set SMTP username to your full Gmail address and SMTP password to a new 16-letter app password from https://myaccount.google.com/apppasswords. Click Save, then test again.";
  }
  return message;
}

function clientError(message) {
  return /required|invalid|must be|too long|too large|JSON|Missing/i.test(message);
}

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data)
  });
  res.end(data);
}
