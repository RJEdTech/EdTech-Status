'use strict';

/**
 * Tests for the NoRedInk (Status.io) reading.
 *
 *   node --test .github/scripts/test/*.test.js
 *
 * This vendor moved from scraping the rendered banner sentence to Status.io's
 * public JSON API on 2026-08-25. The point of these tests is that the reading
 * now comes from the numeric status code, so no amount of relabelling on
 * Status.io's or NoRedInk's side changes what we report.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const noredink = require('../vendors/noredink');
const { BreakageError } = require('../snapshot-lib');

/** A Status.io response, shaped like the real one. */
function api({ status = 'Operational', status_code = 100, extra = {} } = {}) {
  return JSON.stringify({
    result: {
      status_overall: { updated: '2026-08-25T13:00:00.000Z', status, status_code },
      status: [{ name: 'noredink.com', status: 'Operational', status_code: 100 }],
      incidents: [],
      maintenance: { active: [], upcoming: [] },
      ...extra,
    },
  });
}

describe('noredink detect() — the status code is the reading', () => {
  test('100 Operational', () => {
    assert.deepStrictEqual(noredink.detect(api()),
      { severity: 'operational', banner: 'Operational' });
  });

  test('200 Scheduled Maintenance', () => {
    assert.deepStrictEqual(
      noredink.detect(api({ status: 'Scheduled Maintenance', status_code: 200 })),
      { severity: 'maintenance', banner: 'Scheduled Maintenance' });
  });

  test('300 Degraded Performance', () => {
    assert.deepStrictEqual(
      noredink.detect(api({ status: 'Degraded Performance', status_code: 300 })),
      { severity: 'degraded', banner: 'Degraded Performance' });
  });

  test('400 Partial Service Disruption', () => {
    assert.deepStrictEqual(
      noredink.detect(api({ status: 'Partial Service Disruption', status_code: 400 })),
      { severity: 'partial', banner: 'Partial Service Disruption' });
  });

  test('500 Service Disruption maps as the old scraper did', () => {
    assert.deepStrictEqual(
      noredink.detect(api({ status: 'Service Disruption', status_code: 500 })),
      { severity: 'partial', banner: 'Service Disruption' });
  });

  test('a relabelled status does not change the severity', () => {
    // Status.io lets customers rename their status labels. The number is what
    // we read, so the rename is cosmetic — this is the whole reason for the
    // rewrite.
    assert.deepStrictEqual(
      noredink.detect(api({ status: 'Everything is peachy 🍑', status_code: 100 })),
      { severity: 'operational', banner: 'Everything is peachy 🍑' });
  });
});

describe('noredink detect() — refusing to guess', () => {
  test('an undocumented status code is check_page, not an invented severity', () => {
    const out = noredink.detect(api({ status: 'Frobnicating', status_code: 700 }));
    assert.strictEqual(out.severity, 'check_page');
    assert.strictEqual(out.banner, 'Frobnicating');
  });

  test('a missing status label still yields something diagnosable', () => {
    const out = noredink.detect(JSON.stringify({
      result: { status_overall: { status_code: 999 } },
    }));
    assert.strictEqual(out.severity, 'check_page');
    assert.match(out.banner, /999/);
  });

  test('HTML instead of JSON is breakage', () => {
    // What we would get if the API were retired and the host served a page.
    assert.throws(() => noredink.detect('<html><body>Not found</body></html>'), BreakageError);
  });

  test('JSON without result.status_overall is breakage', () => {
    assert.throws(() => noredink.detect(JSON.stringify({ result: {} })), BreakageError);
    assert.throws(() => noredink.detect(JSON.stringify({ error: 'bad id' })), BreakageError);
  });
});

describe('noredink module wiring', () => {
  test('reads the API but reports the human page as its source', () => {
    assert.match(noredink.url, /^https:\/\/api\.status\.io\/1\.0\/status\/[a-f0-9]{24}$/);
    assert.strictEqual(noredink.static.source, 'https://noredinkstatus.com/');
    assert.strictEqual(noredink.fetch.allowedHost, 'status.io');
    assert.strictEqual(noredink.fetch.accept, 'application/json');
  });

  test('the snapshot keeps its existing field shape', () => {
    assert.deepStrictEqual(Object.keys(noredink.defaults), ['severity', 'banner']);
  });
});
