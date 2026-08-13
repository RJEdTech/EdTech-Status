#!/usr/bin/env node
'use strict';

/**
 * CLI entry point for the parser-family scrapers.
 *
 *   node .github/scripts/fetch-snapshot.js gimkit
 *
 * Loads .github/scripts/vendors/<name>.js and runs it through snapshot-lib.
 * Always exits 0 — reporting breakage to GitHub is the commit-snapshot action's
 * job, so that the snapshot still gets committed before the run goes red.
 */

const path = require('path');
const { updateSnapshot } = require('./snapshot-lib');

const name = process.argv[2];
if (!name) {
  console.error('usage: fetch-snapshot.js <vendor>');
  process.exit(2);
}

let vendor;
try {
  vendor = require(path.join(__dirname, 'vendors', name + '.js'));
} catch (err) {
  console.error('::error::No vendor module for "' + name + '": ' + err.message);
  process.exit(2);
}

updateSnapshot(vendor)
  .then((res) => {
    if (res.action === 'written') console.log(JSON.stringify(res.snapshot, null, 2));
  })
  .catch((err) => {
    // A throw here is a bug in the vendor module, not a vendor outage — the
    // library converts every expected failure into a snapshot state.
    console.error('::error::Unexpected error running "' + name + '": ' + (err && err.stack || err));
    process.exit(1);
  });
