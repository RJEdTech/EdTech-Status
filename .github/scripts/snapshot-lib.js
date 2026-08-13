'use strict';

/**
 * Shared machinery for the EdTech Status scraper workflows.
 *
 * Every "Family A" vendor (one that we read by fetching a document and parsing
 * it — AWS RSS, Gizmos, Gimkit, NoRedInk, Soundtrap) used to carry its own
 * copy-pasted version of this logic inside a YAML heredoc. The copies drifted,
 * and three bugs came out of the drift:
 *
 *   1. `lastSuccessfulParse` was inside the "did anything change?" comparison in
 *      five workflows. It is set to `now` on every successful run, so the
 *      comparison never matched and every run committed — ~288 commits/day per
 *      workflow into a single branch.
 *
 *   2. That commit volume made `git push` collisions routine, and six of nine
 *      workflows pushed with no retry, so runs failed red on a race they should
 *      have simply retried.
 *
 *   3. A single flaky fetch (one 15s timeout) was recorded as a `parseError`,
 *      which the dashboard renders as a grey "Status check broken" tile and the
 *      alerter escalates to Teams — for a vendor that was never down.
 *
 * This module is the single implementation. It distinguishes two failure kinds:
 *
 *   TransientError — we could not READ the source (timeout, DNS, reset, 5xx,
 *     429). The vendor is probably fine; our runner had a bad minute. Tolerated
 *     for FAILURE_GRACE consecutive runs before we admit breakage.
 *
 *   BreakageError — we READ the source and did not recognise it (redesign,
 *     moved URL, 404/410). This never self-heals, so it is reported on the
 *     first run.
 *
 * NOTE: the "Family B" workflows (arbitersports, athletics-probes, myrj,
 * rj-website) are reachability probes, not parsers. For them an unreachable
 * target IS the reading, so they deliberately do NOT use this module's grace
 * period — they share only the commit-snapshot action.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');

// --- Defaults. A vendor module may override any of these. --------------------
const DEFAULTS = {
  timeoutMs: 15000,        // per attempt
  attempts: 3,             // attempts within a single run
  backoffMs: [2000, 5000], // waits between attempts
  maxRedirects: 3,
  allowedHost: null,       // when set, a redirect off this host is BREAKAGE, not a fetch
  failureGrace: 3,         // consecutive failed RUNS tolerated before breakage
  heartbeatMs: 60 * 60 * 1000, // refresh lastSuccessfulParse at most hourly
  userAgent: 'rjedtech-status-dashboard',
  accept: '*/*',
};

class TransientError extends Error {
  constructor(message) { super(message); this.name = 'TransientError'; }
}
class BreakageError extends Error {
  constructor(message) { super(message); this.name = 'BreakageError'; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when `hostname` is `allowed` or a subdomain of it. */
function hostMatches(hostname, allowed) {
  const h = String(hostname).toLowerCase();
  const a = String(allowed).toLowerCase();
  return h === a || h.endsWith('.' + a);
}

/**
 * Fetch a URL once. Resolves with the body as a string.
 * Redirects are followed (they are normal, not breakage).
 */
function fetchOnce(url, opts, redirectsLeft) {
  const cfg = { ...DEFAULTS, ...opts };
  if (redirectsLeft === undefined) redirectsLeft = cfg.maxRedirects;

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => (v) => { if (!settled) { settled = true; fn(v); } };
    const ok = done(resolve);
    const fail = done(reject);

    const client = url.startsWith('http://') ? http : https;
    const req = client.get(url, {
      headers: { 'User-Agent': cfg.userAgent, Accept: cfg.accept },
    }, (res) => {
      const code = res.statusCode;

      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          fail(new BreakageError('Too many redirects starting from ' + url));
          return;
        }
        let next;
        try {
          next = new URL(res.headers.location, url);
        } catch (e) {
          fail(new BreakageError('Unparseable redirect target: ' + res.headers.location));
          return;
        }

        // A redirect off the vendor's own domain almost always means the status
        // page was retired and we are being sent to a marketing site. Following
        // it would let us "successfully" parse the wrong page and report a
        // confident, wrong reading — so treat it as breakage. (The old
        // ExploreLearning scraper enforced this with an ALLOWED_HOST check;
        // this is that guard, generalised.)
        if (cfg.allowedHost && !hostMatches(next.hostname, cfg.allowedHost)) {
          fail(new BreakageError(
            'Redirected off ' + cfg.allowedHost + ' to ' + next.hostname
            + ' — the status page has probably moved or been retired.'));
          return;
        }

        fetchOnce(next.toString(), opts, redirectsLeft - 1).then(ok, fail);
        return;
      }

      if (code !== 200) {
        res.resume();
        // 404/410 means the URL itself is gone — structural, not a bad minute.
        fail(code === 404 || code === 410
          ? new BreakageError('HTTP ' + code + ' — the source URL no longer exists.')
          : new TransientError('HTTP ' + code));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => ok(body));
      res.on('error', (e) => fail(new TransientError(e.message)));
    });

    req.setTimeout(cfg.timeoutMs, () => {
      req.destroy(new TransientError(
        'Timed out after ' + Math.round(cfg.timeoutMs / 1000) + 's fetching the source.'));
    });

    req.on('error', (e) => fail(
      (e instanceof TransientError || e instanceof BreakageError) ? e : new TransientError(e.message)));
  });
}

/**
 * Fetch with retries. Retries transient failures only — there is no point
 * re-requesting a 404 three times.
 */
async function fetchWithRetry(url, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let lastErr;
  for (let i = 0; i < cfg.attempts; i++) {
    try {
      return await fetchOnce(url, cfg);
    } catch (err) {
      if (err instanceof BreakageError) throw err;
      lastErr = err;
      console.error('  attempt ' + (i + 1) + '/' + cfg.attempts + ' failed: ' + err.message);
      if (i < cfg.attempts - 1) await sleep(cfg.backoffMs[i] ?? cfg.backoffMs[cfg.backoffMs.length - 1]);
    }
  }
  throw lastErr;
}

function readExisting(outPath) {
  if (!fs.existsSync(outPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (_) {
    return null; // corrupt file: treat as no prior state, we'll rewrite it
  }
}

/**
 * Compare only the fields that MEAN something.
 *
 * Deliberately excludes `fetchedAt` and `lastSuccessfulParse`. Both are "now"
 * on every successful run, so including them (as five workflows did) makes this
 * always return false and turns every run into a commit.
 */
function contentEqual(a, b, fields) {
  if (!a || !b) return false;
  return fields.every((f) => JSON.stringify(a[f] ?? null) === JSON.stringify(b[f] ?? null));
}

/**
 * Run one vendor's snapshot update.
 *
 * @param {object} vendor
 *   @param {string}   vendor.label     Human name, for log lines.
 *   @param {string}   vendor.outPath   JSON file to write.
 *   @param {string}   vendor.url       URL to fetch.
 *   @param {object}   [vendor.static]  Fields always written verbatim (e.g. {source}).
 *   @param {object}   vendor.defaults  Content fields + their value when there is
 *                                      no prior reading (e.g. {severity:'unknown'}).
 *   @param {function} vendor.detect    (body) => content object matching `defaults`
 *                                      keys. Throw BreakageError when the document
 *                                      is not recognisable.
 *   @param {object}   [vendor.fetch]   Per-vendor fetch overrides (timeoutMs, accept…).
 * @param {object} [opts] Overrides, chiefly for tests (now, failureGrace, heartbeatMs).
 * @returns {Promise<{action:string, snapshot:object|null}>}
 */
async function updateSnapshot(vendor, opts = {}) {
  const cfg = { ...DEFAULTS, ...(vendor.fetch || {}), ...opts };
  const nowIso = opts.now || new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  const staticFields = vendor.static || {};
  const contentKeys = Object.keys(vendor.defaults);
  const compareFields = [...Object.keys(staticFields), ...contentKeys, 'parseError', 'fetchTrouble'];

  const existing = readExisting(vendor.outPath) || {};

  // ---- Read the source -------------------------------------------------------
  let outcome;
  try {
    const body = await fetchWithRetry(vendor.url, cfg);
    outcome = { kind: 'ok', content: vendor.detect(body) };
  } catch (err) {
    outcome = {
      kind: err instanceof BreakageError ? 'breakage' : 'transient',
      message: err.message,
    };
  }

  const write = (snapshot, why) => {
    fs.writeFileSync(vendor.outPath, JSON.stringify(snapshot, null, 2) + '\n');
    console.log(vendor.label + ': ' + why + ' — wrote ' + vendor.outPath);
    return { action: 'written', snapshot };
  };

  // ---- Success ---------------------------------------------------------------
  if (outcome.kind === 'ok') {
    const newContent = {
      ...staticFields,
      ...outcome.content,
      parseError: null,   // explicitly cleared
      fetchTrouble: null, // any in-flight strike count is reset
    };

    if (contentEqual(newContent, existing, compareFields)) {
      // Nothing material changed. Refresh timestamps at most once an hour, so
      // "last good reading" stays honest without committing every 5 minutes.
      const last = Date.parse(existing.lastSuccessfulParse || '');
      if (Number.isFinite(last) && (nowMs - last) < cfg.heartbeatMs) {
        console.log(vendor.label + ': no material change — skipping write.');
        return { action: 'skipped', snapshot: null };
      }
      return write({ fetchedAt: nowIso, ...newContent, lastSuccessfulParse: nowIso },
        'hourly heartbeat');
    }

    return write({ fetchedAt: nowIso, ...newContent, lastSuccessfulParse: nowIso },
      'content changed');
  }

  // ---- Failure ---------------------------------------------------------------
  console.error(vendor.label + ': ' + outcome.message);

  const priorTrouble = existing.fetchTrouble || null;
  const priorError = existing.parseError || null;
  const firstFailedAt = (priorTrouble && priorTrouble.firstFailedAt)
    || (priorError && priorError.firstFailedAt)
    || nowIso;

  let parseError = null;
  let fetchTrouble = null;

  if (outcome.kind === 'breakage') {
    parseError = { message: outcome.message, firstFailedAt };
  } else {
    // Count strikes, capped at failureGrace. The cap matters: without it a long
    // vendor outage would change the counter — and therefore commit — every
    // 5 minutes for as long as it lasted.
    const strikes = Math.min(
      ((priorTrouble && priorTrouble.consecutiveFailures) || 0) + 1,
      cfg.failureGrace);
    fetchTrouble = { message: outcome.message, firstFailedAt, consecutiveFailures: strikes };
    if (strikes >= cfg.failureGrace) {
      parseError = {
        message: outcome.message + ' (failed on ' + cfg.failureGrace + '+ consecutive runs)',
        firstFailedAt,
      };
    } else {
      console.log(vendor.label + ': transient failure ' + strikes + '/' + cfg.failureGrace
        + ' — holding last known reading, tile stays as-is.');
    }
  }

  // Carry the last known reading forward so the tile does not go blank.
  const carried = {};
  for (const k of contentKeys) {
    carried[k] = (existing[k] !== undefined && existing[k] !== null)
      ? existing[k]
      : vendor.defaults[k];
  }

  const newContent = { ...staticFields, ...carried, parseError, fetchTrouble };

  if (contentEqual(newContent, existing, compareFields)) {
    console.log(vendor.label + ': same failure state as last run — skipping write.');
    return { action: 'skipped', snapshot: null };
  }

  return write(
    { fetchedAt: nowIso, ...newContent, lastSuccessfulParse: existing.lastSuccessfulParse || null },
    parseError ? 'breakage recorded' : 'transient failure recorded');
}

module.exports = {
  TransientError,
  BreakageError,
  fetchOnce,
  fetchWithRetry,
  updateSnapshot,
  contentEqual,
  readExisting,
  DEFAULTS,
};
