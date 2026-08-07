# EdTech Status Dashboard

A live status dashboard for the EdTech tools in our portfolio at Regis Jesuit High School — one page that aggregates vendor status pages so teachers, IT, and operations staff can see at a glance whether something is down before troubleshooting.

**[Launch EdTech Status Dashboard →](https://rjedtech.github.io/EdTech-Status/)**

## What it does

The dashboard pulls live status from each vendor's official status page and renders a tile per tool — 24 tiles at present. Tiles are grouped into sections by what you're trying to do (sign in and teach, Canvas integrations, safety, operations, behind the scenes) and carry a tier that reflects school-day impact. Tiles with active incidents float to the top within each section so problems are visible immediately.

A summary banner at the top shows the worst severity across all monitored tools, weighted by tier so a Canvas outage rings louder than a Gimkit outage at the same severity.

It auto-refreshes every five minutes when the tab is visible, pauses when the tab is hidden, and resumes with an immediate refresh when you come back — so it stays current without hammering vendor APIs. A manual refresh button is also available.

## Audience filter

Three buttons above the first section switch the view: **All**, **Teaching**, and **Operations**. Each tile declares which audiences it belongs to, and the section structure changes with the filter — a teacher sees "Sign in & teach today" and "Canvas integrations" first, while operations staff see "Safety & communication," "Daily systems," "Public-facing," and "Athletics." Tiles outside the selected audience are hidden, and any section left empty collapses so you never see a stranded header.

## Tier system

Tools are grouped into four tiers. The tier drives how the summary banner weights the tool when something goes wrong.

**Critical (3) — school-day-blocking.** If these are down, teaching or operations stop or are severely impaired.

- Microsoft 365 (sign-in/Entra, OneDrive/SharePoint, Outlook, Teams)
- Canvas
- Blackbaud (SIS, Academic Module / GS LMS, enrollment, billing, financials, Blackbaud ID)

Microsoft 365 is critical because Entra sign-in is the foundation everything else rides on — if it goes down, the cascade hits Canvas SSO, email, files, and Teams together. Blackbaud is critical because the Academic Module is the LMS for the Grade School; an outage during the school day stops Grade School teaching the same way a Canvas outage stops High School teaching.

**Core (6) — significant impact when down, but a workaround exists.**

- Vivi (wireless display)
- Flint (AI platform)
- LockDown Browser (Respondus)
- Ruvna (emergency notifications and attendance)
- MyRJ (Blackbaud faculty login for our tenant)
- RJ Website (regisjesuit.com)

**Secondary (13) — Canvas integrations, side tools, and department-specific systems.** Affect individual classes or a single department at most.

- Copyleaks
- Grade Guardian (AspirEDU)
- DeltaMath
- Gizmos (ExploreLearning — also covers Reflex, Frax, Science4Us)
- Gimkit
- Soundtrap
- NoRedInk
- Finalsite (public website CMS)
- Hudl
- ArbiterSports
- MaxPreps
- Neptune GameTime
- ATGenius

**Infrastructure (2) — platforms our tools run on.**

- AWS
- Cloudflare

Infrastructure tiles are context, not primary signal. They exist to explain outages higher up the stack. A red infra tile does **not** escalate the banner on its own — see "Infrastructure correlation" below.

### Two pairs of tiles that look redundant but aren't

**Blackbaud vs. MyRJ.** The Blackbaud tile reports Blackbaud-the-platform globally. The MyRJ tile runs a synthetic check against *our* tenant's faculty login flow, including the Blackbaud ID → Entra federation handoff. Those two can diverge: our tenant can be broken while Blackbaud's global page is green, and vice versa.

**Finalsite vs. RJ Website.** The Finalsite tile reports Finalsite-the-platform globally. The RJ Website tile checks whether `regisjesuit.com` actually loads. The URL stays the same as the CMS migrates between vendors (Finalsite today, Ubiq eventually), so that tile follows our site regardless of who's hosting it.

## How the summary banner weights tiers

The banner is the first thing the eye lands on. Wording and color escalate based on which tier is affected:

- **Critical issue** → banner names the actual affected service ("Canvas reporting issues"). Tail clauses note any core or secondary tools also affected.
- **Core issue (critical clean)** → banner names the affected core service and adds "critical services operational" so the reader knows it's not a school-stopper.
- **Secondary-only issue** → "N secondary tool(s) reporting issues · critical and core services operational." Reassurance that the foundational layer is fine.
- **Scraper broken only** → slate banner ("status check broken — verify those tools manually"), because that's a problem with the dashboard, not a vendor outage.
- **All clear** → green.

A counts line below the banner gives a tier-by-tier breakdown: `Critical: 3/3 ok · Core: 6/6 ok · Secondary: 12/13 ok (1 issue) · Infra: 2/2 ok`.

### Infrastructure correlation

When a service tile is red **and** one of its known infrastructure dependencies is also red, the banner adds a "possible upstream cause" note so the reader knows the root problem may not be the service itself. The dependency map is deliberately curated rather than exhaustive — only dependencies we can back up publicly:

| Service | Depends on |
|---|---|
| Canvas | AWS, Cloudflare |
| NoRedInk | AWS, Cloudflare |
| Blackbaud | AWS |

NoRedInk's own status page lists AWS and Cloudflare as external services. Canvas has historically run on AWS with Cloudflare fronting much of its traffic. Blackbaud's K-12 hosting whitepaper confirms the K-12 line runs on AWS us-east-1 with Route 53 for DNS; no Cloudflare is documented in that path. A missing entry is safer than a wrong one — a dashboard that claims dependencies it can't back up loses trust fast.

## How to read the dashboard

- **Green dot** — operational
- **Yellow dot** — degraded performance or maintenance
- **Orange dot** — partial outage
- **Red dot** — major outage
- **Slate dot with wrench glyph** — *status check broken*. The dashboard tried to read this vendor's status and either couldn't reach the source or didn't recognize the response. The vendor itself may be fine; verify manually by clicking through.
- **Gray dot** — status couldn't be reached (cached value shown if available)

When a vendor reports an incident, the tile expands to show the incident name, current state, and how recently it was updated. When a status check is broken, the tile shows the last-known reading (and how stale it is) plus the underlying error, so you can judge whether to trust the prior reading.

## Outage vs. breakage — why the distinction matters

A red tile means the *vendor* says something is wrong. A slate tile means the *dashboard* can't read the source — the vendor might be perfectly fine, or might be on fire; we genuinely don't know.

These two failure modes look superficially similar but require different responses:

- **Outage:** trust the dashboard, communicate the issue, escalate per normal incident handling.
- **Breakage:** don't trust the dashboard for that vendor, click through to verify manually, and the scraper likely needs a fix (the vendor probably changed their page structure).

The summary banner counts these separately. A line like *"2 tools reporting issues · 1 status check broken"* means two real outages and one tile you can't trust right now.

## Important caveats

**Status pages lag real outages.** Vendors only report what they choose to report, and not always quickly. A tile can read green while teachers are actively experiencing problems. Treat this dashboard as a first signal, not a definitive answer — if teachers report an issue and the tile is green, the problem is real.

**Microsoft 365 is a link-only tile.** There is no automated M365 signal on this dashboard. The tile links to Microsoft's public status page and is checked manually. Because M365 sits in the critical tier, verify it directly when sign-in, mail, files, or Teams are the reported symptom.

**Synthetic probes measure reachability, not correctness.** MyRJ, RJ Website, ArbiterSports, MaxPreps, Neptune, and ATGenius have no usable public status page, so we run server-side HTTP checks instead. A green tile means the endpoint responded as expected — it does not prove the application behind it is working correctly. Neptune in particular checks the vendor's web and licensing side; the game-day media player runs locally in the gym and is outside what we can see.

**Cached fallback.** If a vendor's API is unreachable for any reason (CORS, vendor outage, network), the tile shows the most recent cached value with a "(cached)" label rather than going blank.

## Architecture

Single-file vanilla HTML/JS, no build step, no framework dependencies. Hosted on GitHub Pages.

The dashboard makes external API calls to vendor status endpoints — a deliberate exception to the standard RJEdTech "no external calls" rule, because aggregating those calls is the entire purpose of the tool. No user data is collected, no analytics are sent, and the only thing stored locally is a cache of the most recent status response per vendor (`edtech-status-cache-v1` in `localStorage`), used as a fallback when an API call fails.

### Three kinds of tile

1. **Direct browser fetch** — vendors running Atlassian Statuspage or Instatus expose public CORS-enabled JSON, so the page fetches them straight from the browser. No workflow needed.
2. **Snapshot file** — vendors with no browser-fetchable endpoint are scraped or probed server-side by a GitHub Actions workflow, which commits a JSON snapshot back to the repo.
3. **Link-only** — Microsoft 365, checked manually.

### Where snapshot data is read from

Snapshot JSON is **not** read same-origin. `resolveDataUrl()` rewrites any relative path to `https://raw.githubusercontent.com/RJEdTech/EdTech-Status/main/`, which reflects the latest commit and is CDN-cached for roughly five minutes — matching our refresh cadence. Absolute vendor URLs pass through unchanged.

This exists so that scraper commits don't trigger a Pages rebuild. `deploy-pages.yml` is path-filtered to the files that actually make up the site, so the dozens of snapshot commits per hour never redeploy anything. If snapshot data were read same-origin, every scraper commit would need a rebuild to become visible.

### Cloudflare — incident filtering

RJ doesn't use Cloudflare directly. We feel Cloudflare outages only when they hit products that vendor sites we *do* use depend on. Cloudflare's status page reports issues across hundreds of products and regions globally, and most are noise from our perspective.

The Cloudflare tile uses a custom handler that calls the standard Statuspage code path and then classifies the active incident name into one of three buckets:

| Bucket | Behavior | Examples |
|---|---|---|
| RJ-impacting | Tile renders Cloudflare's reported severity as-is | CDN, cache, DNS, SSL/certificates, WAF and firewall rules, challenge platform, load balancing, Spectrum, WebSockets, DDoS, and North American regions or POPs in a plausible Aurora routing path (DEN, DFW, SLC, ORD, IAD, and others) |
| Not RJ-impacting | Tile keeps the reported severity but rewrites the status text to clarify RJ services aren't affected | Access, WARP, Zero Trust, Tunnel, Workers and the developer platform, R2, KV, Queues, Pages, Stream, Images, Turnstile, email routing and security, registrar and billing, dashboard, analytics, Magic Transit, and non-North-American POPs |
| Ambiguous | Treated as RJ-impacting (conservative default) | Anything that doesn't match either list |

Tuning principle: false positives (flagging unnecessarily) are cheaper than false negatives (missing a real outage). When in doubt, the filter classifies as impacting.

Two known gaps are documented in the code and worth revisiting if we ever observe them in practice. Vivi runs on AWS, but we haven't confirmed whether Cloudflare also fronts it — if a real-world correlation shows up (Cloudflare yellow and Vivi degraded simultaneously), Vivi should be added to the dependency map. And Cloudflare Turnstile is currently classified as not-impacting because no RJ vendor is known to use it on a login screen; that assumption needs to change the moment one does.

### GitHub Actions workflows

Nine workflows run every five minutes, parse results server-side, and commit a snapshot back to the repo.

| Workflow | Writes | Why it exists |
|---|---|---|
| `fetch-explorelearning.yml` | `explorelearning.json` | No machine-readable feed. Scrapes the public site-status page and scopes the result to the products RJ actually licenses, so a Reflex or Frax incident doesn't turn the Gizmos tile red. |
| `fetch-gimkit.yml` | `gimkit.json` | Status page is on Crisp Status, whose REST API is for operators, not public reads. Scrapes the rendered banner and maps Crisp's healthy/sick/dead replica states to our severities. |
| `fetch-soundtrap.yml` | `soundtrap.json` | The most minimal status page in the portfolio — a single sentence on a bare HTML page. Only one bit of state is exposed, so the tile can show operational or "see vendor page," with no degraded/partial nuance. |
| `fetch-noredink.yml` | `noredink.json` | Hosted on Status.io, no public unauthenticated JSON. Scrapes the banner from `id="statusbar_text"`. |
| `fetch-aws.yml` | `aws.json` | Reads AWS's combined RSS feed, filters to unresolved incidents in the last four hours, and aggregates worst-case severity. Deliberately not filtered by service — AWS has hundreds of service/region combinations, and a false positive is cheap for a context tile. |
| `fetch-myrj.yml` | `myrj.json` | Synthetic check on the faculty login redirect chain, stopping at Blackbaud ID. We stop there on purpose — following the further redirect to Microsoft sign-in would double-count M365 outages. |
| `fetch-rj-website.yml` | `rj-website.json` | Synthetic check on `regisjesuit.com`. |
| `fetch-arbitersports.yml` | `arbitersports.json` | No usable status page (Pingdom blocks unauthenticated access; Downdetector blocks runner IPs). Runs an auth-aware synthetic probe against the login flow and the application independently, since they can fail separately. The tile rolls up to worst-of and breaks the two out on expand. |
| `fetch-athletics-probes.yml` | `maxpreps.json`, `neptune.json`, `atgenius.json` | Three small athletics vendors with no status pages, probed by one workflow. |

Snapshot workflows commit only when the status content actually changes — not on every timestamp tick — so the repo doesn't fill with noise commits.

**Design note:** synthetic reachability probes are preferred over HTML-parsing scrapers wherever a vendor gives us the choice. Parsing a rendered banner breaks silently every time a vendor redesigns; an HTTP response classifier doesn't. Every workflow that pushes also retries with a fetch-and-reapply loop, because nine scrapers on five-minute crons collide with each other regularly.

### Alerting

`alert-changes.yml` runs every ten minutes and posts to a Teams channel when a vendor's status actually changes. It monitors the 23 tiles that have a machine-readable signal (all but the link-only Microsoft 365 tile), diffs against `state/last-status.json`, and posts a single consolidated card rather than one message per vendor.

- The first run after any deployment writes the baseline and sends nothing — there's no prior state to compare against. A newly added vendor is likewise skipped on its first run.
- Transient `unknown` readings never alert. A vendor has to resolve to a real severity to count as a change.
- Infrastructure changes are suppressed unless one of that provider's dependents is also red, mirroring the correlation logic in the dashboard. Cloudflare going yellow on its own is not worth a notification.
- The vendor list, severity mappings, and dependency map mirror `index.html`. When you change one, change both.

## Privacy

- **No user data is collected, stored, or transmitted.**
- The only outbound requests are to public vendor status endpoints and this repo's own data files.
- The only locally stored data is a status cache in browser `localStorage`, used as a fallback when vendor APIs are unreachable. Clearing browser data removes it.
- No tracking, no analytics, no cookies.

## Built by

Jason Beyer · Director of Educational Technology · Regis Jesuit High School
