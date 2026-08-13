'use strict';

/**
 * Gimkit — hosted on Crisp Status (the SaaS packaging of the open-source Vigil
 * tool). Crisp does not expose a public unauthenticated JSON endpoint for status
 * pages — the v1 REST API is for managing the page from the operator's side, not
 * for reading public status — so we scrape the rendered banner.
 */

const { BreakageError } = require('../snapshot-lib');

const PAGE_URL = 'https://gimkit.crisp.watch/en/';

/**
 * Crisp Status renders a top-level banner whose wording depends on overall
 * replica health. Vigil classifies each replica as "healthy", "sick" or "dead"
 * and rolls them up to a page-level status. Default headline texts:
 *
 *   "All systems are healthy at the moment."   — operational
 *   "Some systems are not behaving normally."  — at least one node sick
 *   "Some systems are down right now."         — at least one node dead
 *
 * We first confirm we are still on a Crisp-style page; if not, the page changed
 * and the reading cannot be trusted.
 */
function detect(html) {
  const looksLikeCrispStatus = /This status page automatically monitors/i.test(html)
    || /crisp\.watch/i.test(html)
    || /Powered by Crisp/i.test(html);

  if (!looksLikeCrispStatus) {
    throw new BreakageError('Page does not appear to be a Crisp Status page — Crisp may have redesigned the page or Gimkit may have moved their status page.');
  }

  // Order matters — check most-degraded first.
  if (/All systems are down/i.test(html)) return { severity: 'major' };
  if (/Some systems are down/i.test(html)) return { severity: 'partial' };
  if (/Some systems are not behaving normally/i.test(html)) return { severity: 'degraded' };
  if (/All systems are healthy/i.test(html)) return { severity: 'operational' };

  throw new BreakageError('Page loaded but no known Crisp Status banner found — wording may have changed.');
}

module.exports = {
  label: 'Gimkit',
  outPath: 'gimkit.json',
  url: PAGE_URL,
  static: { source: PAGE_URL },
  defaults: { severity: 'unknown' },
  fetch: {
    accept: 'text/html',
    // A redirect off this domain means the status page moved or was retired;
    // parsing whatever we land on would produce a confident, wrong reading.
    allowedHost: 'crisp.watch',
  },
  detect,
};
