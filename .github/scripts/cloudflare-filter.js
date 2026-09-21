//=============================================================================
// CLOUDFLARE INCIDENT FILTERING — shared source of truth
//=============================================================================
// This module is the single definition of how RJ reads Cloudflare's status.
// index.html carries a byte-identical copy of the marked block below, because
// the dashboard is standalone vanilla JS with no module loader. The copies are
// compared by .github/scripts/test/cloudflare-filter.test.js, which fails the
// build on drift. Edit HERE, then re-run `node .github/scripts/sync-cf-filter.js`
// to push the block into index.html.
//
// Everything between the BEGIN and END markers must stay free of require(),
// module.exports, and anything else that cannot run inside a <script> tag.

// ----8<---- BEGIN SHARED CLOUDFLARE FILTER ----8<----
// RJ doesn't use Cloudflare directly — we feel CF outages only when they hit
// products that vendor sites we DO use (Canvas, NoRedInk) depend on.
//
// THE RULE, learned the hard way on 2026-09-21:
//
//   Cloudflare's severity comes from unresolved INCIDENTS on our traffic path.
//   Never the page-wide indicator. Never component state. Never scheduled
//   maintenance.
//
// Why: Cloudflare publishes ~480 components covering every POP and region on
// earth. On a normal day dozens are in partial_outage or under_maintenance, so
// status.indicator is essentially never 'none'. Reading the indicator — which
// both the tile and the alerter used to do — produced a permanent "Cloudflare
// is reporting issues" banner that told teachers nothing and trained them to
// ignore the banner entirely. A signal that is always on is not a signal.
//
// Each unresolved incident's NAME is classified into one of three buckets:
//
//   'rj-impacting'     → counts; severity comes from the incident's impact
//   'rj-not-impacting' → filtered out of the severity decision entirely
//   'ambiguous'        → conservative default, counted as impacting
//
// Tuning principle, unchanged: false negatives (missing a real outage) are
// worse than false positives (flagging unnecessarily). An incident matching no
// keyword at all is 'ambiguous' and still escalates.
//
// VIVI NOTE: Vivi (classroom display) is on AWS but we have not confirmed
// whether it's also fronted by Cloudflare. If a real-world correlation is
// observed (Cloudflare yellow + Vivi degraded simultaneously), add Vivi
// to VENDOR_DEPS_CF and reconsider the dependency map.
//
// TURNSTILE NOTE: Cloudflare Turnstile (CAPTCHA) can be embedded in third-
// party sites. No RJ vendor is known to use it on login screens, so it's
// classified as not-impacting. If a vendor (e.g., a future tool) starts
// using Turnstile, revisit.

// Keywords that indicate the incident WOULD affect RJ. If any of these
// match the incident name, classify as rj-impacting.
const CF_IMPACTING_KEYWORDS = [
  // Core proxy / network path — directly carries vendor traffic
  'cdn', 'cache', 'network performance',
  'authoritative dns', 'recursive dns', 'dns updates', 'dns firewall',
  ' dns ',  // catches "DNS Issues" but not "Authoritative DNS" already matched
  'ssl certificate', 'ssl for saas', 'certificate provisioning',
  'rules', 'firewall', 'waf',
  'challenge platform',
  'load balanc',
  'spectrum', 'websockets',
  'always online',
  'ddos',
  // Generic geographic indicators that imply NA impact
  'united states', 'us east', 'us west', 'us central',
  'eastern region', 'central region', 'western region',
  'north america',
  // North American POPs in plausible Aurora, CO routing path
  'denver', '(den)',
  'dallas', '(dfw)',
  'salt lake', '(slc)',
  'chicago', '(ord)',
  'ashburn', '(iad)',
  'atlanta', '(atl)',
  'kansas city', '(mci)',
  'phoenix', '(phx)',
  'los angeles', '(lax)',
  'san jose', '(sjc)',
  'san francisco', '(sfo)',
  'seattle', '(sea)',
  'newark', '(ewr)',
  'miami', '(mia)',
  'minneapolis', '(msp)',
  'st. louis', '(stl)',
];

// Keywords that indicate the incident DOES NOT affect RJ. Used only when
// no impacting keyword has matched (impacting takes priority).
const CF_NOT_IMPACTING_KEYWORDS = [
  // Zero Trust suite — RJ uses Microsoft Entra, not Cloudflare Access
  'access', 'warp', 'zero trust', 'tunnel',
  'browser isolation', 'casb', 'dlp', 'dex',
  'gateway', 'cloudflare one',
  // Developer platform — no RJ vendor uses these in user-visible ways
  'workers', 'wrangler', 'durable object', 'd1', 'r2', 'kv',
  'queues', 'hyperdrive', 'vectorize', 'workflows',
  // Media products
  'stream', 'image', 'mirage',
  // Static hosting (RJ uses GitHub Pages, not Cloudflare Pages)
  'pages',
  // Email / brand / page protection — not on RJ traffic path
  'email routing', 'email security', 'area 1', 'brand protection',
  'page shield',
  // Turnstile (CAPTCHA) — no known RJ vendor uses it
  'turnstile',
  // Customer-facing CF infrastructure (we're not a CF customer)
  'registrar', 'rdap', 'billing', 'subscription',
  'dashboard', 'api shield',
  'analytics', 'observatory', 'radar', 'trace', 'audit log',
  // Enterprise networking
  'magic transit', 'cni', 'wan', 'cloud network interconnect',
  'bring your own ip', 'byoip',
  // Realtime / WebRTC
  'realtime',
  // Marketing / docs / support sites
  'marketing site', 'support site', 'community site', 'developer\'s site',
];

// Non-North-American cities that appear in CF incident titles. If any of
// these match AND no impacting keyword matched, classify as not-impacting.
// (We don't enumerate every CF POP — just enough to filter the common
// non-NA incidents that show up in practice.)
const CF_NON_NA_CITIES = [
  'mumbai', 'bombay', 'bangalore', 'chennai', 'delhi', 'kolkata', 'hyderabad',
  'singapore', 'jakarta', 'manila', 'bangkok', 'hanoi', 'ho chi minh',
  'hong kong', 'taipei', 'seoul', 'tokyo', 'osaka',
  'sydney', 'melbourne', 'brisbane', 'perth', 'auckland',
  'london', 'paris', 'frankfurt', 'amsterdam', 'madrid', 'milan', 'rome',
  'berlin', 'vienna', 'warsaw', 'prague', 'stockholm', 'oslo', 'helsinki',
  'lisbon', 'dublin', 'zurich', 'brussels', 'copenhagen',
  'istanbul', 'moscow', 'kyiv',
  'são paulo', 'sao paulo', 'rio de janeiro', 'buenos aires', 'santiago',
  'bogot', 'lima', 'caracas',
  'cape town', 'johannesburg', 'lagos', 'nairobi', 'cairo',
  'dubai', 'doha', 'riyadh', 'tel aviv',
  'montréal', 'montreal', 'toronto', 'vancouver',
  // (Canadian cities are technically NA but if a CF incident is specifically
  // confined to Canada, it's unlikely to affect Aurora-routed traffic.)
];

// Statuspage incident.status values that mean "still happening". 'resolved'
// and 'postmortem' are over and must never drive a tile colour.
const CF_UNRESOLVED_INCIDENT_STATUSES = [
  'investigating', 'identified', 'monitoring',
];

// Classify a Cloudflare incident name. Returns one of:
//   'rj-impacting' | 'rj-not-impacting' | 'ambiguous'
function classifyCloudflareIncident(incidentName) {
  if (!incidentName) return 'ambiguous';
  const name = incidentName.toLowerCase();

  // Impacting keywords win — if any match, classify as impacting.
  for (const kw of CF_IMPACTING_KEYWORDS) {
    if (name.includes(kw)) return 'rj-impacting';
  }

  // No impacting match. Check for explicit non-impacting keywords.
  for (const kw of CF_NOT_IMPACTING_KEYWORDS) {
    if (name.includes(kw)) return 'rj-not-impacting';
  }

  // Check for non-NA city mentions (also non-impacting).
  for (const city of CF_NON_NA_CITIES) {
    if (name.includes(city)) return 'rj-not-impacting';
  }

  // Nothing matched — be conservative.
  return 'ambiguous';
}

// Map a Statuspage incident's own `impact` to our severity vocabulary.
// Note this reads the INCIDENT's impact, not the page-wide indicator.
function cloudflareIncidentSeverity(impact) {
  switch (impact) {
    case 'critical': return 'major';
    case 'major':    return 'partial';
    case 'minor':    return 'degraded';
    case 'none':     return 'degraded';
    default:         return 'degraded';
  }
}

const CF_SEVERITY_RANK = { operational: 0, degraded: 1, partial: 2, major: 3 };

// Decide what RJ should be told about Cloudflare.
//
//   statusData    — parsed /api/v2/status.json          (may be null)
//   incidentsData — parsed /api/v2/incidents/unresolved.json
//   opts.incidentsUnavailable — true when we could not read the incident list
//
// Returns { severity, statusText, incident, impacting, filtered }.
// `incident` is shaped for the dashboard tile: { name, status, updatedAt }.
function evaluateCloudflare(statusData, incidentsData, opts) {
  const options = opts || {};
  const description = (statusData && statusData.status && statusData.status.description) || null;
  const indicator = (statusData && statusData.status && statusData.status.indicator) || null;

  // We cannot apply the rule without the incident list. Falling back to the
  // indicator is exactly the behaviour this module exists to remove, so say so
  // out loud rather than quietly reporting a colour we don't believe.
  if (options.incidentsUnavailable) {
    return {
      severity: indicator && indicator !== 'none' ? 'degraded' : 'operational',
      statusText: 'Could not read Cloudflare\'s incident list — showing their page-wide status',
      incident: description
        ? { name: 'Cloudflare reports: ' + description, status: 'unverified', updatedAt: null }
        : null,
      impacting: [],
      filtered: [],
    };
  }

  const all = (incidentsData && Array.isArray(incidentsData.incidents))
    ? incidentsData.incidents
    : [];

  // Defensive: /incidents/unresolved.json should only ever contain unresolved
  // incidents, but summary.json does not make that promise, and this function
  // accepts either shape.
  const unresolved = all.filter((inc) =>
    inc && CF_UNRESOLVED_INCIDENT_STATUSES.includes(inc.status));

  const impacting = [];
  const filtered = [];
  for (const inc of unresolved) {
    const classification = classifyCloudflareIncident(inc.name);
    if (classification === 'rj-not-impacting') filtered.push(inc);
    else impacting.push({ incident: inc, classification });
  }

  // ---- Nothing on our traffic path ----
  if (impacting.length === 0) {
    let statusText;
    let incident = null;

    if (filtered.length > 0) {
      // Name what Cloudflare reports, so the tile is informative rather than
      // just green. This is the ordinary resting state.
      const names = filtered.map((i) => i.name);
      statusText = 'Working for us — Cloudflare issue not on our traffic path';
      incident = {
        name: 'Cloudflare reports: ' + names.join('; '),
        status: 'not affecting RJ tools',
        updatedAt: filtered[0].updated_at || filtered[0].created_at || null,
      };
    } else if (indicator && indicator !== 'none') {
      // No incidents at all, but the page-wide indicator is non-green — this
      // is component/POP noise or scheduled maintenance. Deliberately ignored.
      statusText = 'Working for us — no open Cloudflare incidents';
      incident = description
        ? {
            name: 'Cloudflare\'s page-wide status reads "' + description +
                  '" (regional POPs and maintenance, no open incident)',
            status: 'not affecting RJ tools',
            updatedAt: null,
          }
        : null;
    } else {
      statusText = description || 'All Systems Operational';
    }

    return { severity: 'operational', statusText, incident, impacting: [], filtered };
  }

  // ---- At least one incident on our traffic path ----
  let worst = impacting[0];
  let worstSeverity = cloudflareIncidentSeverity(worst.incident.impact);
  for (const candidate of impacting) {
    const sev = cloudflareIncidentSeverity(candidate.incident.impact);
    if (CF_SEVERITY_RANK[sev] > CF_SEVERITY_RANK[worstSeverity]) {
      worst = candidate;
      worstSeverity = sev;
    }
  }

  const extra = impacting.length > 1
    ? ' (+' + (impacting.length - 1) + ' more)'
    : '';
  const qualifier = worst.classification === 'ambiguous'
    ? ' — unclear whether RJ is affected'
    : '';

  return {
    severity: worstSeverity,
    statusText: (description || 'Cloudflare reporting an incident') + qualifier,
    incident: {
      name: worst.incident.name + extra,
      status: worst.incident.status || 'investigating',
      updatedAt: worst.incident.updated_at || worst.incident.created_at || null,
    },
    impacting,
    filtered,
  };
}
// ----8<---- END SHARED CLOUDFLARE FILTER ----8<----

module.exports = {
  CF_IMPACTING_KEYWORDS,
  CF_NOT_IMPACTING_KEYWORDS,
  CF_NON_NA_CITIES,
  CF_UNRESOLVED_INCIDENT_STATUSES,
  classifyCloudflareIncident,
  cloudflareIncidentSeverity,
  evaluateCloudflare,
};
