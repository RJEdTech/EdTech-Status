'use strict';

/**
 * Soundtrap — the most minimal status page we track: a single sentence
 * ("Soundtrap is working fine.") on an otherwise bare, custom-built HTML page.
 * There is no API, no structured data, no per-component breakdown, no incident
 * log, and no status attribute in the markup. Checked again 2026-08-25: still
 * true.
 *
 * So unlike Gimkit (Crisp's data-status) or NoRedInk (Status.io's JSON API),
 * there is no machine-readable signal here to move to. The prose IS the source.
 * What can be fixed is the failure mode:
 *
 *   Before, one exact sentence meant "fine" and ANY other wording meant
 *   "check the vendor page". So the day Soundtrap rewrites that line — "All
 *   systems normal", say — the tile flips to an alarm state and stays there,
 *   with nothing wrong and nothing in the file explaining why.
 *
 * Two changes:
 *
 *   1. A family of healthy wordings is recognised, not one sentence, and a
 *      family of trouble wordings is recognised too. A rewrite that still reads
 *      as "everything is fine" is read as operational.
 *   2. Trouble wordings are checked BEFORE healthy ones, so a page that says
 *      both errs toward drawing attention rather than away from it.
 *
 * Today's exact sentence is still matched literally, so the current page is
 * read with certainty; the fuzzier rules only apply once it changes.
 *
 * Deliberately NOT done: capturing the status line into the snapshot as a
 * `banner` field, the way noredink.json does. It would make a future reword
 * self-explanatory, but soundtrap.json's field shape is pinned by a contract
 * test in snapshot-lib.test.js (index.html and alert-changes.yml read these
 * fields by name), and adding a field means regenerating that file too. Worth
 * doing as its own small change, not smuggled into this one.
 *
 * The severity vocabulary is unchanged: this page exposes one bit of state, so
 * we can tell "operational" from "not operational" and nothing finer. Anything
 * else is `check_page` — the dashboard renders that as "see vendor page".
 */

const { BreakageError } = require('../snapshot-lib');

const PAGE_URL = 'https://status.soundtrap.com/';

// Today's exact sentence. Checked first, so the current page is never subject
// to the heuristics below.
const KNOWN_GOOD = /Soundtrap\s+is\s+working\s+fine/i;

// Page furniture — present whatever the status is, so it must not be read AS
// the status. "If you are experiencing issues, please contact support." is the
// trap here: it contains the words "experiencing issues" on a healthy page.
const BOILERPLATE = [
  /if\s+you\s+are\s+experiencing\s+issues/i,
  /please\s+contact\s+support/i,
  /contact\s+(us|support)/i,
  /^soundtrap\s+system\s+status$/i,
  /^system\s+status/i,
  /^skip\s+to\b/i,
];

// Wordings that mean "nothing is wrong".
const OPERATIONAL_PATTERNS = [
  /\bworking\s+(fine|normally|as\s+expected)\b/i,
  /\ball\s+systems?\s+(are\s+)?(operational|normal|fine|go)\b/i,
  /\beverything\s+(is\s+)?(working|running|operating|fine|normal|ok)\b/i,
  /\boperating\s+normally\b/i,
  /\bno\s+(known\s+)?(issues|problems|incidents|outages)\b/i,
  /\bup\s+and\s+running\b/i,
];

// Wordings that mean "something is wrong". Checked before the fuzzy healthy
// patterns, so a page saying both errs toward drawing attention.
const TROUBLE_PATTERNS = [
  /\b(outage|downtime|degraded|disruption|incident)\b/i,
  /\bnot\s+working\b/i,
  /\bexperiencing\s+(issues|problems|difficulties)\b/i,
  /\bwe(?:'re|\s+are)\s+(aware|investigating|working\s+on)\b/i,
  /\bunder\s+maintenance\b/i,
  /\bsome\s+(users|customers|features)\b/i,
];

/** Visible text lines, with tags, scripts and page furniture removed. */
function contentLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;|&#0*160;/gi, ' ')
    .replace(/&amp;|&#0*38;/gi, '&')
    .replace(/&#0*39;|&rsquo;|&#0*8217;/gi, "'")
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 1)
    .filter((s) => !BOILERPLATE.some((re) => re.test(s)));
}

function detect(html) {
  const looksLikeSoundtrapStatus = /Soundtrap\s+system\s+status/i.test(html)
    || /<title>[^<]*Soundtrap[^<]*<\/title>/i.test(html);

  if (!looksLikeSoundtrapStatus) {
    throw new BreakageError('Page does not look like the Soundtrap status page — Soundtrap may have moved or redesigned the page.');
  }

  const text = contentLines(html).join(' ');

  // 1. Anything that reads as trouble draws attention — checked first, so a
  //    page that says both ("working fine, but some users…") does not read as
  //    healthy. Today's page contains no trouble wording once the contact
  //    boilerplate is stripped, so this costs the healthy case nothing.
  if (TROUBLE_PATTERNS.some((re) => re.test(text))) return { status: 'check_page' };

  // 2. Today's page, read exactly.
  if (KNOWN_GOOD.test(text)) return { status: 'operational' };

  // 3. A reworded but still-healthy page stays green.
  if (OPERATIONAL_PATTERNS.some((re) => re.test(text))) return { status: 'operational' };

  // 4. Recognisably Soundtrap's status page, wording we do not know. Not
  //    breakage — the page is there and readable, it just is not saying
  //    anything we can classify.
  return { status: 'check_page' };
}

module.exports = {
  label: 'Soundtrap',
  outPath: 'soundtrap.json',
  url: PAGE_URL,
  static: { source: PAGE_URL },
  defaults: { status: 'unknown' },
  fetch: {
    accept: 'text/html',
    // A redirect off this domain means the status page moved or was retired;
    // parsing whatever we land on would produce a confident, wrong reading.
    allowedHost: 'soundtrap.com',
  },
  detect,
};
