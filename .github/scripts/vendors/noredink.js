'use strict';

/**
 * NoRedInk — hosted on Status.io.
 *
 * 2026-08-25: this module used to scrape the rendered banner out of
 * id="statusbar_text", on the stated belief that "Status.io does not expose a
 * public unauthenticated JSON endpoint for customer pages". That is not true.
 * Status.io publishes a documented, public, key-free read endpoint:
 *
 *   GET https://api.status.io/1.0/status/<statuspage_id>
 *
 * NoRedInk's page id (63b60949f1c65f058ac51bd2) is in their status page's own
 * markup. The response carries result.status_overall.status_code — Status.io's
 * numeric status vocabulary — which is what the page itself renders from.
 *
 * So we read the number, not the sentence. This is the same lesson the Gimkit
 * scraper learned the hard way on 2026-08-24: a vendor rewriting a line of copy
 * should never look like a broken status check.
 *
 * The old text patterns are gone rather than kept as a fallback: they matched
 * against a different URL (the HTML page), and snapshot-lib fetches exactly one
 * URL per vendor. If the API ever stops answering, that surfaces honestly —
 * a 5xx as a transient blip, a 404 as breakage.
 */

const { BreakageError } = require('../snapshot-lib');

// The human-facing page. Written into the snapshot as `source` and linked from
// the dashboard; not the URL we read.
const PAGE_URL = 'https://noredinkstatus.com/';

// Status.io's id for NoRedInk's page. If NoRedInk ever migrates off Status.io
// this id stops resolving, the API 404s, and snapshot-lib reports breakage on
// the first run — which is the correct and honest outcome.
const STATUS_PAGE_ID = '63b60949f1c65f058ac51bd2';
const API_URL = 'https://api.status.io/1.0/status/' + STATUS_PAGE_ID;

/**
 * Status.io's documented status codes, mapped to the severities this repo uses.
 * The dashboard's own mapping is unchanged: it still reads `severity` and
 * `banner` out of noredink.json exactly as before.
 */
const SEVERITY_BY_CODE = {
  100: 'operational', // Operational
  200: 'maintenance', // Scheduled Maintenance
  300: 'degraded',    // Degraded Performance
  400: 'partial',     // Partial Service Disruption
  500: 'partial',     // Service Disruption   (the old scraper also called this partial)
  600: 'partial',     // Security Event       (serious, but not a severity we model)
};

function detect(body) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    throw new BreakageError('Status.io did not return JSON — the API endpoint or the page id has probably changed.');
  }

  const overall = payload && payload.result && payload.result.status_overall;
  if (!overall || typeof overall !== 'object') {
    throw new BreakageError('Status.io response carried no result.status_overall — the API shape has changed.');
  }

  const banner = typeof overall.status === 'string' ? overall.status.trim() : '';
  const code = Number(overall.status_code);
  const severity = SEVERITY_BY_CODE[code];

  if (severity) return { severity: severity, banner: banner };

  // A status code outside the documented set. This is a successful READING of a
  // page we still understand — not a failure to recognise it — so it is not
  // breakage. Surface it as check_page and carry the label through, exactly as
  // the old scraper did with an unrecognised banner sentence.
  return {
    severity: 'check_page',
    banner: banner || ('Status.io status code ' + (Number.isFinite(code) ? code : 'missing')),
  };
}

module.exports = {
  label: 'NoRedInk',
  outPath: 'noredink.json',
  url: API_URL,
  static: { source: PAGE_URL },
  // Key order here fixes the field order in noredink.json:
  // fetchedAt, source, severity, banner, parseError, [fetchTrouble], lastSuccessfulParse.
  defaults: { severity: 'unknown', banner: '' },
  fetch: {
    accept: 'application/json',
    // The API lives on api.status.io. A redirect off status.io means the
    // endpoint moved or was retired; parsing whatever we land on would produce a
    // confident, wrong reading.
    allowedHost: 'status.io',
  },
  detect,
};
