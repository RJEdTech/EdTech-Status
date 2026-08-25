'use strict';

/**
 * Gimkit — hosted on Crisp Status (the SaaS packaging of the open-source Vigil
 * tool). Crisp does not expose a public unauthenticated JSON endpoint for status
 * pages — the v1 REST API is for managing the page from the operator's side, not
 * for reading public status — so we read the rendered page.
 *
 * 2026-08-24: Crisp reworded the banner. The headline is now
 * "Looks like everything is operating normally." where it used to be
 * "All systems are healthy at the moment." Matching on those sentences meant a
 * vendor-side copy edit read as a broken scraper: the run went red and the tile
 * went grey during a real Gimkit incident (game servers, 17:52 UTC), which is
 * exactly when the tile needed to be right.
 *
 * So the reading now comes from the markup, not the prose. Crisp stamps every
 * status element with Vigil's own health value:
 *
 *   <aside class="css-home-status" data-status="healthy">   ← page rollup
 *   <li class="css-home-services-group-node" data-status="healthy">  ← per replica
 *
 * Vigil's vocabulary is healthy / sick / dead. That attribute is in the
 * server-rendered HTML (no JS required), it is what drives the page's own
 * colours, and it does not change when marketing rewrites a sentence.
 *
 * The sentence patterns are kept as a fallback for the case where Crisp drops
 * the attribute, and an unrecognised attribute value is breakage — inventing a
 * severity from a status word we do not know would be a confident wrong answer.
 */

const { BreakageError } = require('../snapshot-lib');

const PAGE_URL = 'https://gimkit.crisp.watch/en/';

// Class names Crisp puts on the elements that carry data-status.
const ROLLUP_CLASS = 'css-home-status';
const NODE_CLASS = 'css-home-services-group-node';

/**
 * Every tag in `html` that carries a data-status attribute, with its class list.
 * Attribute order varies between Crisp releases, so both attributes are read out
 * of the tag rather than matched in a fixed sequence.
 */
function statusTags(html) {
  const out = [];
  const tagRe = /<[a-zA-Z][^>]*>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    const status = /\bdata-status\s*=\s*"([^"]*)"/i.exec(tag);
    if (!status) continue;
    const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(tag);
    out.push({
      status: status[1].trim().toLowerCase(),
      classes: cls ? cls[1].trim().split(/\s+/) : [],
    });
  }
  return out;
}

function detect(html) {
  // Confirm we are still on a Crisp Status page. Deliberately NOT a bare
  // /crisp\.watch/ test: every page on the domain — including Crisp's own 404
  // and marketing pages — contains that string, so it would let a retired
  // status page parse as though it were still a status page.
  const looksLikeCrispStatus = html.includes(ROLLUP_CLASS)
    || html.includes('css-home-services')
    || /This status page automatically monitors/i.test(html)
    || /Powered by Crisp/i.test(html);

  if (!looksLikeCrispStatus) {
    throw new BreakageError('Page does not appear to be a Crisp Status page — Crisp may have redesigned the page or Gimkit may have moved their status page.');
  }

  const tagged = statusTags(html);
  const rollup = tagged.find((t) => t.classes.includes(ROLLUP_CLASS));

  if (rollup) {
    if (rollup.status === 'healthy') return { severity: 'operational' };
    if (rollup.status === 'sick') return { severity: 'degraded' };
    if (rollup.status === 'dead') {
      // Page-level "dead" means at least one replica is down. Count the replicas
      // to tell "everything is down" from "one thing is down" — a distinction the
      // old banner wording claimed to make but, in practice, never could.
      const nodes = tagged.filter((t) => t.classes.includes(NODE_CLASS));
      const dead = nodes.filter((n) => n.status === 'dead').length;
      return { severity: (nodes.length > 0 && dead === nodes.length) ? 'major' : 'partial' };
    }
    throw new BreakageError('Crisp reported page status "' + rollup.status + '", which is not one of healthy/sick/dead — Vigil\'s status vocabulary may have changed.');
  }

  // --- Fallback: no data-status anywhere. Read the banner wording. ------------
  // Order matters — check most-degraded first.
  if (/All systems are down/i.test(html)) return { severity: 'major' };
  if (/Some systems are down/i.test(html)) return { severity: 'partial' };
  if (/Some systems are not behaving normally/i.test(html)) return { severity: 'degraded' };
  if (/some services are not working/i.test(html)) return { severity: 'partial' };
  if (/All systems are healthy/i.test(html)) return { severity: 'operational' };
  if (/everything is operating normally/i.test(html)) return { severity: 'operational' };

  throw new BreakageError('Crisp Status page loaded but carried neither a data-status marker nor a known banner — Crisp has probably redesigned the page.');
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
  // Exported for the tests.
  _statusTags: statusTags,
};
