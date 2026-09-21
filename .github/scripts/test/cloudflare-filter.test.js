// Tests for the shared Cloudflare filter.
//
// The rule under test: Cloudflare's severity comes from unresolved INCIDENTS on
// RJ's traffic path — never the page-wide indicator, never component state,
// never scheduled maintenance.
//
//   node --test .github/scripts/test/

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cf = require('../cloudflare-filter.js');
const sync = require('../sync-cf-filter.js');
const { evaluateCloudflare, classifyCloudflareIncident, cloudflareIncidentSeverity } = cf;

// Helpers -------------------------------------------------------------------

const status = (indicator, description) => ({ status: { indicator, description } });
const incident = (name, over) => Object.assign({
  id: 'x', name, status: 'identified', impact: 'minor',
  created_at: '2026-09-20T00:00:00.000Z', updated_at: '2026-09-20T01:00:00.000Z',
}, over || {});
const list = (...incidents) => ({ incidents });

// The real payload Cloudflare was serving on 2026-09-21, the day the permanent
// banner was diagnosed. Kept verbatim: this is the regression.
const LIVE_20260921_STATUS = {
  page: { id: 'yh6f0r4529hb', name: 'Cloudflare Status' },
  status: { indicator: 'minor', description: 'Minor Service Outage' },
};
const LIVE_20260921_INCIDENTS = {
  page: { id: 'yh6f0r4529hb', name: 'Cloudflare Status' },
  incidents: [{
    id: '9g65dxfbcjln',
    name: 'Incorrect geo location for some Cloudflare WARP users',
    status: 'identified',
    impact: 'minor',
    created_at: '2026-08-27T18:46:19.000Z',
    updated_at: '2026-09-01T08:29:56.000Z',
    shortlink: 'https://www.cloudflarestatus.com/incidents/9g65dxfbcjln',
  }],
};

// 1. The regression --------------------------------------------------------

test('THE REGRESSION: live 2026-09-21 payload reads operational', () => {
  const v = evaluateCloudflare(LIVE_20260921_STATUS, LIVE_20260921_INCIDENTS);
  assert.strictEqual(v.severity, 'operational',
    'indicator was "minor" all day with only a WARP incident open — this is the ' +
    'exact state that produced the permanent yellow banner');
  assert.strictEqual(v.filtered.length, 1);
  assert.strictEqual(v.impacting.length, 0);
});

test('the tile still names what Cloudflare reports, even when green for us', () => {
  const v = evaluateCloudflare(LIVE_20260921_STATUS, LIVE_20260921_INCIDENTS);
  assert.match(v.incident.name, /WARP/, 'reader should still see what CF is reporting');
  assert.match(v.statusText, /not on our traffic path/);
});

// 2. The indicator must never decide anything ------------------------------

test('non-green indicator with zero incidents is operational', () => {
  const v = evaluateCloudflare(status('minor', 'Minor Service Outage'), list());
  assert.strictEqual(v.severity, 'operational');
});

test('critical indicator with zero incidents is still operational', () => {
  const v = evaluateCloudflare(status('critical', 'Major Service Outage'), list());
  assert.strictEqual(v.severity, 'operational',
    'component/POP state and maintenance windows drive the indicator, not us');
});

test('green indicator does not suppress a real impacting incident', () => {
  const v = evaluateCloudflare(
    status('none', 'All Systems Operational'),
    list(incident('CDN outage in Denver (DEN)', { impact: 'major' })));
  assert.strictEqual(v.severity, 'partial');
});

test('missing status.json entirely does not break the reading', () => {
  const v = evaluateCloudflare(null, list(incident('Widespread CDN failure', { impact: 'critical' })));
  assert.strictEqual(v.severity, 'major');
});

// 3. Resolved and scheduled work is excluded -------------------------------

test('resolved incidents are ignored', () => {
  const v = evaluateCloudflare(status('minor'), list(
    incident('CDN degradation in Ashburn (IAD)', { status: 'resolved', impact: 'major' })));
  assert.strictEqual(v.severity, 'operational');
});

test('postmortem incidents are ignored', () => {
  const v = evaluateCloudflare(status('minor'), list(
    incident('DDoS mitigation issue', { status: 'postmortem', impact: 'critical' })));
  assert.strictEqual(v.severity, 'operational');
});

test('scheduled maintenance in the payload never counts', () => {
  // summary.json keeps maintenances in their own array; a maintenance that
  // leaked into `incidents` still carries a scheduled status.
  const v = evaluateCloudflare(status('maintenance'), {
    incidents: [],
    scheduled_maintenances: [{ name: 'Denver (DEN) maintenance', status: 'in_progress' }],
  });
  assert.strictEqual(v.severity, 'operational');
});

// 4. Severity comes from the incident's own impact -------------------------

test('incident impact maps to our severity vocabulary', () => {
  assert.strictEqual(cloudflareIncidentSeverity('critical'), 'major');
  assert.strictEqual(cloudflareIncidentSeverity('major'), 'partial');
  assert.strictEqual(cloudflareIncidentSeverity('minor'), 'degraded');
  assert.strictEqual(cloudflareIncidentSeverity('none'), 'degraded');
  assert.strictEqual(cloudflareIncidentSeverity(undefined), 'degraded');
});

test('worst impacting incident wins when several are open', () => {
  const v = evaluateCloudflare(status('major'), list(
    incident('DNS Issues in Chicago (ORD)', { impact: 'minor' }),
    incident('WAF errors', { impact: 'critical' }),
    incident('Workers deploys failing', { impact: 'critical' })));
  assert.strictEqual(v.severity, 'major');
  assert.match(v.incident.name, /WAF errors/);
  assert.match(v.incident.name, /\+1 more/, 'the other impacting incident is counted');
  assert.strictEqual(v.filtered.length, 1, 'Workers is off our path');
});

// 5. Classification is unchanged and still conservative --------------------

test('unmatched incident names stay ambiguous and escalate', () => {
  assert.strictEqual(classifyCloudflareIncident('Elevated error rates in Quuxville'), 'ambiguous');
  const v = evaluateCloudflare(status('minor'), list(
    incident('Elevated error rates in Quuxville', { impact: 'major' })));
  assert.strictEqual(v.severity, 'partial');
  assert.match(v.statusText, /unclear whether RJ is affected/);
});

test('an empty incident name is ambiguous, not silently green', () => {
  assert.strictEqual(classifyCloudflareIncident(''), 'ambiguous');
  assert.strictEqual(classifyCloudflareIncident(undefined), 'ambiguous');
});

test('impacting keywords beat not-impacting keywords in the same title', () => {
  // "Workers" is filtered, "CDN" is not — a title carrying both must escalate.
  assert.strictEqual(classifyCloudflareIncident('Workers and CDN errors'), 'rj-impacting');
});

test('known off-path products and non-NA cities are filtered', () => {
  for (const name of ['WARP connectivity', 'Zero Trust Gateway degraded',
                      'R2 elevated errors', 'Cloudflare Pages builds delayed',
                      'Network issues in Frankfurt', 'Turnstile failures']) {
    assert.strictEqual(classifyCloudflareIncident(name), 'rj-not-impacting', name);
  }
});

test('Denver and the Aurora-adjacent POPs are on our path', () => {
  for (const name of ['Network degradation in Denver (DEN)',
                      'Packet loss in Dallas (DFW)',
                      'Authoritative DNS errors']) {
    assert.strictEqual(classifyCloudflareIncident(name), 'rj-impacting', name);
  }
});

// 6. Honest failure --------------------------------------------------------

test('an unreadable incident list is reported, not papered over', () => {
  const v = evaluateCloudflare(status('minor', 'Minor Service Outage'), null,
    { incidentsUnavailable: true });
  assert.strictEqual(v.severity, 'degraded');
  assert.match(v.statusText, /Could not read/);
});

test('an unreadable incident list on a green page stays green', () => {
  const v = evaluateCloudflare(status('none', 'All Systems Operational'), null,
    { incidentsUnavailable: true });
  assert.strictEqual(v.severity, 'operational');
});

// 7. The drift guard -------------------------------------------------------

test('index.html carries a byte-identical copy of the shared block', () => {
  const moduleText = fs.readFileSync(sync.modulePath, 'utf8');
  const indexText = fs.readFileSync(sync.indexPath, 'utf8');
  assert.strictEqual(
    sync.extractBlock(indexText, 'index.html'),
    sync.extractBlock(moduleText, 'cloudflare-filter.js'),
    'index.html has drifted — run: node .github/scripts/sync-cf-filter.js');
});

test('the shared block is free of require/module.exports', () => {
  const block = sync.extractBlock(fs.readFileSync(sync.modulePath, 'utf8'), 'cloudflare-filter.js');
  assert.ok(!/\brequire\s*\(/.test(block), 'the block must run inside a <script> tag');
  assert.ok(!/\bmodule\.exports\b/.test(block), 'the block must run inside a <script> tag');
});

test('alert-changes.yml and index.html agree on the Cloudflare endpoints', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const yml = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'alert-changes.yml'), 'utf8');
  const html = fs.readFileSync(sync.indexPath, 'utf8');
  const endpoint = 'https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json';
  assert.ok(yml.includes(endpoint), 'alerter must read unresolved incidents');
  assert.ok(html.includes(endpoint), 'dashboard must read unresolved incidents');
  assert.ok(!/cloudflarestatus\.com\/api\/v2\/summary\.json/.test(yml + html),
    'summary.json carries components and maintenances — neither may drive this tile');
});
