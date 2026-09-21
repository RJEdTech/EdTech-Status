#!/usr/bin/env node
// Copies the marked block out of cloudflare-filter.js and into index.html.
//
// index.html is standalone vanilla JS served straight off GitHub Pages — no
// bundler, no module loader — so it cannot require() the filter. Rather than
// let two hand-maintained copies drift (which is how the permanent Cloudflare
// banner survived for weeks), the module is the source of truth and this script
// is the only sanctioned way to update the dashboard's copy.
//
//   node .github/scripts/sync-cf-filter.js           # write index.html
//   node .github/scripts/sync-cf-filter.js --check   # exit 1 if out of sync
//
// The --check mode is what the test suite uses.

const fs = require('fs');
const path = require('path');

const BEGIN = '// ----8<---- BEGIN SHARED CLOUDFLARE FILTER ----8<----';
const END = '// ----8<---- END SHARED CLOUDFLARE FILTER ----8<----';

const repoRoot = path.resolve(__dirname, '..', '..');
const modulePath = path.join(repoRoot, '.github', 'scripts', 'cloudflare-filter.js');
const indexPath = path.join(repoRoot, 'index.html');

// Pull the text strictly between the marker lines. Indentation of the markers
// themselves is preserved per-file; only the payload is compared.
function extractBlock(text, label) {
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begin === -1) throw new Error(`${label}: BEGIN marker not found`);
  if (end === -1) throw new Error(`${label}: END marker not found`);
  if (end < begin) throw new Error(`${label}: END marker precedes BEGIN marker`);
  return text.slice(begin + BEGIN.length, end);
}

function main() {
  const check = process.argv.includes('--check');
  const moduleText = fs.readFileSync(modulePath, 'utf8');
  const indexText = fs.readFileSync(indexPath, 'utf8');

  const source = extractBlock(moduleText, 'cloudflare-filter.js');
  const current = extractBlock(indexText, 'index.html');

  if (source === current) {
    console.log('cloudflare filter: index.html is in sync with cloudflare-filter.js');
    return 0;
  }

  if (check) {
    console.error('cloudflare filter: index.html has DRIFTED from cloudflare-filter.js.');
    console.error('Run: node .github/scripts/sync-cf-filter.js');
    return 1;
  }

  const begin = indexText.indexOf(BEGIN);
  const end = indexText.indexOf(END);
  const next = indexText.slice(0, begin + BEGIN.length) + source + indexText.slice(end);
  fs.writeFileSync(indexPath, next);
  console.log('cloudflare filter: index.html updated from cloudflare-filter.js');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { BEGIN, END, extractBlock, modulePath, indexPath };
