#!/usr/bin/env node
'use strict';

// Collapse this repo's ten cron schedules into one.
//
// GitHub load-sheds scheduled workflows PER SCHEDULE TRIGGER. Ten separate cron
// entries each asking for a run every quarter-hour got roughly one in nine
// dispatched (measured 2026-09-20: each collector fired 5 times in 11 hours).
// Nothing was misconfigured; there were simply too many schedule entries
// competing.
//
// This script is the whole change, and it is idempotent — running it twice is a
// no-op:
//
//   1. Deletes the five parser workflows. Each body was a single
//      `fetch-snapshot.js <vendor>` call; collect.yml now runs all five
//      sequentially in one job and commits once. Five pushes per cycle -> one.
//      .github/scripts/vendors/*.js are untouched.
//
//   2. Converts the four probe workflows and alert-changes.yml from `schedule:`
//      to `workflow_call:`. Their bodies stay BYTE-IDENTICAL. Family A (parsers)
//      and Family B (inline probe heredocs) stay unmerged on purpose: porting
//      the heredocs would risk behaviour change for no gain.
//
//   3. Writes collect.yml, the single ten-minute entry point.
//
// Alerting now runs after collection instead of on its own independent cron,
// which fixes the stale-input problem as a side effect: the alerter could
// previously evaluate a cycle's alerts against the previous cycle's snapshots.
//
//   node .github/scripts/apply-consolidation.js [--check]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');

const PARSER_WORKFLOWS = [
  'fetch-aws.yml',
  'fetch-explorelearning.yml',
  'fetch-gimkit.yml',
  'fetch-noredink.yml',
  'fetch-soundtrap.yml',
];

const CALLED_WORKFLOWS = [
  'fetch-athletics-probes.yml',
  'fetch-arbitersports.yml',
  'fetch-myrj.yml',
  'fetch-rj-website.yml',
  'alert-changes.yml',
];

const WORKFLOW_CALL_BLOCK = "on:\n  # No cron here on purpose. collect.yml owns the only schedule in this repo\n  # and calls this workflow. GitHub deprioritises scheduled workflows per\n  # schedule trigger, so ten separate cron entries competing every quarter-hour\n  # got about one run in nine actually dispatched. See collect.yml.\n  workflow_call:\n  workflow_dispatch:";

const COLLECT_YML = "name: Collect status\n\n# The single scheduled entry point for the whole dashboard.\n#\n# WHY THIS EXISTS. Until 2026-09-21 this repo had ten scheduled workflows: nine\n# collectors on staggered 'N-59/15' crons plus the alerter on '*/10'. Intent was\n# a reading every 15 minutes. Measured reality on 2026-09-20 was one run every\n# 2.2 hours \u2014 GitHub load-sheds scheduled workflows per schedule trigger, and a\n# repo asking for ten dispatches every quarter-hour is exactly the shape that\n# gets deprioritised. The cron strings were all correct. There were just too\n# many of them.\n#\n# The cost was not theoretical: Blackbaud's outage onset on 9/20 is unknowable\n# to better than four hours, and the 90-minute stale threshold in index.html\n# started firing on perfectly healthy collectors because the cadence it assumes\n# had quietly stopped existing.\n#\n# ORDER MATTERS. Alerting runs after collection, so the alerter diffs against\n# snapshots written this cycle rather than the previous one. On its old\n# independent cron it could do either.\n#\n# Every job is `if: always()` so one vendor's bad day cannot stop the rest of\n# the cycle from being collected or alerted on.\n#\n# If dispatch rate is still short of the intended 144/day after this, the next\n# lever is moving the schedule off GitHub entirely (an external ping at\n# workflow_dispatch), not tuning the cron string.\n\non:\n  schedule:\n    - cron: '*/10 * * * *'\n  workflow_dispatch:\n\npermissions:\n  contents: write\n\n# A delayed cycle must not overlap the next one \u2014 they would race on the push\n# and the alerter would diff against a half-written cycle.\nconcurrency:\n  group: collect\n  cancel-in-progress: false\n\njobs:\n  # ---- Family A: parser-family vendors, one job, one commit ----------------\n  # These five were five separate workflows whose bodies were one\n  # fetch-snapshot.js call each. Running them sequentially here turns five\n  # pushes per cycle into one. The parsing logic is untouched; it still lives\n  # in .github/scripts/vendors/*.js and is still unit-tested.\n  parsers:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n\n      - name: Fetch parser-family vendors\n        id: parse\n        run: |\n          set -uo pipefail\n          # fetch-snapshot.js exits 0 for every EXPECTED failure \u2014 a timeout, a\n          # 5xx, an unrecognised page \u2014 because those are snapshot states, not\n          # run failures. A non-zero exit means the vendor MODULE crashed. Keep\n          # going so one broken module cannot cost us the other four readings,\n          # and report at the end.\n          FAILED=\"\"\n          for vendor in aws explorelearning gimkit noredink soundtrap; do\n            echo \"::group::$vendor\"\n            node .github/scripts/fetch-snapshot.js \"$vendor\" || FAILED=\"$FAILED $vendor\"\n            echo \"::endgroup::\"\n          done\n          echo \"failed=$FAILED\" >> \"$GITHUB_OUTPUT\"\n\n      - name: Commit and report\n        uses: ./.github/actions/commit-snapshot\n        with:\n          files: aws.json explorelearning.json gimkit.json noredink.json soundtrap.json\n          message: Update parser status snapshots\n\n      - name: Fail on vendor module crash\n        if: steps.parse.outputs.failed != ''\n        run: |\n          echo \"::error::vendor module crashed:${{ steps.parse.outputs.failed }}\"\n          exit 1\n\n  # ---- Family B: reachability probes ---------------------------------------\n  # Kept as separate workflow files with byte-identical bodies. Their checks are\n  # inline heredocs with per-vendor redirect and status-code reasoning; porting\n  # them into this file would risk behaviour change for no gain.\n  probe-athletics:\n    needs: parsers\n    if: always()\n    permissions:\n      contents: write\n    uses: ./.github/workflows/fetch-athletics-probes.yml\n\n  probe-arbitersports:\n    needs: parsers\n    if: always()\n    permissions:\n      contents: write\n    uses: ./.github/workflows/fetch-arbitersports.yml\n\n  probe-myrj:\n    needs: parsers\n    if: always()\n    permissions:\n      contents: write\n    uses: ./.github/workflows/fetch-myrj.yml\n\n  probe-rj-website:\n    needs: parsers\n    if: always()\n    permissions:\n      contents: write\n    uses: ./.github/workflows/fetch-rj-website.yml\n\n  # ---- Alert last, on this cycle's snapshots -------------------------------\n  alert:\n    needs: [parsers, probe-athletics, probe-arbitersports, probe-myrj, probe-rj-website]\n    if: always()\n    permissions:\n      contents: write\n    uses: ./.github/workflows/alert-changes.yml\n    secrets: inherit\n";

// Replace the top-level `on:` block with a workflow_call trigger. Only the
// trigger is touched; every other byte of the file is preserved.
function convertTrigger(text, label) {
  if (text.includes('workflow_call:')) return text;  // already converted

  const match = /^on:\n(?:[ \t#].*\n|\n(?=[ \t#]))*/m.exec(text);
  if (!match) throw new Error(label + ': could not find a top-level `on:` block');

  const block = match[0];
  if (!block.includes('schedule:')) {
    throw new Error(label + ': `on:` block has no schedule to replace');
  }

  const trailing = block.endsWith('\n\n') ? '\n' : '';
  return text.slice(0, match.index) + WORKFLOW_CALL_BLOCK + '\n' + trailing +
         text.slice(match.index + block.length);
}

function apply(check) {
  const changed = [];

  for (const name of PARSER_WORKFLOWS) {
    const p = path.join(WF, name);
    if (fs.existsSync(p)) {
      changed.push('delete ' + name);
      if (!check) fs.unlinkSync(p);
    }
  }

  for (const name of CALLED_WORKFLOWS) {
    const p = path.join(WF, name);
    if (!fs.existsSync(p)) throw new Error('missing workflow: ' + name);
    const text = fs.readFileSync(p, 'utf8');
    const converted = convertTrigger(text, name);
    if (converted !== text) {
      changed.push('convert ' + name + ' to workflow_call');
      if (!check) fs.writeFileSync(p, converted);
    }
  }

  const collect = path.join(WF, 'collect.yml');
  if (!fs.existsSync(collect) || fs.readFileSync(collect, 'utf8') !== COLLECT_YML) {
    changed.push('write collect.yml');
    if (!check) fs.writeFileSync(collect, COLLECT_YML);
  }

  return changed;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const changed = apply(check);
  if (changed.length === 0) {
    console.log('consolidation: already applied (no changes)');
    process.exit(0);
  }
  for (const line of changed) console.log((check ? 'would ' : '') + line);
  process.exit(check ? 1 : 0);
}

module.exports = { apply, convertTrigger, PARSER_WORKFLOWS, CALLED_WORKFLOWS, COLLECT_YML };
