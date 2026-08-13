'use strict';

/**
 * AWS Service Health — the combined RSS feed at /rss/all.rss, which aggregates
 * every AWS service and every region into one document.
 *
 * AWS's own docs warn that this format is subject to change and recommend
 * EventBridge for production consumers. We stay on the feed anyway because
 * (a) EventBridge needs an AWS account and IAM setup we don't want behind a
 * public dashboard, (b) the feed format has been stable since 2008, and
 * (c) this scraper reports its own breakage loudly if parsing stops working.
 *
 * Parsing is regex over <item> blocks — no XML parser. Each item is one status
 * event; AWS encodes the state in the title prefix:
 *
 *   "Service is operating normally: [RESOLVED] ..."  -> resolved
 *   "Informational message: ..."                     -> informational
 *   "Service disruption: ..."                        -> active incident
 *   "Performance issues: ..."                        -> active incident
 *
 * We keep only UNRESOLVED, recent items, map each to a severity, and report the
 * worst one plus a count.
 *
 * This reading is deliberately coarse. AWS has hundreds of service/region
 * combinations we don't use, and we make no attempt to filter by service — if
 * anything is broken anywhere at AWS, we surface it and let a human decide
 * whether it matters. For a school dashboard a false positive ("AWS has an
 * issue but it isn't affecting us") is cheap; the tile exists to give context
 * when Canvas/NoRedInk/Quizizz go red.
 */

const { BreakageError } = require('../snapshot-lib');

const FEED_URL = 'https://status.aws.amazon.com/rss/all.rss';

/**
 * Parse the feed and return the list of ACTIVE incidents.
 *
 * The feed can carry hundreds of historical items, so two heuristics narrow it
 * to "currently active":
 *
 *   1. The title does NOT start with "Service is operating normally" — those are
 *      resolutions. The same incident is re-posted with that prefix when it
 *      clears, so keeping them would double-count every event.
 *   2. pubDate is within the last 4 hours. AWS sometimes leaves old items in the
 *      feed with no resolution marker; the time window stops stale items from
 *      showing on the dashboard forever.
 *
 * Severity comes from title keywords:
 *   "Service disruption" / "outage" / "unavailable"          -> major
 *   "Performance issues" / "degradation" / "elevated error"   -> partial
 *   "Informational message"                                   -> degraded (quiet)
 *   anything else                                             -> partial (conservative default)
 */
function parseRss(xml) {
  // Confirm we actually got an RSS feed and not, say, an error page or a
  // redesigned endpoint.
  if (!/<rss[\s>]/.test(xml)) {
    throw new BreakageError('Response does not appear to be RSS — AWS may have changed the feed format or URL.');
  }

  const fourHoursAgoMs = Date.now() - (4 * 60 * 60 * 1000);
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const pubMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    const pubDate = pubMatch ? new Date(pubMatch[1].trim()) : null;
    const desc = descMatch ? descMatch[1].trim().slice(0, 200) : '';

    // Skip resolutions
    if (/^Service is operating normally/i.test(title)) continue;

    // Skip stale items
    if (pubDate && pubDate.getTime() < fourHoursAgoMs) continue;

    // Determine severity
    let severity;
    if (/Service disruption|outage|unavailable/i.test(title))              severity = 'major';
    else if (/Performance issues|degradation|elevated error/i.test(title)) severity = 'partial';
    else if (/Informational message/i.test(title))                         severity = 'degraded';
    else                                                                   severity = 'partial';  // conservative default

    items.push({ title, severity, pubDate: pubDate ? pubDate.toISOString() : null, description: desc });
  }

  return items;
}

// Aggregate severity from list of active items. Worst wins.
function aggregateSeverity(items) {
  if (items.length === 0) return 'operational';
  const order = ['operational', 'degraded', 'partial', 'major'];
  let worst = 'operational';
  for (const item of items) {
    if (order.indexOf(item.severity) > order.indexOf(worst)) worst = item.severity;
  }
  return worst;
}

/**
 * A feed full of active incidents is a perfectly good reading — it means AWS is
 * having a bad day, not that our scraper broke. The only breakage signal here is
 * "this document is not an RSS feed", which parseRss raises.
 *
 * firstIncidentTitle is the first ACTIVE item in feed order, which is not
 * necessarily the worst one; it is a headline for the tile, not the summary.
 */
function detect(xml) {
  const items = parseRss(xml);
  return {
    severity: aggregateSeverity(items),
    activeCount: items.length,
    firstIncidentTitle: items.length > 0 ? items[0].title : '',
  };
}

module.exports = {
  label: 'AWS',
  outPath: 'aws.json',
  url: FEED_URL,
  static: { source: FEED_URL },
  defaults: { severity: 'unknown', activeCount: 0, firstIncidentTitle: '' },
  fetch: {
    accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
    // A redirect off this domain means the status page moved or was retired;
    // parsing whatever we land on would produce a confident, wrong reading.
    allowedHost: 'amazon.com',
  },
  detect,
};
