'use strict';

/**
 * ExploreLearning — no status API and no third-party status host; the vendor
 * publishes a hand-maintained page under their marketing site, so we read it.
 *
 * There IS a machine-readable marker on that page, and it is the page's own
 * state name. ExploreLearning wraps each state in a <section> whose id encodes
 * the state:
 *
 *   <section id="site-status-a-ok" class="banner-responsive-bottom …">
 *     A-OK!  All ExploreLearning sites are currently working with no issues.
 *
 * Confirmed live on 2026-08-25. When a notice is posted, that A-OK section is
 * REPLACED by the notice block. So the rule is: find the `site-status-*`
 * section, and let its id name the state — `site-status-a-ok` means A-OK, any
 * other `site-status-*` id means a notice is up.
 *
 * 2026-08-25 changes, after the Gimkit scraper broke on a vendor copy edit:
 *
 *   1. The id alone now decides "A-OK". It used to also require the headline
 *      "A-OK!" inside <p class="… text-green …"> — so a restyle that dropped
 *      that class would have quietly downgraded a healthy tile to check_page.
 *      The green headline is now corroboration we log, not a condition.
 *   2. Notice text is read from INSIDE the notice section. It used to be
 *      scraped from a blind 4 KB window of markup preceding the closing
 *      sentence, which routinely picked up nav boilerplate as the headline.
 *   3. A page we still recognise as the status page, but whose state we cannot
 *      read, is `check_page` — not breakage. Breakage is reserved for "this is
 *      not the status page any more", which is the thing that never self-heals.
 *
 * The prose anchors (the "We're on it!" image alt text, the closing sentence)
 * are kept as a fallback for the case where the section ids change.
 *
 * RJ scoping: RJ uses Gizmos. A notice that names ONLY non-RJ products
 * (Reflex / Frax / Science4Us) is recorded but does not degrade our tile — the
 * same component-filtering principle we apply to Cloudflare.
 */

const { BreakageError } = require('../snapshot-lib');

const PAGE_URL = 'https://www.explorelearning.com/our-products/site-status';

const OK_SECTION_ID = 'site-status-a-ok';
const STATE_ID_RE = /id=["'](site-status-[a-z0-9-]+)["']/gi;

// Present in BOTH states — this is the page telling us what it is, so it is the
// page guard. The title is a second, independent marker.
const PAGE_MARKER = /This page monitors issues and downtime/i;
const TITLE_MARKER = /<title>[^<]*Site\s*Status[^<]*<\/title>/i;

const RJ_PRODUCTS = /\bgizmos?\b/i;
const OTHER_PRODUCTS = /\b(reflex|frax|science\s?4\s?us)\b/i;
const SITEWIDE = /\b(all\s+explorelearning\s+sites|all\s+sites|all\s+products|explorelearning\s+sites|explorelearning\.com)\b/i;
const MAINTENANCE = /\b(planned|scheduled)\s+maintenance\b|\bmaintenance\s+window\b/i;

// Incident-state prose anchors (both are specific to the notice block).
const ALT_MARKER = /alt=["'][^"']{0,24}we(?:'|&#0*39;|&#x0*27;|&rsquo;|&#0*8217;|&#x0*2019;|’)?re\s+on\s+it[^"']*["']/i;
const CLOSER = /Our\s+team\s+is\s+working\s+to\s+resolve\s+the\s+issue/i;

// The A-OK sentence, kept only as corroboration and as a last-ditch fallback.
const AOK_SENTENCE = /All\s+ExploreLearning\s+sites\s+are\s+currently\s+working\s+with\s+no\s+issues/i;

function decodeEntities(s) {
  return s
    .replace(/&nbsp;|&#0*160;/gi, ' ')
    .replace(/&amp;|&#0*38;/gi, '&')
    .replace(/&lt;|&#0*60;/gi, '<')
    .replace(/&gt;|&#0*62;/gi, '>')
    .replace(/&quot;|&#0*34;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&rsquo;|&lsquo;|&#0*8217;/gi, "'")
    .replace(/&ndash;|&#0*8211;/gi, '-')
    .replace(/&mdash;|&#0*8212;/gi, '--')
    .replace(/&hellip;|&#0*8230;/gi, '...')
    .replace(/&#0*8203;/gi, '');
}

function textBlocks(fragment) {
  const stripped = fragment
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, '\n');
  return decodeEntities(stripped)
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 1)
    .filter((s) => !/^skip to /i.test(s))
    .filter((s) => !CLOSER.test(s));
}

/**
 * Every `site-status-*` id in the document, in source order.
 */
function stateSectionIds(html) {
  const ids = [];
  STATE_ID_RE.lastIndex = 0;
  let m;
  while ((m = STATE_ID_RE.exec(html)) !== null) ids.push(m[1].toLowerCase());
  return ids;
}

/**
 * The inner HTML of the element carrying `id`, found by matching its opening
 * tag to its closing tag by depth. Returns null when the element cannot be
 * bounded (malformed markup, self-closing, id on something unexpected).
 */
function elementInnerHtml(html, id) {
  const idRe = new RegExp('<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bid=["\']' + id + '["\'][^>]*>', 'i');
  const open = idRe.exec(html);
  if (!open) return null;

  const tag = open[1];
  const bodyStart = open.index + open[0].length;
  const scanRe = new RegExp('<(/?)' + tag + '\\b', 'gi');
  scanRe.lastIndex = bodyStart;

  let depth = 1;
  let m;
  while ((m = scanRe.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(bodyStart, m.index);
  }
  return null; // unbalanced — caller falls back
}

/** Turn a block of notice markup into a headline + detail + RJ scoping. */
function noticeFromFragment(fragment) {
  const blocks = textBlocks(fragment);
  if (!blocks.length) return null;

  const headline = blocks[0].slice(0, 300);
  const detail = blocks.slice(1).join(' ').slice(0, 1000) || null;

  const text = headline + ' ' + (detail || '');
  const namesRJ = RJ_PRODUCTS.test(text);
  const namesOther = OTHER_PRODUCTS.test(text);
  const sitewide = SITEWIDE.test(text);

  return {
    kind: MAINTENANCE.test(text) ? 'maintenance' : 'incident',
    headline: headline,
    detail: detail,
    // Only scope OUT when the notice exclusively names non-RJ products.
    affectsRJ: sitewide || namesRJ || !namesOther,
  };
}

/**
 * Fallback for when no `site-status-*` section can be bounded: anchor on the
 * prose markers and read the span between them.
 */
function noticeFromProse(html) {
  const altHit = html.match(ALT_MARKER);
  const closerHit = html.match(CLOSER);

  let startIdx = -1;
  if (altHit) {
    // Resume AFTER the closing bracket of the <img> tag, otherwise the leftover
    // attribute text would be read as the headline.
    const tagEnd = html.indexOf('>', altHit.index + altHit[0].length - 1);
    startIdx = tagEnd === -1 ? altHit.index + altHit[0].length : tagEnd + 1;
  } else if (closerHit) {
    startIdx = Math.max(0, closerHit.index - 4000);
  }
  if (startIdx < 0) return null;

  const endIdx = (closerHit && closerHit.index > startIdx)
    ? closerHit.index
    : Math.min(html.length, startIdx + 6000);

  return noticeFromFragment(html.slice(startIdx, endIdx))
    || { kind: 'incident', headline: 'ExploreLearning has posted a notice on its status page.', detail: null, affectsRJ: true };
}

function severityForNotice(notice) {
  if (!notice.affectsRJ) return 'operational';
  return notice.kind === 'maintenance' ? 'maintenance' : 'degraded';
}

/**
 * A posted notice is a NORMAL reading, not breakage — it yields a status of
 * maintenance/degraded (or operational, when the notice names only non-RJ
 * products) plus the parsed notice block. Only a page we no longer recognise
 * as ExploreLearning's status page throws.
 */
function detect(html) {
  const ids = stateSectionIds(html);
  const isStatusPage = PAGE_MARKER.test(html) || TITLE_MARKER.test(html) || ids.length > 0;

  if (!isStatusPage) {
    throw new BreakageError('Page carries no ExploreLearning status-page markers — the status page has probably moved or been redesigned.');
  }

  // --- The state section names the state ---------------------------------
  if (ids.includes(OK_SECTION_ID)) return { status: 'operational', notice: null };

  const otherStateId = ids.find((id) => id !== OK_SECTION_ID);
  if (otherStateId) {
    const fragment = elementInnerHtml(html, otherStateId);
    const notice = (fragment && noticeFromFragment(fragment)) || noticeFromProse(html);
    if (notice) return { status: severityForNotice(notice), notice: notice };
  }

  // --- Fallback: the prose anchors ---------------------------------------
  if (ALT_MARKER.test(html) || CLOSER.test(html)) {
    const notice = noticeFromProse(html);
    if (notice) return { status: severityForNotice(notice), notice: notice };
  }

  if (AOK_SENTENCE.test(html)) return { status: 'operational', notice: null };

  // Still recognisably the status page, but we cannot read a state out of it.
  // Visible on the dashboard, and not a red run — the page is not gone, it has
  // just changed shape in a way we should look at.
  return { status: 'check_page', notice: null };
}

module.exports = {
  label: 'ExploreLearning',
  outPath: 'explorelearning.json',
  url: PAGE_URL,
  static: { source: PAGE_URL },
  // `notice` is null whenever the page is clean; carried forward on failure.
  defaults: { status: 'unknown', notice: null },
  fetch: {
    accept: 'text/html',
    // A redirect off this domain means the status page moved or was retired;
    // parsing whatever we land on would produce a confident, wrong reading.
    allowedHost: 'explorelearning.com',
  },
  detect,
};
