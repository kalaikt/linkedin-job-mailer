(function () {
  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function plain(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function visible(el) {
    return Boolean(el && el.getClientRects && el.getClientRects().length);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function skipSubtree(el) {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG") return true;
    if (tag === "ASIDE" || tag === "NAV" || tag === "FOOTER") return true;
    const role = el.getAttribute && el.getAttribute("role");
    if (role === "navigation" || role === "contentinfo") return true;
    if (el.id === "global-nav" || (el.classList && el.classList.contains("global-nav"))) return true;
    return false;
  }

  function renderedText(el) {
    if (!el) return "";
    const inner = cleanText(el.innerText);
    const content = cleanText(el.textContent);
    return content.length > inner.length ? content : inner;
  }

  function textSize(el) {
    return plain(el.textContent).length;
  }

  function walk(node, visit) {
    if (!node) return;
    const kids = node.children ? [...node.children] : [];
    for (const child of kids) {
      if (child.nodeType !== 1 || skipSubtree(child)) continue;
      visit(child);
      if (child.shadowRoot) walk(child.shadowRoot, visit);
      walk(child, visit);
    }
  }

  function feedRoot() {
    let best = null;
    let bestLen = 0;
    for (const el of document.querySelectorAll("main, [role='main']")) {
      if (skipSubtree(el)) continue;
      const len = Math.max(plain(el.innerText).length, plain(el.textContent).length);
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    }
    return bestLen >= 80 ? best : document.body;
  }

  function ownText(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue || "";
    }
    return cleanText(text);
  }

  function moreLabel(el) {
    const aria = cleanText(el.getAttribute("aria-label") || "").toLowerCase();
    const own = ownText(el).toLowerCase().replace(/\s+/g, "");
    const shown = cleanText(el.innerText || "").toLowerCase().replace(/\s+/g, "");
    const short = shown.length <= 24 ? shown : own;
    return { aria, short };
  }

  function isMoreButton(button) {
    if (!button || button.dataset.jobMailerExpanded === "1") return false;
    const { aria, short } = moreLabel(button);
    const className = String(button.className || "").toLowerCase();
    const blob = aria + " " + short;
    if (blob.includes("comment") || blob.includes("reply") || blob.includes("see less") || blob.includes("show more")) return false;
    if (className.includes("see-more") || className.includes("inline-show-more") || className.includes("show-more-less")) return true;
    if (aria.includes("see more") || aria.includes("…more") || aria.includes("...more")) return true;
    return short === "more" || short === "…more" || short === "...more" || short === "seemore" || short.startsWith("…more") || short.startsWith("...more");
  }

  function press(el) {
    const target = el.closest("button, [role='button']") || el;
    target.dataset.jobMailerExpanded = "1";
    el.dataset.jobMailerExpanded = "1";
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const EventType = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
      target.dispatchEvent(new EventType(type, opts));
    }
    if (typeof target.click === "function") target.click();
  }

  function unclamp(root) {
    walk(root, (el) => {
      const style = getComputedStyle(el);
      if (style.webkitLineClamp && style.webkitLineClamp !== "none") {
        el.style.webkitLineClamp = "unset";
        el.style.maxHeight = "none";
        el.style.overflow = "visible";
      }
    });
  }

  function leafNodes(nodes) {
    return nodes.filter((el) => !nodes.some((other) => other !== el && el.contains(other)));
  }

  function isFeedList(el) {
    const cls = String(el.className || "");
    return cls.includes("scaffold-finite-scroll") || cls.includes("feed-container");
  }

  function pickCards(root) {
    const nodes = [];
    walk(root, (el) => {
      const tag = el.tagName;
      if (tag !== "DIV" && tag !== "ARTICLE" && tag !== "LI" && tag !== "SECTION" && !tag.includes("-")) return;
      const len = textSize(el);
      if (len < 80 || len > 12000) return;
      nodes.push(el);
    });
    const leaves = leafNodes(nodes);
    const used = new Set();
    const cards = [];
    const groups = new Map();
    for (const el of leaves) {
      const parent = el.parentElement;
      if (!parent || skipSubtree(parent) || isFeedList(parent)) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    }
    for (const [parent, kids] of groups) {
      if (kids.length < 2 || textSize(parent) > 8000) continue;
      cards.push(parent);
      for (const kid of kids) used.add(kid);
    }
    for (const el of leaves) {
      if (!used.has(el)) cards.push(el);
    }
    return cards.map(withEmailContext);
  }

  function withEmailContext(el) {
    let best = el;
    let current = el;
    while (current.parentElement) {
      const parent = current.parentElement;
      if (parent === document.body || skipSubtree(parent) || isFeedList(parent)) break;
      if (textSize(parent) > 12000) break;
      const bigKids = [...parent.children].filter((kid) => kid.nodeType === 1 && textSize(kid) >= 80);
      if (bigKids.length > 1) break;
      best = parent;
      current = parent;
    }
    return best;
  }

  function emailScope(el) {
    let best = el;
    let current = el;
    while (current && current.parentElement) {
      const parent = current.parentElement;
      if (!parent || parent === document.body || skipSubtree(parent) || isFeedList(parent)) break;
      if (textSize(parent) > 15000) break;
      const urns = parent.querySelectorAll("[data-urn*='activity'], [data-id*='activity']");
      if (urns.length > 1) break;
      best = parent;
      if ((parent.innerText || parent.textContent || "").includes("@")) break;
      const bigKids = [...parent.children].filter((kid) => textSize(kid) >= 200);
      if (bigKids.length > 1) break;
      current = parent;
    }
    return best;
  }

  function emailsFor(el, parse) {
    const scope = emailScope(el);
    const bits = [scope.innerText || "", scope.textContent || "", scope.getAttribute("aria-label") || ""];
    const html = scope.innerHTML || "";
    if (html.length && html.length < 250000) bits.push(html);
    const nodes = scope.querySelectorAll ? scope.querySelectorAll("a[href], img[alt], [aria-label]") : [];
    for (const node of nodes) {
      const href = node.getAttribute("href") || "";
      bits.push(href);
      try {
        bits.push(decodeURIComponent(href.replace(/&amp;/g, "&")));
      } catch (_error) {
        bits.push(href);
      }
      bits.push(node.textContent || "");
      bits.push(node.getAttribute("alt") || "");
      bits.push(node.getAttribute("aria-label") || "");
    }
    return parse.extractEmails(bits.join("\n"));
  }

  function isPageChrome(text) {
    const compact = plain(text).toLowerCase();
    return /beginning of dialog|escape will cancel|skip backward|skip forward|textcolor|current time|playback|unmute|closed caption|volume slider/.test(compact);
  }

  function compact(value) {
    return plain(value).toLowerCase().replace(/[^a-z0-9@+]+/g, "");
  }

  function boxHeight(el) {
    if (!el || !el.getBoundingClientRect) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width < 80) return 0;
    return rect.height;
  }

  function looksLikePost(el) {
    const urn = (el.getAttribute && (el.getAttribute("data-urn") || el.getAttribute("data-id"))) || "";
    const cls = String(el.className || "");
    const activity = /activity|ugcPost|groupPost/i.test(urn);
    return activity
      || /feed-shared-update|occludable-update|search-result|entity-result|reusable-search__result|groups-post/.test(cls)
      || el.tagName === "ARTICLE"
      || (el.tagName === "LI" && activity);
  }

  function postRoot(el) {
    let current = el;
    let best = el;
    while (current && current.nodeType === 1) {
      if (current === document.body || isFeedList(current)) break;
      if (looksLikePost(current)) {
        const rect = current.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 48 && rect.height < 1400) return current;
        best = current;
      }
      const parent = current.parentElement || (current.getRootNode && current.getRootNode().host);
      if (!parent || parent === current) break;
      current = parent;
    }
    return best;
  }

  let postSerial = 0;

  function stamp(el) {
    const card = postRoot(el);
    if (!card.dataset.jobMailerPost) card.dataset.jobMailerPost = "p" + (++postSerial);
    return card.dataset.jobMailerPost;
  }

  function needleFrom(el) {
    const lines = cleanText(el.innerText || "").split("\n").map((line) => line.trim());
    const useful = lines.filter((line) => line.length >= 24 && !isPageChrome(line) && !/^(like|comment|repost|send|follow)$/i.test(line));
    useful.sort((left, right) => right.length - left.length);
    return (useful[0] || plain(el.innerText).slice(0, 90)).slice(0, 110);
  }

  function urnFor(el) {
    const card = postRoot(el);
    const tagged = (card.getAttribute && (card.getAttribute("data-urn") || card.getAttribute("data-id"))) || "";
    if (/activity|ugcPost|groupPost/i.test(tagged)) return tagged;
    const link = card.querySelector && card.querySelector("a[href*='urn:li:activity'], a[href*='activity']");
    const href = link ? link.getAttribute("href") || "" : "";
    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch (_error) {
      decoded = href;
    }
    const match = decoded.match(/urn:li:(?:activity|ugcPost|groupPost):\d+/);
    return match ? match[0] : "";
  }

  function postsFromElements(cards, parse) {
    const posts = [];
    const seen = new Set();
    for (const el of cards) {
      const card = postRoot(el);
      const text = renderedText(card).slice(0, 8000);
      if (text.length < 80 || isPageChrome(text)) continue;
      const key = plain(text).slice(0, 160);
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push({
        title: parse.titleFrom(text),
        text,
        emails: emailsFor(card, parse),
        urn: urnFor(card),
        needle: needleFrom(card),
        mark: stamp(card)
      });
      if (posts.length >= 80) break;
    }
    return posts.filter((post) => !posts.some((other) => {
      if (other === post || other.text.length >= post.text.length) return false;
      if (!post.text.includes(other.text.slice(0, 80))) return false;
      return post.emails.every((email) => other.emails.includes(email));
    }));
  }

  function postsFromText(text, parse) {
    const cleaned = cleanText(text);
    if (cleaned.length < 80) return [];
    const parts = cleaned
      .split(/\n(?:Like|Comment|Repost)\n/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 80);
    const chunks = (parts.length >= 2 ? parts : [cleaned]).slice(0, 80);
    return chunks.map((chunk) => {
      const body = chunk.slice(0, 8000);
      if (isPageChrome(body)) return null;
      return { title: parse.titleFrom(body), text: body, emails: parse.extractEmails(body), urn: "", needle: plain(body).slice(0, 90) };
    }).filter(Boolean);
  }

  function addLooseEmails(posts, root, parse) {
    const pageText = renderedText(root);
    const known = new Set(posts.flatMap((post) => post.emails));
    for (const email of parse.extractEmails(pageText)) {
      if (known.has(email)) continue;
      const at = pageText.toLowerCase().indexOf(email);
      const text = pageText.slice(Math.max(0, at - 500), Math.min(pageText.length, at + email.length + 300)).trim();
      const body = text.slice(0, 8000);
      if (isPageChrome(body)) continue;
      posts.push({
        title: parse.titleFrom(body),
        text: body,
        emails: [email],
        urn: "",
        needle: plain(body).slice(0, 90)
      });
      known.add(email);
      if (posts.length >= 80) break;
    }
    return posts;
  }

  function overflowScroller(root) {
    let best = null;
    let bestRoom = 0;
    walk(root, (el) => {
      const room = el.scrollHeight - el.clientHeight;
      if (room > 400 && el.clientHeight > 240 && room > bestRoom) {
        best = el;
        bestRoom = room;
      }
    });
    return best;
  }

  async function expandOnce(root) {
    unclamp(root);
    for (let round = 0; round < 3; round += 1) {
      const buttons = [];
      walk(root, (el) => {
        if (!visible(el) || !isMoreButton(el)) return;
        buttons.push(el);
      });
      const leaves = buttons.filter((el) => !buttons.some((other) => other !== el && el.contains(other)));
      if (leaves.length === 0) break;
      for (const button of leaves.slice(0, 50)) press(button);
      await sleep(700);
    }
  }

  function remember(found, post) {
    const key = plain(post.text).slice(0, 140) || post.emails[0] || "";
    if (!key) return;
    const current = found.get(key);
    if (!current) {
      found.set(key, post);
      return;
    }
    const emails = [...new Set([...current.emails, ...post.emails])];
    if (post.text.length > current.text.length) {
      found.set(key, {
        ...post,
        emails,
        urn: post.urn || current.urn || "",
        needle: post.needle || current.needle || "",
        mark: post.mark || current.mark || ""
      });
    } else {
      current.emails = emails;
      if (!current.urn && post.urn) current.urn = post.urn;
      if (!current.mark && post.mark) current.mark = post.mark;
      if (!current.needle && post.needle) current.needle = post.needle;
    }
  }

  function harvest(found, root, parse) {
    let posts = postsFromElements(pickCards(root), parse);
    if (posts.length === 0) posts = postsFromText(renderedText(root), parse);
    posts = addLooseEmails(posts, root, parse);
    for (const post of posts) remember(found, post);
  }

  async function scrollForMore(root) {
    const beforeY = window.scrollY;
    const beforeH = document.documentElement.scrollHeight;
    const distance = Math.max(700, Math.floor(window.innerHeight * 0.9));
    const cards = root.querySelectorAll("article, .feed-shared-update-v2, [data-urn*='activity'], [data-id*='activity']");
    const last = cards[cards.length - 1];
    if (last && last.scrollIntoView) last.scrollIntoView({ block: "end" });
    window.scrollBy(0, distance);
    const scroller = overflowScroller(root);
    if (scroller) scroller.scrollTop += distance;
    await sleep(800);
    return window.scrollY > beforeY + 40 || document.documentElement.scrollHeight > beforeH + 40;
  }

  function finish(found) {
    const posts = [...found.values()];
    return posts.filter((post) => !posts.some((other) => {
      if (other === post || other.text.length >= post.text.length) return false;
      if (!post.text.includes(other.text.slice(0, 80))) return false;
      return post.emails.every((email) => other.emails.includes(email));
    })).slice(0, 80);
  }

  async function scanPage() {
    const parse = globalThis.JobMailerParse;
    const root = feedRoot();
    const startX = window.scrollX;
    const startY = window.scrollY;
    const found = new Map();
    let idle = 0;
    try {
      for (let step = 0; step < 12 && found.size < 50; step += 1) {
        await expandOnce(root);
        const before = found.size;
        harvest(found, root, parse);
        if (found.size >= 50) break;
        const moved = await scrollForMore(root);
        harvest(found, root, parse);
        if (found.size === before && !moved) idle += 1;
        else idle = 0;
        if (idle >= 2) break;
      }
      return finish(found);
    } finally {
      window.scrollTo(startX, startY);
      if (globalThis.__jobMailerDecorate) globalThis.__jobMailerDecorate();
    }
  }

  let showGeneration = 0;

  function hidden(el) {
    if (!el || el.closest(".visually-hidden, .a11y-text")) return true;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return true;
    const rect = el.getBoundingClientRect();
    return rect.width < 40 || rect.height < 12;
  }

  function clues(message) {
    const email = compact(message && message.email);
    const needle = compact(message && message.needle).slice(0, 90);
    const title = compact(message && message.title).slice(0, 48);
    const urn = String((message && message.urn) || "");
    const activity = (urn.match(/\d{10,}/) || [])[0] || "";
    return { email, needle, title, activity };
  }

  function haystack(el) {
    return compact((el.innerText || "") + " " + (el.textContent || "") + " " + (el.innerHTML || "").slice(0, 4000));
  }

  function matchesClue(el, clue) {
    if (!el || hidden(el)) return false;
    const text = haystack(el);
    if (text.length < 24) return false;
    if (clue.email && text.includes(clue.email)) return true;
    if (clue.activity && text.includes(clue.activity)) return true;
    if (clue.needle.length >= 18 && text.includes(clue.needle)) return true;
    if (clue.title.length >= 12 && text.includes(clue.title)) return true;
    return false;
  }

  function locate(message) {
    const clue = clues(message);
    const mark = message && message.mark;
    if (mark) {
      const stamped = document.querySelector("[data-job-mailer-post='" + mark + "']");
      if (stamped && !hidden(stamped)) return stamped;
      let found = null;
      walk(document.body, (el) => {
        if (!found && el.dataset && el.dataset.jobMailerPost === mark && !hidden(el)) found = el;
      });
      if (found) return found;
    }
    if (clue.activity) {
      const selector = "[data-urn*='" + clue.activity + "'], [data-id*='" + clue.activity + "'], a[href*='" + clue.activity + "']";
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (!hidden(node)) return node;
      }
    }
    let best = null;
    let bestSize = Infinity;
    walk(document.body, (el) => {
      const tag = el.tagName;
      if (tag !== "DIV" && tag !== "ARTICLE" && tag !== "LI" && tag !== "SECTION" && tag !== "P") return;
      if (!matchesClue(el, clue)) return;
      const size = textSize(el);
      if (size < 40 || size >= bestSize) return;
      best = el;
      bestSize = size;
    });
    return best;
  }

  function reveal(el) {
    const card = postRoot(el);
    const target = card.getBoundingClientRect().height > 1400 ? el : card;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    let node = target.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40) {
        const parentRect = node.getBoundingClientRect();
        const box = target.getBoundingClientRect();
        node.scrollTop += box.top - parentRect.top - Math.max(72, (node.clientHeight - Math.min(box.height, node.clientHeight)) / 3);
      }
      node = node.parentElement;
    }
    const box = target.getBoundingClientRect();
    if (box.top < 70 || box.bottom > window.innerHeight - 16) {
      window.scrollBy(0, box.top - 96);
    }
    const previous = document.querySelector("[data-job-mailer-highlight='1']");
    if (previous && previous !== target) {
      previous.style.removeProperty("outline");
      previous.style.removeProperty("outline-offset");
      previous.style.removeProperty("box-shadow");
      previous.removeAttribute("data-job-mailer-highlight");
    }
    target.setAttribute("data-job-mailer-highlight", "1");
    target.style.setProperty("outline", "4px solid #0f5f5c", "important");
    target.style.setProperty("outline-offset", "4px", "important");
    target.style.setProperty("box-shadow", "0 0 0 6px rgba(15, 95, 92, 0.35)", "important");
    setTimeout(() => {
      if (target.getAttribute("data-job-mailer-highlight") !== "1") return;
      target.style.removeProperty("outline");
      target.style.removeProperty("outline-offset");
      target.style.removeProperty("box-shadow");
      target.removeAttribute("data-job-mailer-highlight");
    }, 4000);
  }

  async function showPost(message) {
    const generation = ++showGeneration;
    let el = locate(message);
    if (el) {
      reveal(el);
      return { ok: true };
    }
    await sleep(200);
    const root = feedRoot();
    let idle = 0;
    for (let step = 0; step < 24; step += 1) {
      if (generation !== showGeneration) return { ok: false, error: "Opened a different post." };
      el = locate(message);
      if (el) {
        reveal(el);
        return { ok: true };
      }
      const beforeY = window.scrollY;
      await scrollForMore(root);
      if (window.scrollY <= beforeY + 40) idle += 1;
      else idle = 0;
      if (idle >= 2) break;
    }
    return { ok: false, error: "That post is not on this page anymore. Scan again." };
  }

  function isControl(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    const role = el.getAttribute && el.getAttribute("role");
    return tag === "BUTTON" || role === "button";
  }

  function isOverflowMenu(el) {
    if (!isControl(el) || el.classList.contains("job-mailer-send")) return false;
    if (el.closest && el.closest("#global-nav, nav, header, aside, #job-mailer-panel")) return false;
    const label = ((el.getAttribute && el.getAttribute("aria-label")) || "").toLowerCase();
    if (/comment|reply/.test(label)) return false;
    const cls = String(el.className || "").toLowerCase();
    if (/control menu|more actions|options for this|open menu/.test(label)) return true;
    const box = el.getBoundingClientRect();
    if ((cls.includes("control-menu") || cls.includes("feed-shared-control-menu")) && box.width > 0 && box.width <= 64 && box.height <= 64) return true;
    return false;
  }

  function samePost(left, right) {
    const a = postRoot(left);
    const b = postRoot(right);
    return a === b || a.contains(right) || b.contains(left);
  }

  function preferMenu(candidate, current) {
    const labelOf = (el) => ((el.getAttribute && el.getAttribute("aria-label")) || "").toLowerCase();
    const labeled = (el) => /control menu|more actions|open menu/.test(labelOf(el));
    if (labeled(candidate) !== labeled(current)) return labeled(candidate);
    const candidateBox = candidate.getBoundingClientRect();
    const currentBox = current.getBoundingClientRect();
    if (Math.abs(candidateBox.width - currentBox.width) > 8) return candidateBox.width < currentBox.width;
    return candidateBox.right > currentBox.right;
  }

  function oneMenuEach(menus) {
    const outer = menus.filter((menu) => !menus.some((other) => other !== menu && other.contains(menu)));
    const kept = [];
    for (const menu of outer) {
      const index = kept.findIndex((other) => samePost(other, menu));
      if (index < 0) kept.push(menu);
      else if (preferMenu(menu, kept[index])) kept[index] = menu;
    }
    return kept;
  }

  function clips(el) {
    const style = getComputedStyle(el);
    return /(hidden|clip|auto|scroll)/.test(style.overflowY) || /(hidden|clip)/.test(style.overflow);
  }

  function mailAnchor(menu) {
    let node = menu.parentElement;
    let fallback = node;
    while (node && node !== document.body && !isFeedList(node)) {
      const box = node.getBoundingClientRect();
      if (box.width < 16 || box.height < 16 || box.height > 1100 || box.width > window.innerWidth - 4) break;
      fallback = node;
      const menuBox = menu.getBoundingClientRect();
      if (!clips(node) && box.height + 8 >= menuBox.height && box.width + 8 >= menuBox.width) return node;
      if (box.width > 240 && box.height > 70) return node;
      node = node.parentElement || (node.getRootNode && node.getRootNode().host);
    }
    return fallback || menu.parentElement;
  }

  function findOverflow(card) {
    const cardRect = card.getBoundingClientRect();
    if (cardRect.width < 200 || cardRect.height < 40) return null;
    let labeled = null;
    let best = null;
    let bestRight = Infinity;
    walk(card, (el) => {
      if (!isControl(el) || el.classList.contains("job-mailer-send")) return;
      const label = ((el.getAttribute && el.getAttribute("aria-label")) || "").toLowerCase();
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (/comment|reply/.test(label)) return;
      if (/open control menu|control menu for post/.test(label) && !/comment/.test(label)) {
        labeled = el;
        return;
      }
      if (/^follow\b/i.test(text) || /^follow\b/i.test(label)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 16 || rect.width > 56 || rect.height < 16 || rect.height > 56) return;
      const top = rect.top - cardRect.top;
      const right = cardRect.right - rect.right;
      if (top < -4 || top > 88 || right < -4 || right > 56) return;
      if (right < bestRight) {
        best = el;
        bestRight = right;
      }
    });
    return labeled || best;
  }

  async function mailThisPost(from) {
    const card = postRoot(from);
    walk(card, (el) => {
      if (isMoreButton(el)) press(el);
    });
    await sleep(350);
    const parse = globalThis.JobMailerParse;
    if (!parse) return;
    const text = renderedText(card).slice(0, 8000);
    const post = {
      title: parse.titleFrom(text),
      text,
      emails: emailsFor(card, parse),
      urn: urnFor(card),
      needle: needleFrom(card),
      mark: stamp(card)
    };
    reveal(card);
    if (globalThis.__jobMailerOpen) globalThis.__jobMailerOpen(post);
    else window.dispatchEvent(new CustomEvent("job-mailer-mail", { detail: post }));
  }

  function placeMail(menu) {
    const post = postRoot(menu);
    const postBox = post && post !== menu ? post.getBoundingClientRect() : null;
    const card = postBox && postBox.width > 240 && postBox.height > 60 && postBox.height < 1400 ? post : mailAnchor(menu);
    if (!card) return;
    const scope = post && post.querySelectorAll ? post : card;
    const existing = [...scope.querySelectorAll(".job-mailer-send")];
    let button = existing.find((extra) => extra.parentElement === card) || null;
    for (const extra of existing) {
      if (extra !== button) extra.remove();
    }
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "job-mailer-send";
      button.setAttribute("aria-label", "Draft email for this post");
      button.title = "Draft email for this post";
      button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="#fffdf8" stroke-width="1.8"></rect><path d="M3 7l9 7 9-7" fill="none" stroke="#fffdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
      const onClick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        if (event.type === "click") mailThisPost(menu);
      };
      button.addEventListener("pointerdown", onClick, true);
      button.addEventListener("mousedown", onClick, true);
      button.addEventListener("click", onClick, true);
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      card.appendChild(button);
    }
    const cardRect = card.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const size = 32;
    button.style.cssText = "position:absolute;display:inline-flex;align-items:center;justify-content:center;width:" + size + "px;height:" + size + "px;margin:0;padding:0;border:0;border-radius:50%;background:#0f5f5c;cursor:pointer;z-index:30;pointer-events:auto;";
    button.style.top = (menuRect.bottom - cardRect.top + 6) + "px";
    button.style.left = (menuRect.left - cardRect.left + (menuRect.width - size) / 2) + "px";
  }

  function decorateMenus() {
    const root = feedRoot();
    const menus = [];
    const seen = new Set();
    const add = (menu) => {
      if (!menu || seen.has(menu)) return;
      seen.add(menu);
      menus.push(menu);
    };
    walk(root, (el) => {
      if (isOverflowMenu(el)) add(el);
    });
    if (menus.length === 0) {
      const blocks = [];
      walk(root, (el) => {
        const cls = String(el.className || "");
        if (el.tagName === "ARTICLE" || el.tagName === "LI" || /search-result|entity-result|reusable-search__result|feed-shared-update|occludable-update|groups-post/.test(cls)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 240 && rect.height > 80) blocks.push(el);
        }
      });
      const leaves = blocks.filter((el) => !blocks.some((other) => other !== el && el.contains(other)));
      for (const block of leaves) add(findOverflow(block));
    }
    for (const menu of oneMenuEach(menus)) {
      try {
        placeMail(menu);
      } catch (_error) {
        /* keep decorating the other posts */
      }
    }
  }

  globalThis.__jobMailerDecorate = decorateMenus;
  decorateMenus();
  if (!globalThis.__jobMailerMenuBound) {
    globalThis.__jobMailerMenuBound = true;
    let timer = 0;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (globalThis.__jobMailerDecorate) globalThis.__jobMailerDecorate();
      }, 400);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  globalThis.__jobMailerScan = scanPage;
  globalThis.__jobMailerShow = showPost;
  if (!globalThis.__jobMailerFeedScanBound) {
    globalThis.__jobMailerFeedScanBound = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== "scanFeedPosts") return;
      Promise.resolve()
        .then(() => globalThis.__jobMailerScan())
        .then((posts) => sendResponse({ ok: true, posts }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Scan failed" }));
      return true;
    });
  }
  if (globalThis.__jobMailerShowBound) return;
  globalThis.__jobMailerShowBound = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "showFeedPost") return;
    Promise.resolve()
      .then(() => globalThis.__jobMailerShow(message))
      .then((result) => sendResponse(result || { ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not show that post." }));
    return true;
  });
})();
