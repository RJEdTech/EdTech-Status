'use strict';

/**
 * NoRedInk — hosted on Status.io. Like most third-party status page platforms,
 * Status.io does not expose a public unauthenticated JSON endpoint for customer
 * pages (their /v2/ API requires an API key per customer), so we scrape the
 * rendered HTML.
 */

const { BreakageError } = require('../snapshot-lib');

const PAGE_URL = 'https://noredinkstatus.com/';

/**
 * Status.io renders a top banner with id="statusbar_text" containing the overall
 * page status in plain text. Known states (based on Status.io's documented
 * status levels):
 *
 *   "All Systems Operational"         -> operational (green)
 *   "Scheduled Maintenance"           -> maintenance (blue)
 *   "Degraded Performance"            -> degraded/partial (yellow/orange)
 *   "Partial System Outage"           -> partial (orange)
 *   "Major System Outage"             -> major (red)
 *   "Service Disruption"              -> partial (orange, conservative)
 *
 * We confirm we are on the right page by looking for the statusbar_text id
 * (generic across Status.io pages) AND a NoRedInk-specific marker. If the id is
 * gone, Status.io has changed their structure; if NoRedInk-specific markers are
 * gone, the URL probably redirected somewhere else. Either way the page is not
 * recognisable, so we raise BreakageError rather than guess.
 *
 * We intentionally do NOT look at background color hex codes for status
 * detection even though they're present in the HTML. Status.io lets customers
 * customize their color theme, and NoRedInk's green happens to be #27AE60
 * today — but if they ever rebrand, color matching silently breaks. Text
 * matching is more stable.
 *
 * Note on maintenance: the stats widget may show "1 Upcoming Maintenances"
 * while the overall banner still reads "All Systems Operational" — that's a
 * scheduled future window, not an active one. We only surface maintenance
 * severity when the banner itself says so.
 */
function detect(html) {
  // First, confirm we're on a Status.io page
  const hasStatusbarId = /id=["']statusbar_text["']/i.test(html);
  if (!hasStatusbarId) {
    throw new BreakageError('No id="statusbar_text" found — Status.io may have redesigned the page structure.');
  }

  // Confirm we're on NoRedInk's page specifically (not a redirect)
  const looksLikeNoRedInk = /NoRedInk/i.test(html) || /noredink\.com/i.test(html);
  if (!looksLikeNoRedInk) {
    throw new BreakageError('Status.io page loaded but no NoRedInk markers found — possible redirect.');
  }

  // Extract the banner text
  const bannerMatch = html.match(/id=["']statusbar_text["'][^>]*>([^<]+)</i);
  if (!bannerMatch) {
    throw new BreakageError('Found statusbar_text id but could not extract banner text — HTML structure changed.');
  }
  const bannerText = bannerMatch[1].trim();

  // Map banner text to severity. Check most severe first.
  if (/major.*outage/i.test(bannerText))               return { severity: 'major',       banner: bannerText };
  if (/partial.*outage/i.test(bannerText))             return { severity: 'partial',     banner: bannerText };
  if (/service.*disruption/i.test(bannerText))         return { severity: 'partial',     banner: bannerText };
  if (/degraded.*performance/i.test(bannerText))       return { severity: 'degraded',    banner: bannerText };
  if (/scheduled.*maintenance/i.test(bannerText))      return { severity: 'maintenance', banner: bannerText };
  if (/all.*systems.*operational/i.test(bannerText))   return { severity: 'operational', banner: bannerText };

  // Banner present but text doesn't match any known state. Could be a state we
  // haven't seen before (Status.io supports custom status labels) or a new
  // wording. This is a reading of the page, not a failure to recognise it, so
  // it is NOT breakage: surface as check_page and capture the banner text in the
  // JSON so the keyword list can be updated quickly.
  return { severity: 'check_page', banner: bannerText };
}

module.exports = {
  label: 'NoRedInk',
  outPath: 'noredink.json',
  url: PAGE_URL,
  static: { source: PAGE_URL },
  // Key order here fixes the field order in noredink.json:
  // fetchedAt, source, severity, banner, parseError, [fetchTrouble], lastSuccessfulParse.
  // `banner` defaults to '' (not null) to match the old failure path's
  // `lastGood.banner || ''`.
  defaults: { severity: 'unknown', banner: '' },
  fetch: {
    accept: 'text/html',
    // A redirect off this domain means the status page moved or was retired;
    // parsing whatever we land on would produce a confident, wrong reading.
    allowedHost: 'noredinkstatus.com',
  },
  detect,
};
