'use strict';

/**
 * ExploreLearning — no status API and no third-party status host; the vendor
 * publishes a hand-maintained page under their marketing site, so we scrape it.
 *
 * The page has three known states:
 *
 *   "A-OK" (operational) — the page contains:
 *     - an element with id="site-status-a-ok"
 *     - the heading "A-OK!" inside <p class="h1 xbold mb-0 text-green">
 *     - text: "All ExploreLearning sites are currently working with no issues."
 *
 *   "Notice posted" — the A-OK block is REPLACED by an incident block.
 *     Confirmed live on 2026-07-31 (page meta-pubdate 7/31/2026 1:26 AM): an
 *     <img alt="We're on it!">, a headline, a detail paragraph, and the fixed
 *     closer "Our team is working to resolve the issue as soon as possible."
 *     The id="site-status-a-ok" marker is GONE in this state, which is what
 *     broke an earlier two-state parser: a real vendor notice was misread as
 *     page breakage. We key on the alt text and the closer boilerplate (both
 *     state-specific) rather than on class names, which we have no confirmed
 *     sample of.
 *
 *   "Page unrecognized" — none of the above. Either the URL changed, the page
 *   was redesigned, or we got a different page entirely. That is breakage
 *   (BreakageError), not an outage.
 *
 * RJ scoping: RJ uses Gizmos. A notice that names ONLY non-RJ products
 * (Reflex / Frax / Science4Us) is recorded but does not degrade our tile — the
 * same component-filtering principle we apply to Cloudflare.
 */

const { BreakageError } = require('../snapshot-lib');

const PAGE_URL = 'https://www.explorelearning.com/our-products/site-status';

const RJ_PRODUCTS = /\bgizmos?\b/i;
const OTHER_PRODUCTS = /\b(reflex|frax|science\s?4\s?us)\b/i;
const SITEWIDE = /\b(all\s+explorelearning\s+sites|all\s+sites|all\s+products|explorelearning\s+sites|explorelearning\.com)\b/i;
const MAINTENANCE = /\b(planned|scheduled)\s+maintenance\b|\bmaintenance\s+window\b/i;

// Incident-state anchors (both are specific to the notice block)
const ALT_MARKER = /alt=["'][^"']{0,24}we(?:'|&#0*39;|&#x0*27;|&rsquo;|&#0*8217;|&#x0*2019;|\u2019)?re\s+on\s+it[^"']*["']/i;
const CLOSER = /Our\s+team\s+is\s+working\s+to\s+resolve\s+the\s+issue/i;

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
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 1)
    .filter(s => !/^skip to /i.test(s))
    .filter(s => !CLOSER.test(s));
}

function parseNotice(html) {
  const altHit = html.match(ALT_MARKER);
  const closerHit = html.match(CLOSER);
  let startIdx = -1;
  if (altHit) {
    // Resume AFTER the closing bracket of the <img> tag, otherwise the
    // leftover attribute text would be read as the headline.
    const tagEnd = html.indexOf('>', altHit.index + altHit[0].length - 1);
    startIdx = tagEnd === -1 ? altHit.index + altHit[0].length : tagEnd + 1;
  } else if (closerHit) {
    startIdx = Math.max(0, closerHit.index - 4000);
  }
  if (startIdx < 0) return null;
  const endIdx = (closerHit && closerHit.index > startIdx) ? closerHit.index : Math.min(html.length, startIdx + 6000);

  const blocks = textBlocks(html.slice(startIdx, endIdx));
  const headline = (blocks[0] || 'ExploreLearning has posted a notice on its status page.').slice(0, 300);
  const detail = blocks.slice(1).join(' ').slice(0, 1000) || null;

  const text = headline + ' ' + (detail || '');
  const kind = MAINTENANCE.test(text) ? 'maintenance' : 'incident';
  const namesRJ = RJ_PRODUCTS.test(text);
  const namesOther = OTHER_PRODUCTS.test(text);
  const sitewide = SITEWIDE.test(text);
  // Only scope OUT when the notice exclusively names non-RJ products.
  const affectsRJ = sitewide || namesRJ || !namesOther;

  return { kind: kind, headline: headline, detail: detail, affectsRJ: affectsRJ };
}

/**
 * A posted notice is a NORMAL reading, not breakage — it yields a status of
 * maintenance/degraded (or operational, when the notice names only non-RJ
 * products) plus the parsed notice block. Only an unrecognisable page throws.
 */
function detect(html) {
  const hasOkId = /id=["']site-status-a-ok["']/i.test(html);
  const hasGreenAOk = /class=["'][^"']*text-green[^"']*["'][^>]*>\s*A-OK!/i.test(html);
  const hasNotice = ALT_MARKER.test(html) || CLOSER.test(html);

  if (hasNotice) {
    const notice = parseNotice(html);
    if (notice) {
      let status;
      if (!notice.affectsRJ) status = 'operational';
      else if (notice.kind === 'maintenance') status = 'maintenance';
      else status = 'degraded';
      return { status: status, notice: notice };
    }
  }
  if (hasOkId && hasGreenAOk) return { status: 'operational', notice: null };
  if (hasOkId) return { status: 'check_page', notice: null };
  throw new BreakageError('No A-OK block and no notice block found on the page — ExploreLearning may have redesigned the status page or changed the URL.');
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
