'use strict';

/**
 * Tests for the Gimkit (Crisp Status) reading.
 *
 *   node --test .github/scripts/test/
 *
 * The scraper broke on 2026-08-24 because Crisp reworded the banner headline
 * from "All systems are healthy at the moment." to "Looks like everything is
 * operating normally." — a copy edit that the old sentence-matching detector
 * reported as a broken status check, during a real Gimkit incident.
 *
 * So these tests are about the thing that actually changes: the wording. The
 * reading must survive a rewrite of every sentence on the page, and must still
 * refuse to guess when the page stops being a status page at all.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const gimkit = require('../vendors/gimkit');
const { BreakageError } = require('../snapshot-lib');

/**
 * Markup shaped like the real page (abbreviated), with the headline and the
 * per-replica statuses parameterised.
 */
function page({ rollup, nodes = [], headline = 'Looks like everything is operating normally.', label = '' }) {
  const replicas = nodes.map((s) => (
    '<li class="css-home-services-group-node" data-status="' + s + '">'
    + '<span class="css-home-services-group-node-replica" data-status="' + s + '">web</span></li>'
  )).join('');

  return '<!DOCTYPE html><html><head><title>Gimkit Status</title></head><body>'
    + '<aside class="css-home-status" data-status="' + rollup + '">'
    + '<div class="css-home-status-icon"></div>'
    + '<div class="css-home-status-text">'
    + '<h1 class="css-home-status-text-title css-font-sans-semibold">' + headline
    + '<span class="css-home-status-text-title-date">refreshed 18:19:22 UTC</span></h1>'
    + '<div class="css-home-status-text-label">'
    + '<p class="css-home-status-text-label-line">This status page automatically monitors our systems'
    + ' and alerts if something is not working as expected.</p>'
    + '<p class="css-home-status-text-label-line">' + label + '</p>'
    + '</div></div></aside>'
    + '<div class="css-home-services"><ul class="css-home-services-group">' + replicas + '</ul></div>'
    + '</body></html>';
}

describe('gimkit detect() — reading comes from the markup, not the prose', () => {
  test('healthy rollup reads operational', () => {
    assert.deepStrictEqual(
      gimkit.detect(page({ rollup: 'healthy', nodes: ['healthy', 'healthy', 'healthy'] })),
      { severity: 'operational' });
  });

  test('the 2026-08-24 rewording alone does not break the reading', () => {
    // Both the old and the new headline, same markup, same answer.
    const oldWords = page({
      rollup: 'healthy',
      nodes: ['healthy'],
      headline: 'All systems are healthy at the moment.',
    });
    const newWords = page({
      rollup: 'healthy',
      nodes: ['healthy'],
      headline: 'Looks like everything is operating normally.',
    });
    assert.deepStrictEqual(gimkit.detect(oldWords), gimkit.detect(newWords));
    assert.deepStrictEqual(gimkit.detect(newWords), { severity: 'operational' });
  });

  test('a headline nobody has ever seen still reads correctly', () => {
    // The whole point: the next Crisp copy edit must not become an incident.
    assert.deepStrictEqual(
      gimkit.detect(page({
        rollup: 'sick',
        nodes: ['healthy', 'sick'],
        headline: 'Hmm, a few things are having a rough time right now.',
      })),
      { severity: 'degraded' });
  });

  test('sick rollup reads degraded', () => {
    assert.deepStrictEqual(
      gimkit.detect(page({ rollup: 'sick', nodes: ['healthy', 'sick'] })),
      { severity: 'degraded' });
  });

  test('dead rollup with some replicas up reads partial', () => {
    assert.deepStrictEqual(
      gimkit.detect(page({ rollup: 'dead', nodes: ['healthy', 'dead', 'sick'] })),
      { severity: 'partial' });
  });

  test('dead rollup with every replica down reads major', () => {
    assert.deepStrictEqual(
      gimkit.detect(page({ rollup: 'dead', nodes: ['dead', 'dead'] })),
      { severity: 'major' });
  });

  test('dead rollup with no replica list is partial, not major', () => {
    // No evidence that everything is down — do not escalate on absence.
    assert.deepStrictEqual(
      gimkit.detect(page({ rollup: 'dead', nodes: [] })),
      { severity: 'partial' });
  });

  test('attribute order does not matter', () => {
    const html = '<aside data-status="sick" class="css-home-status"><h1>whatever</h1></aside>';
    assert.deepStrictEqual(gimkit.detect(html), { severity: 'degraded' });
  });
});

describe('gimkit detect() — the live page on 2026-08-24, captured during the outage', () => {
  // Read off the real page at 18:24 UTC, while one of Gimkit's four replicas was
  // down: rollup "dead", nodes [healthy, healthy, dead, healthy], headline
  // "Looks like some services are not working." NONE of the four sentences the
  // old detector looked for appear anywhere on that page — which is the whole
  // failure, reproduced.
  const LIVE_HEADLINE = 'Looks like some services are not working.';
  const live = page({
    rollup: 'dead',
    nodes: ['healthy', 'healthy', 'dead', 'healthy'],
    headline: LIVE_HEADLINE,
    label: 'Our team has been notified of the issue. If the outage persists, please contact our support.',
  });

  test('reads partial — one replica down, the rest up', () => {
    assert.deepStrictEqual(gimkit.detect(live), { severity: 'partial' });
  });

  test('none of the old banner sentences are present on that page', () => {
    for (const old of [/All systems are down/i, /Some systems are down/i,
      /Some systems are not behaving normally/i, /All systems are healthy/i]) {
      assert.ok(!old.test(live), 'expected the old pattern ' + old + ' to be absent');
    }
  });
});

describe('gimkit detect() — refusing to guess', () => {
  test('an unknown status value is breakage, not an invented severity', () => {
    assert.throws(
      () => gimkit.detect(page({ rollup: 'maintenance', nodes: ['healthy'] })),
      (err) => err instanceof BreakageError && /maintenance/.test(err.message));
  });

  test('a Crisp page with no status markers and no known banner is breakage', () => {
    const html = '<html><body><div class="css-home-services">'
      + '<h1>Something entirely new</h1></div></body></html>';
    assert.throws(() => gimkit.detect(html), BreakageError);
  });

  test('a non-status page on crisp.watch does not parse as a status page', () => {
    // The old guard tested for the string "crisp.watch", which appears on every
    // page of the domain — including the 404 — so a retired status page would
    // have been parsed as though it were still live.
    const html = '<html><body><h1>Page not found</h1>'
      + '<a href="https://crisp.watch/">Back to crisp.watch</a></body></html>';
    assert.throws(() => gimkit.detect(html), BreakageError);
  });
});

describe('gimkit detect() — wording fallback, if Crisp ever drops the attribute', () => {
  const bare = (banner) => '<html><body><div class="css-home-services"><h1>' + banner + '</h1></div></body></html>';

  test('old wording still maps as it always did', () => {
    assert.deepStrictEqual(gimkit.detect(bare('All systems are healthy at the moment.')), { severity: 'operational' });
    assert.deepStrictEqual(gimkit.detect(bare('Some systems are not behaving normally.')), { severity: 'degraded' });
    assert.deepStrictEqual(gimkit.detect(bare('Some systems are down right now.')), { severity: 'partial' });
    assert.deepStrictEqual(gimkit.detect(bare('All systems are down right now.')), { severity: 'major' });
  });

  test('the new wordings are understood too', () => {
    assert.deepStrictEqual(gimkit.detect(bare('Looks like everything is operating normally.')), { severity: 'operational' });
    assert.deepStrictEqual(gimkit.detect(bare('Looks like some services are not working.')), { severity: 'partial' });
  });
});
