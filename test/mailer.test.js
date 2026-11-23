import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { formatFrom, validateCheck, validateSend } from "../mail-relay/validate.js";

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../extension/parse.js", import.meta.url), "utf8"), sandbox);
const parse = sandbox.JobMailerParse;

assert.deepEqual([...parse.extractEmails("Write to Ada <Ada.Lovelace@Example.org>, not jobs@linkedin.com.")], [
  "ada.lovelace@example.org"
]);
assert.deepEqual([...parse.extractEmails("logo@2x.png and photo@example.com")], []);
assert.deepEqual(
  [...parse.extractEmails("Email: recruiter14mfollowkiran@prasquare.comfeed and mason@innodel.comlooking")],
  ["recruiter14mfollowkiran@prasquare.com", "mason@innodel.com"]
);
assert.deepEqual([...parse.extractEmails("resumes to kevin@advancedameritech.com")], ["kevin@advancedameritech.com"]);
assert.deepEqual([...parse.extractEmails("kevin@\nadvancedameritech.com")], ["kevin@advancedameritech.com"]);
assert.deepEqual([...parse.extractEmails("kevin\u200B@advancedameritech.com")], ["kevin@advancedameritech.com"]);
assert.equal(parse.looksLikeJob("We are hiring a designer."), true);
assert.equal(parse.matchesKeywords("Remote contract role", "staff, remote"), true);
assert.equal(parse.matchesKeywords("Office role", "remote"), false);
assert.equal(parse.matchesKeywords("Any role", ""), true);
assert.equal(parse.matchesKeywords("Senior engineer, React and Angular", "Senior React, angular, full stock"), true);
assert.equal(parse.matchesKeywords("Full stack Angular role", "full stock"), false);
const sample = [
  "Feed post number 11",
  "Role: Lead Azure Cloud Security Engineer",
  "Location: Warren NJ 07059 (100% Onsite)",
  "regina@uniteditinc.com"
].join("\n");
assert.equal(parse.roleFrom(sample), "Lead Azure Cloud Security Engineer");
assert.equal(parse.locationFrom(sample), "Warren NJ 07059 (100% Onsite)");
assert.equal(parse.roleFrom("Hiring: AI/ML Engineer Intern\nLocation: Austin, TX 78744 (only local candidates max 30 miles) ...more"), "AI/ML Engineer Intern");
assert.equal(parse.locationFrom("Hiring: AI/ML Engineer Intern Location: Austin, TX 78744 ...more"), "Austin, TX 78744");

const smtp = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "ada",
  pass: "secret",
  fromName: "Ada Lovelace",
  fromEmail: "ada@example.com"
};

const message = validateSend({
  to: "jobs@company.test",
  subject: "Hello",
  text: "One message.",
  smtp
});
assert.equal(message.to, "jobs@company.test");
assert.equal(formatFrom(message.smtp), '"Ada Lovelace" <ada@example.com>');
assert.equal(message.attachment, null);
const withFile = validateSend({
  to: "jobs@company.test",
  subject: "Hello",
  text: "One message.",
  smtp,
  attachment: { filename: "resume.pdf", contentType: "application/pdf", content: Buffer.from("resume").toString("base64") }
});
assert.equal(withFile.attachment.filename, "resume.pdf");
assert.throws(() => validateSend({
  to: "jobs@company.test",
  subject: "Hello",
  text: "One message.",
  smtp,
  attachment: { filename: "..", contentType: "application/pdf", content: Buffer.from("x").toString("base64") }
}), /invalid/i);

assert.throws(() => validateSend({ ...message, to: "a@b.test\nBcc: x@y.test", smtp }), /single line|one email/i);
assert.throws(() => validateSend({ to: "one@test.com, two@test.com", subject: "Hi", text: "Body", smtp }), /one email/i);
assert.throws(() => validateCheck({ smtp: { ...smtp, host: "http://evil.test" } }), /hostname/i);
assert.throws(() => validateSend({ to: "one@test.com", subject: "Hi\nthere", text: "Body", smtp }), /single line/i);

console.log("mailer tests passed");
