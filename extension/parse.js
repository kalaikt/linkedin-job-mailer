(function (root) {
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const BLOCKED_DOMAINS = [
    "linkedin.com",
    "licdn.com",
    "example.com",
    "email.com",
    "domain.com",
    "sentry.io",
    "wixpress.com"
  ];
  const JOB_RE = /\b(hiring|hire|job|jobs|role|position|opening|openings|apply|recruiter|recruiters|recruiting|vacancy|candidate|c2c|consultant|consultants|bench|hotlist|requirement|requirements)\b/i;

  const TLDS = ["com", "org", "net", "edu", "io", "ai", "co", "us", "uk", "in", "dev", "info", "biz", "me", "app", "cloud", "tech", "xyz", "jobs"];

  function trimGluedEmail(email) {
    const at = email.lastIndexOf("@");
    if (at < 1) return "";
    const local = email.slice(0, at).replace(/^[^a-z0-9]+/i, "");
    const domain = email.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    if (dot < 1 || !local) return "";
    const name = domain.slice(0, dot).replace(/[^a-z0-9.-]/gi, "");
    let suffix = domain.slice(dot + 1).toLowerCase();
    const tld = TLDS.find((item) => suffix === item || (suffix.startsWith(item) && /^[a-z]+$/.test(suffix.slice(item.length))));
    if (tld) suffix = tld;
    if (!/^[a-z]{2,24}$/.test(suffix) || !/^[a-z0-9.-]+$/i.test(name)) return "";
    return local.toLowerCase() + "@" + name.toLowerCase() + "." + suffix;
  }

  function extractEmails(text) {
    const source = String(text || "")
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
      .replace(/([a-z0-9._%+-]{1,64})\s*@\s*([a-z0-9.-]{1,255})\s*\.\s*([a-z]{2,24})\b/gi, "$1@$2.$3");
    const found = source.match(EMAIL_RE) || [];
    const out = [];
    const seen = new Set();
    for (const raw of found) {
      const email = trimGluedEmail(raw.toLowerCase().replace(/[),.;:]+$/, ""));
      const domain = email.split("@")[1] || "";
      if (!domain.includes(".")) continue;
      if (BLOCKED_DOMAINS.some((item) => domain === item || domain.endsWith("." + item))) continue;
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(email)) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
    return out;
  }

  function looksLikeJob(text) {
    return JOB_RE.test(String(text || ""));
  }

  function keywordList(keywords) {
    return String(keywords || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  function matchesKeywords(text, keywords) {
    const list = keywordList(keywords);
    if (list.length === 0) return true;
    const haystack = String(text || "").toLowerCase();
    return list.some((phrase) => {
      if (haystack.includes(phrase)) return true;
      const words = phrase.split(/[^a-z0-9+#]+/).filter((word) => word.length >= 2);
      return words.length > 1 && words.every((word) => haystack.includes(word));
    });
  }

  function cleanField(value) {
    return String(value || "")
      .replace(/\s*(?:\.{2,}|…)\s*more\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
  }

  function captureField(text, labels) {
    const source = String(text || "");
    const label = labels.join("|");
    const line = source.match(new RegExp("(?:^|\\n)\\s*(?:" + label + ")\\s*[:\\-]\\s*([^\\n]+)", "i"));
    if (line) return cleanField(line[1]);
    const inline = source.match(new RegExp("(?:^|\\s)(?:" + label + ")\\s*[:\\-]\\s*(.+?)(?=\\s+(?:job title|position|hiring|opening|role|work location|job location|location|loc|key skills|experience|duration|work mode|interview)\\s*[:\\-]|\\s+#|\\n|$)", "i"));
    return inline ? cleanField(inline[1]) : "";
  }

  function roleFrom(text) {
    const labeled = captureField(text, ["job title", "position", "hiring", "opening", "role"]);
    if (labeled) return labeled;
    const line = String(text || "")
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item.length > 8 && !/^feed post\b/i.test(item) && !item.startsWith("#") && !item.includes("@") && !/^(like|comment|repost|send|follow)$/i.test(item));
    return (line || "Job post").slice(0, 90);
  }

  function locationFrom(text) {
    return captureField(text, ["work location", "job location", "location", "loc"]);
  }

  function titleFrom(text) {
    return roleFrom(text);
  }

  root.JobMailerParse = {
    extractEmails,
    looksLikeJob,
    keywordList,
    matchesKeywords,
    titleFrom,
    roleFrom,
    locationFrom
  };
})(globalThis);
