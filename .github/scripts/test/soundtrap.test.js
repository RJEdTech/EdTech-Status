'use strict';

/**
 * Tests for the Soundtrap reading.
 *
 *   node --test .github/scripts/test/*.test.js
 *
 * Soundtrap's page has no API and no status markup — one sentence is the whole
 * source. So these tests are about the failure mode rather than the source: a
 * rewrite of that sentence that still means "fine" must not raise a false
 * alarm, and a page that reads as trouble must not slip through as healthy.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const soundtrap = require('../vendors/soundtrap');
const { BreakageError } = require('../snapshot-lib');

/** Shaped like the live page: heading, one status line, contact boilerplate. */
function page(statusLine) {
  return '<!DOCTYPE html><html><head><meta name="robots" content="noindex">'
    + '<title>System status - Soundtrap</title></head><body>'
    + '<h1>Soundtrap System Status</h1>'
    + '<p>' + statusLine + '</p>'
    + '<p>If you are experiencing issues, please contact support.</p>'
    + '</body></html>';
}

describe('soundtrap detect() — the page as it reads today', () => {
  test('the known sentence reads operational', () => {
    assert.deepStrictEqual(soundtrap.detect(page('Soundtrap is working fine.')),
      { status: 'operational' });
  });

  test('the contact boilerplate is not read as trouble', () => {
    // "If you are experiencing issues, please contact support." sits on the
    // healthy page. Reading it as a status would alarm on a green page.
    const out = soundtrap.detect(page('Soundtrap is working fine.'));
    assert.strictEqual(out.status, 'operational');
  });
});

describe('soundtrap detect() — a reworded healthy page stays green', () => {
  for (const line of [
    'All systems operational.',
    'Everything is running normally.',
    'Soundtrap is working normally.',
    'No known issues at this time.',
    'Soundtrap is up and running.',
  ]) {
    test(JSON.stringify(line), () => {
      assert.strictEqual(soundtrap.detect(page(line)).status, 'operational');
    });
  }
});

describe('soundtrap detect() — trouble draws attention', () => {
  for (const line of [
    'Soundtrap is experiencing issues with playback.',
    'We are investigating a service disruption.',
    'Some users cannot open projects.',
    'Soundtrap is not working for all users.',
    'Soundtrap is under maintenance.',
  ]) {
    test(JSON.stringify(line), () => {
      assert.strictEqual(soundtrap.detect(page(line)).status, 'check_page');
    });
  }

  test('trouble wins when a page says both', () => {
    const out = soundtrap.detect(page('Soundtrap is working fine, but some users report a service disruption.'));
    assert.strictEqual(out.status, 'check_page');
  });
});

describe('soundtrap detect() — the unknown case', () => {
  test('wording we cannot classify is check_page, not breakage', () => {
    assert.deepStrictEqual(soundtrap.detect(page('Status: 7.')), { status: 'check_page' });
  });

  test('a page that is not Soundtrap\'s status page is breakage', () => {
    assert.throws(
      () => soundtrap.detect('<html><head><title>Make music online</title></head><body>Sign up</body></html>'),
      BreakageError);
  });
});
