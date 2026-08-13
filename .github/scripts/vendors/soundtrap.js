'use strict';

/**
 * Soundtrap — the most minimal status page we track: a single sentence
 * ("Soundtrap is working fine.") on an otherwise bare HTML page. There is no
 * API, no structured data, no component breakdown and no incident log — only
 * that one line of text.
 *
 * Because the page exposes exactly one bit of state, we can tell "operational"
 * from "not operational" but cannot distinguish degraded / partial / major.
 * Anything that is not the operational string surfaces as "see vendor page".
 */

const { BreakageError } = require('../snapshot-lib');

const PAGE_URL = 'https://status.soundtrap.com/';

/**
 * Detection, in order:
 *
 *   1. Confirm we are on the right page by looking for "Soundtrap" in the page
 *      text or the <title>. This guards against silently following a redirect
 *      to a marketing page that happens not to mention status.
 *   2. Then look for the literal "Soundtrap is working fine" string. Present →
 *      operational. Absent (but the page is still recognisably Soundtrap's
 *      status page) → they are most likely reporting an issue; we cannot tell
 *      the severity, so the tile says "check the vendor page" and teachers
 *      click through for details.
 *   3. Neither marker → we do not recognise the document; that is breakage.
 */
function detect(html) {
  const looksLikeSoundtrapStatus = /Soundtrap system status/i.test(html)
                                  || /<title>[^<]*Soundtrap[^<]*<\/title>/i.test(html);
  if (!looksLikeSoundtrapStatus) {
    throw new BreakageError('Page does not look like the Soundtrap status page — Soundtrap may have moved or redesigned the page.');
  }

  if (/Soundtrap is working fine/i.test(html)) {
    return { status: 'operational' };
  }

  // Page is recognisably Soundtrap's status page but the operational string is
  // gone. Best guess is that they are reporting an issue. Visible enough to
  // draw attention without overstating what we actually know.
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
