'use strict';

/**
 * Tests for the ExploreLearning reading.
 *
 *   node --test .github/scripts/test/*.test.js
 *
 * ExploreLearning has no API, so the page is the source. What it does have is a
 * <section> whose id names the state (`site-status-a-ok`). These tests hold the
 * reading to that id rather than to any sentence or CSS class, and cover the
 * two bugs the 2026-08-25 pass fixed: the reading dropping to check_page when a
 * style class changes, and notice headlines picking up nav boilerplate.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const el = require('../vendors/explorelearning');
const { BreakageError } = require('../snapshot-lib');

const PAGE_SENTENCE = 'This page monitors issues and downtime that may affect access and use of ExploreLearning services.';

function page(inner, { title = 'Site Status | ExploreLearning' } = {}) {
  return '<!DOCTYPE html><html><head><title>' + title + '</title></head><body>'
    + '<a href="#main">Skip to main content</a>'
    + '<nav><ul><li>Products</li><li>Support</li><li>Contact us</li></ul></nav>'
    + '<main id="main-content"><h1>Site Status</h1><h2>' + PAGE_SENTENCE + '</h2>'
    + inner
    + '</main></body></html>';
}

// Shaped like the live page on 2026-08-25.
const AOK = page(
  '<section id="site-status-a-ok" class="banner-responsive-bottom hyperlink-black">'
  + '<div class="container container-lg"><p class="h1 xbold mb-0 text-green">A-OK!</p>'
  + '<p>All ExploreLearning sites are currently working with no issues.</p></div></section>');

function noticePage(headline, detail, { id = 'site-status-notice' } = {}) {
  return page(
    '<section id="' + id + '" class="banner-responsive-bottom">'
    + '<div class="container"><img alt="We&rsquo;re on it!" src="/img/on-it.png">'
    + '<p class="h1 xbold">' + headline + '</p>'
    + '<p>' + detail + '</p>'
    + '<p>Our team is working to resolve the issue as soon as possible.</p>'
    + '</div></section>');
}

describe('explorelearning detect() — the section id names the state', () => {
  test('the A-OK section reads operational', () => {
    assert.deepStrictEqual(el.detect(AOK), { status: 'operational', notice: null });
  });

  test('a restyle does not downgrade a healthy tile', () => {
    // The old detector also required "A-OK!" inside a .text-green element, so
    // dropping that class quietly turned a green tile into check_page.
    const restyled = AOK.replace('text-green', 'text-emerald-600').replace('A-OK!', 'All good!');
    assert.deepStrictEqual(el.detect(restyled), { status: 'operational', notice: null });
  });

  test('a notice section reads degraded and keeps the notice', () => {
    const out = el.detect(noticePage(
      'Gizmos is loading slowly for some users',
      'We are seeing elevated error rates when launching Gizmos.'));
    assert.strictEqual(out.status, 'degraded');
    assert.strictEqual(out.notice.kind, 'incident');
    assert.strictEqual(out.notice.affectsRJ, true);
  });

  test('the notice headline comes from the notice, not from the nav', () => {
    // The old parser read a blind 4 KB window of markup before the closing
    // sentence, so the "headline" was routinely nav boilerplate.
    const out = el.detect(noticePage(
      'Gizmos is loading slowly for some users',
      'Elevated error rates when launching Gizmos.'));
    assert.strictEqual(out.notice.headline, 'Gizmos is loading slowly for some users');
    assert.doesNotMatch(out.notice.headline, /Skip to|Products|Support/);
  });

  test('an unfamiliar state id is still read as a notice', () => {
    const out = el.detect(noticePage(
      'Scheduled maintenance for Gizmos this Saturday',
      'Gizmos will be unavailable 2-4am ET.',
      { id: 'site-status-heads-up' }));
    assert.strictEqual(out.status, 'maintenance');
  });
});

describe('explorelearning detect() — RJ scoping is unchanged', () => {
  test('a notice naming only non-RJ products does not degrade our tile', () => {
    const out = el.detect(noticePage(
      'Reflex and Frax are unavailable',
      'Science4Us customers may also see errors.'));
    assert.strictEqual(out.status, 'operational');
    assert.strictEqual(out.notice.affectsRJ, false);
  });

  test('a sitewide notice does degrade our tile', () => {
    const out = el.detect(noticePage(
      'All ExploreLearning sites are unavailable',
      'We are investigating a platform-wide outage.'));
    assert.strictEqual(out.status, 'degraded');
    assert.strictEqual(out.notice.affectsRJ, true);
  });
});

describe('explorelearning detect() — recognisable vs gone', () => {
  test('the prose anchors still work if the section ids disappear', () => {
    const noIds = page(
      '<div><img alt="We&rsquo;re on it!" src="/img/on-it.png">'
      + '<p class="h1">Gizmos is down</p><p>We are on it.</p>'
      + '<p>Our team is working to resolve the issue as soon as possible.</p></div>');
    const out = el.detect(noIds);
    assert.strictEqual(out.status, 'degraded');
    assert.strictEqual(out.notice.headline, 'Gizmos is down');
  });

  test('a recognisable page with an unreadable state is check_page, not a red run', () => {
    assert.deepStrictEqual(
      el.detect(page('<section class="redesigned"><p>Something new</p></section>')),
      { status: 'check_page', notice: null });
  });

  test('a page that is not the status page at all is breakage', () => {
    const marketing = '<html><head><title>Gizmos | ExploreLearning</title></head>'
      + '<body><h1>Buy Gizmos for your district</h1></body></html>';
    assert.throws(() => el.detect(marketing), BreakageError);
  });
});
