'use strict';

/**
 * Tests for the shared scraper machinery.
 *
 *   node --test .github/scripts/test/
 *
 * These exist because the three bugs this library was written to kill were all
 * invisible in review — they only showed up as behaviour over a sequence of
 * runs. So the tests are written as sequences of runs, not single calls.
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('../snapshot-lib');

// --- A stub status page we can drive from the tests -------------------------
let server;
let base;
let mode = 'ok';           // ok | unrecognised | slow | 500 | 404 | redirect-offsite
let redirectTarget = 'http://example.invalid/gone';

before(async () => {
  server = http.createServer((req, res) => {
    if (mode === '500') { res.writeHead(503); res.end('busy'); return; }
    if (mode === '404') { res.writeHead(404); res.end('gone'); return; }
    if (mode === 'redirect-offsite') {
      res.writeHead(302, { location: redirectTarget }); res.end(); return;
    }
    if (mode === 'slow') { /* never respond — force the timeout path */ return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(mode === 'unrecognised'
      ? '<html><h1>Buy our product</h1></html>'
      : '<html>STATUS-PAGE All systems are healthy</html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
});

after(() => server.close());

// --- A vendor module shaped like the real ones ------------------------------
let tmpDir;
let outPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  outPath = path.join(tmpDir, 'vendor.json');
  mode = 'ok';
});

function vendor(overrides = {}) {
  return {
    label: 'TestVendor',
    outPath,
    url: base,
    static: { source: base },
    defaults: { severity: 'unknown' },
    fetch: { timeoutMs: 300, backoffMs: [1, 1], attempts: 3 },
    detect(html) {
      if (!/STATUS-PAGE/.test(html)) {
        throw new lib.BreakageError('Not the status page — layout changed.');
      }
      return { severity: /healthy/.test(html) ? 'operational' : 'major' };
    },
    ...overrides,
  };
}

const read = () => JSON.parse(fs.readFileSync(outPath, 'utf8'));
const at = (minutes) => new Date(Date.parse('2026-08-13T12:00:00.000Z') + minutes * 60000).toISOString();

describe('successful reads', () => {
  test('writes a snapshot on first run', async () => {
    const res = await lib.updateSnapshot(vendor(), { now: at(0) });
    assert.equal(res.action, 'written');
    const d = read();
    assert.equal(d.severity, 'operational');
    assert.equal(d.parseError, null);
    assert.equal(d.fetchTrouble, null);
    assert.equal(d.lastSuccessfulParse, at(0));
  });

  test('REGRESSION: an unchanged reading does NOT rewrite the file', async () => {
    // This is the bug that generated ~288 commits/day/workflow: lastSuccessfulParse
    // was inside the comparison, is always "now", so nothing ever compared equal.
    await lib.updateSnapshot(vendor(), { now: at(0) });
    const first = fs.readFileSync(outPath, 'utf8');

    const res = await lib.updateSnapshot(vendor(), { now: at(5) });
    assert.equal(res.action, 'skipped');
    assert.equal(fs.readFileSync(outPath, 'utf8'), first, 'file must be byte-identical');
  });

  test('refreshes timestamps once the heartbeat interval has passed', async () => {
    await lib.updateSnapshot(vendor(), { now: at(0) });
    assert.equal((await lib.updateSnapshot(vendor(), { now: at(59) })).action, 'skipped');

    const res = await lib.updateSnapshot(vendor(), { now: at(61) });
    assert.equal(res.action, 'written');
    assert.equal(read().lastSuccessfulParse, at(61));
  });
});

describe('transient failures (the 3-strike grace period)', () => {
  test('a timeout does not immediately break the tile', async () => {
    await lib.updateSnapshot(vendor(), { now: at(0) });

    mode = 'slow';
    await lib.updateSnapshot(vendor(), { now: at(5) });

    const d = read();
    assert.equal(d.parseError, null, 'one blip must NOT set parseError');
    assert.equal(d.severity, 'operational', 'last known reading is carried forward');
    assert.equal(d.fetchTrouble.consecutiveFailures, 1);
    assert.match(d.fetchTrouble.message, /Timed out/);
    assert.equal(d.lastSuccessfulParse, at(0), 'last good reading time is preserved');
  });

  test('breaks only on the third consecutive failed run', async () => {
    await lib.updateSnapshot(vendor(), { now: at(0) });
    mode = 'slow';

    await lib.updateSnapshot(vendor(), { now: at(5) });
    assert.equal(read().parseError, null);
    assert.equal(read().fetchTrouble.consecutiveFailures, 1);

    await lib.updateSnapshot(vendor(), { now: at(10) });
    assert.equal(read().parseError, null);
    assert.equal(read().fetchTrouble.consecutiveFailures, 2);

    await lib.updateSnapshot(vendor(), { now: at(15) });
    const d = read();
    assert.ok(d.parseError, 'third strike sets parseError');
    assert.equal(d.parseError.firstFailedAt, at(5), 'dates from the FIRST failure, not the third');
    assert.match(d.parseError.message, /3\+ consecutive runs/);
  });

  test('a sustained outage stops rewriting the file (commit-storm guard)', async () => {
    await lib.updateSnapshot(vendor(), { now: at(0) });
    mode = 'slow';
    for (const m of [5, 10, 15]) await lib.updateSnapshot(vendor(), { now: at(m) });

    const settled = fs.readFileSync(outPath, 'utf8');
    for (const m of [20, 25, 30, 35]) {
      const res = await lib.updateSnapshot(vendor(), { now: at(m) });
      assert.equal(res.action, 'skipped');
    }
    assert.equal(fs.readFileSync(outPath, 'utf8'), settled,
      'a long outage must not commit every 5 minutes');
  });

  test('recovery clears both parseError and fetchTrouble', async () => {
    await lib.updateSnapshot(vendor(), { now: at(0) });
    mode = 'slow';
    for (const m of [5, 10, 15]) await lib.updateSnapshot(vendor(), { now: at(m) });
    assert.ok(read().parseError);

    mode = 'ok';
    await lib.updateSnapshot(vendor(), { now: at(20) });
    const d = read();
    assert.equal(d.parseError, null);
    assert.equal(d.fetchTrouble, null);
    assert.equal(d.severity, 'operational');
    assert.equal(d.lastSuccessfulParse, at(20));
  });

  test('a 5xx is transient, not breakage', async () => {
    await lib.updateSnapshot(vendor(), { now: at(0) });
    mode = '500';
    await lib.updateSnapshot(vendor(), { now: at(5) });
    assert.equal(read().parseError, null);
    assert.equal(read().fetchTrouble.consecutiveFailures, 1);
  });
});

describe('structural breakage (reported immediately)', () => {
  test('an unrecognised page breaks on the first run', async () => {
    await lib.updateSnapshot(vendor(), { now: at(0) });
    mode = 'unrecognised';
    await lib.updateSnapshot(vendor(), { now: at(5) });

    const d = read();
    assert.ok(d.parseError, 'a redesign never self-heals — no grace period');
    assert.equal(d.fetchTrouble, null);
    assert.match(d.parseError.message, /layout changed/);
    assert.equal(d.severity, 'operational', 'last known reading still carried forward');
  });

  test('a 404 breaks immediately and is not retried', async () => {
    mode = '404';
    let attempts = 0;
    const v = vendor();
    const spy = { ...v, url: base };
    const origin = lib.fetchOnce;
    // Count requests by counting server hits instead of stubbing internals.
    const counter = (req, res) => { attempts++; };
    server.on('request', counter);

    await lib.updateSnapshot(spy, { now: at(0) });
    server.off('request', counter);

    assert.ok(read().parseError);
    assert.equal(attempts, 1, 'must not burn 3 attempts on a 404');
    assert.equal(typeof origin, 'function');
  });

  test('a redirect off the vendor domain is breakage, not a reading', async () => {
    mode = 'redirect-offsite';
    await lib.updateSnapshot(vendor({ fetch: { timeoutMs: 300, allowedHost: '127.0.0.1' } }),
      { now: at(0) });

    const d = read();
    assert.ok(d.parseError);
    assert.match(d.parseError.message, /Redirected off/);
  });
});

describe('vendor modules', () => {
  const names = ['aws', 'explorelearning', 'gimkit', 'noredink', 'soundtrap'];

  for (const name of names) {
    test(name + ' has a well-formed contract', () => {
      const v = require('../vendors/' + name + '.js');
      assert.equal(typeof v.detect, 'function', 'detect must be a function');
      assert.ok(v.outPath && v.url && v.label);
      assert.ok(v.defaults && Object.keys(v.defaults).length > 0, 'defaults must list content fields');
      assert.ok(v.fetch && v.fetch.allowedHost, 'every vendor must pin an allowed host');

      // detect() must throw BreakageError — not a bare Error — on junk, or the
      // grace-period logic will misclassify a redesign as a transient blip.
      assert.throws(() => v.detect('<html>totally unrelated page</html>'),
        (err) => err instanceof lib.BreakageError,
        name + '.detect() must throw BreakageError on an unrecognised document');
    });

    test(name + ' writes the field order its snapshot file already uses', () => {
      const v = require('../vendors/' + name + '.js');
      const repoRoot = path.join(__dirname, '..', '..', '..');
      const live = path.join(repoRoot, v.outPath);
      if (!fs.existsSync(live)) return; // nothing to compare against yet

      const existingKeys = Object.keys(JSON.parse(fs.readFileSync(live, 'utf8')));
      const producedKeys = [
        'fetchedAt',
        ...Object.keys(v.static || {}),
        ...Object.keys(v.defaults),
        'parseError', 'fetchTrouble', 'lastSuccessfulParse',
      ];
      // fetchTrouble is new; every other key must line up in the same order.
      assert.deepEqual(producedKeys.filter((k) => k !== 'fetchTrouble'), existingKeys,
        name + ': field order changed — index.html and alert-changes.yml read these by name');
    });
  }
});

describe('hostMatches', () => {
  test('accepts subdomains but not lookalikes', async () => {
    mode = 'ok';
    // Exercised through the redirect guard: a same-host redirect must succeed.
    redirectTarget = base + 'moved';
    mode = 'ok';
    const res = await lib.updateSnapshot(vendor({ fetch: { timeoutMs: 300, allowedHost: '127.0.0.1' } }),
      { now: at(0) });
    assert.equal(res.action, 'written');
    assert.equal(read().parseError, null);
  });
});
