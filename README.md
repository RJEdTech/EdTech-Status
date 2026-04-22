# EdTech Status Dashboard

A live status dashboard for the EdTech tools in our portfolio at Regis Jesuit High School — one page that aggregates vendor status pages so teachers and IT can see at a glance whether something is down before troubleshooting.

**[Launch EdTech Status Dashboard →](https://rjedtech.github.io/EdTech-Status/)**

## What it does

The dashboard pulls live status from each vendor's official status page and renders a tile per tool. Tiles are organized into tiers by school-day impact (described below). Tiles with active incidents float to the top within each tier so problems are visible immediately. A summary banner at the top shows the worst severity across all monitored tools, weighted by tier so a Canvas outage rings louder than a Gimkit outage even at the same severity.

It auto-refreshes every five minutes when the tab is visible and pauses when the tab is hidden, so it stays current without hammering vendor APIs. A manual refresh button is also available.

## Tier system

Tools are grouped into four tiers (critical, core, secondary, and supporting infrastructure). The tier drives both the visual size of the tile and how the summary banner weights the tool when something goes wrong.

**Critical (4) — school-day-blocking.** If any of these are down, teaching or operations stop or get severely impaired. Microsoft sign-in (Entra ID) is in this tier because every other Microsoft service plus Canvas, Blackbaud, OneDrive, Teams, and Outlook all depend on it for SSO authentication — if Entra goes down, the cascade hits everything.

- Microsoft sign-in (Entra)
- OneDrive / SharePoint
- Exchange / Outlook
- Canvas

**Core (4) — significant impact when down but not blocking.**

- Microsoft Teams
- Blackbaud (SIS, LMS, EMS, financials, ID)
- Vivi
- Flint

**Secondary (11) — Canvas integrations and side tools.** Affect individual classes at most.

- Respondus (LockDown Browser & Monitor)
- Copyleaks
- AspirEDU (Grade Guardian, Dropout Detective)
- ExploreLearning (Gizmos, Reflex, Frax)
- IXL
- Kahoot
- Quizizz / Wayground
- Gimkit
- Soundtrap
- NoRedInk
- DeltaMath

## How the summary banner weights tiers

The banner at the top is the first thing the eye lands on. The wording and color escalate based on which tier is affected:

- **Critical issue** → banner names the actual affected service ("Microsoft sign-in down", "Canvas reporting issues"). Tail clauses note any core or secondary tools also affected.
- **Core issue (critical clean)** → banner names the affected core service and adds "critical services operational" so the reader knows it's not a school-stopper.
- **Secondary-only issue** → banner says "N secondary tool(s) reporting issues · critical and core services operational." Reassurance that the foundational layer is fine.
- **Scraper broken only** → slate banner ("status check broken — verify those tools manually") because it's a meta-problem with the dashboard, not a vendor outage.
- **All clear** → green.

The counts line below the banner gives a tier-by-tier breakdown: `Critical: 4/4 ok · Core: 3/4 ok (1 issue) · Secondary: 11/11 ok · Infra: 2/2 ok`.

## How to read the dashboard

- **Green dot** — operational
- **Yellow dot** — degraded performance or maintenance
- **Orange dot** — partial outage
- **Red dot** — major outage
- **Slate dot with wrench glyph** — *status check broken*. The dashboard tried to read this vendor's status and either couldn't reach the source or didn't recognize the response. The vendor itself may be fine; you just have to verify manually by clicking through.
- **Gray dot** — status couldn't be reached (cached value shown if available)

When a vendor reports an incident, the tile expands to show the incident name, current state, and how recently it was updated.

When a status check is broken, the tile shows the last-known reading (and how stale it is) plus the underlying error so you can judge whether to trust the prior reading.

## Outage vs. breakage — why the distinction matters

A red tile means the *vendor* says something is wrong. A slate tile means the *dashboard* can't read the source — the vendor itself might be perfectly fine, or might be on fire, we genuinely don't know.

These two failure modes look superficially similar but require different responses:

- **Outage:** trust the dashboard, communicate the issue, escalate per normal incident handling.
- **Breakage:** don't trust the dashboard for that vendor, click through to verify status manually, and the scraper likely needs a fix (vendor probably changed their page structure).

The summary banner counts these separately. A line like *"2 tools reporting issues · 1 status check broken"* means two real outages and one tile you can't trust right now.

## Important caveats

**Status pages lag real outages.** Vendors only report what they choose to report, and they don't always do it quickly. A tile can read green while teachers are actively experiencing problems. Treat this dashboard as a first signal, not a definitive answer — if teachers report an issue and the tile is green, the problem is real.

**M365 keyword matching is best-effort.** The Microsoft 365 RSS feed publishes incidents with service names embedded in titles and descriptions. The scraper filters by keyword (`['entra', 'sign-in', 'authentication', ...]` for the sign-in tile, etc.) to route each incident to the right tile. The current keyword lists are educated guesses based on Microsoft's published service naming — we have not yet observed an actual M365 outage in the feed since the split was built. The first real outage may surface a service-naming pattern we haven't accounted for. The scraper writes a `rawItems` debug array (up to 10 most recent items, full text) in `m365.json` so the keywords can be quickly fixed when needed.

**Cached fallback.** If a vendor's API is unreachable for any reason (CORS, vendor outage, network), the tile shows the most recent cached value with a "(cached)" label rather than going blank.

## Architecture

Single-file vanilla HTML/JS, no build step, no framework dependencies. Hosted on GitHub Pages.

The dashboard makes external API calls to vendor status endpoints — this is a deliberate exception to the standard RJEdTech "no external calls" rule, because the entire purpose of the tool is aggregating those calls. No user data is collected, no analytics are sent, and the only thing stored locally is a cache of the most recent status response per vendor (used as a fallback when an API call fails).

### Microsoft 365 — four tiles, one snapshot

The four M365 tiles (Entra, SharePoint, Exchange, Teams) all read from the same `m365.json` file written by `.github/workflows/fetch-m365.yml`. The dashboard caches the parsed JSON for the duration of a single refresh cycle so the file is fetched once per cycle, not four times. The cache clears at the start of each refresh.

The workflow filters the M365 RSS feed by keyword:

| Tile | Keywords matched in item title/description |
|---|---|
| Sign-in (Entra) | entra, sign-in, sign in, authentication, identity, azure ad, azuread, aad |
| OneDrive / SharePoint | sharepoint, onedrive, spo, sp online, odb, odsp |
| Exchange / Outlook | exchange, outlook, exo, eop, mail flow |
| Teams | microsoft teams, teams, teams admin, teams chat |

If a single incident matches multiple services (e.g., an outage affecting both Exchange and Teams), all matched tiles light up. If the workflow can't find any keywords for an item (e.g., a Power BI advisory), no tile lights up — that's intentional, since unmonitored services shouldn't trigger alerts on a teaching-day dashboard.

The workflow's status mapping (`mapStatusToSeverity` in the YAML) is similarly best-effort:
- `Available` / `Restored` → operational
- contains `interruption`, `outage`, `unavailable` → major
- contains `degradation`, `degraded`, `investigating`, `extended` → partial
- contains `advisory`, `information` → degraded
- anything else non-Available → partial (conservative default)

Adjust the keyword lists or status mapping in the YAML when the first real outage surfaces patterns we missed.

### GitHub Actions workflows (CORS workarounds and scraping)

Seven vendors don't expose a browser-fetchable JSON endpoint, so a GitHub Actions workflow scrapes each one every 5 minutes, parses the result server-side, and commits the snapshot back to the repo. The dashboard then reads that JSON file from same-origin — no CORS issue.

- **Microsoft 365** (`.github/workflows/fetch-m365.yml` → `m365.json`) — see "Microsoft 365" section above for service-filtering details.
- **ExploreLearning** (`.github/workflows/fetch-explorelearning.yml` → `explorelearning.json`) — no machine-readable feed exists. The workflow scrapes the public site-status page and looks for two specific markers (`id="site-status-a-ok"` and the green "A-OK!" heading). When both are present, status is operational; anything else surfaces as "check page" and the user clicks through.
- **IXL** (`.github/workflows/fetch-ixl.yml` → `ixl.json`) — `status.ixl.com` is hosted on Uptime.com, which has no public unauthenticated JSON endpoint. The workflow fetches the page and pulls four flags out of the inline JS blob: `global_is_operational`, `has_components_under_maintenance_state`, `has_components_under_critical_state`, and the `active_incidents` array. The workflow does the severity mapping itself and writes the result.
- **Quizizz / Wayground** (`.github/workflows/fetch-quizizz.yml` → `quizizz.json`) — Quizizz's status page is hosted on Freshping (a Freshworks product) which has no public unauthenticated JSON. The workflow scrapes the rendered banner and maps to one of `operational`, `partial`, `major`, or `maintenance`. Note: Quizizz has been rebranded to "Wayground" but everyone still calls it Quizizz, so the tile keeps the Quizizz label.
- **Gimkit** (`.github/workflows/fetch-gimkit.yml` → `gimkit.json`) — Gimkit's status page is hosted on Crisp Status. Crisp's REST API is for managing pages from the operator side, not for reading public status. The workflow scrapes the rendered banner and maps Crisp's healthy/sick/dead replica states to one of `operational`, `degraded`, `partial`, or `major`.
- **Soundtrap** (`.github/workflows/fetch-soundtrap.yml` → `soundtrap.json`) — the most minimal status page in the portfolio. A single sentence ("Soundtrap is working fine.") on an otherwise bare HTML page, no API, no structured data. The scraper detects presence/absence of that exact string. Because only one bit of state is exposed, the tile shows operational or "see vendor page" — no degraded/partial nuance is possible.
- **NoRedInk** (`.github/workflows/fetch-noredink.yml` → `noredink.json`) — `noredinkstatus.com` is hosted on Status.io, which has no public unauthenticated JSON endpoint. The workflow scrapes the rendered banner from the `id="statusbar_text"` element and maps to one of `operational`, `degraded`, `partial`, `major`, or `maintenance`. Replaces the previous StatusGator link-only tile.

All seven workflows only commit when the status content actually changes — not on every timestamp tick — so the repo doesn't fill up with noise commits. If a vendor changes their page structure and the scraper can't find what it expects, the workflow exits with a non-zero status (loud failure beats silent wrong data).

**DeltaMath** does *not* need a workflow even though it was previously a StatusGator link-only tile. DeltaMath runs its own first-party Atlassian Statuspage at `status.deltamath.com`, which exposes the standard public CORS-enabled `/api/v2/status.json` endpoint — same code path as Canvas, AspirEDU, Kahoot, Respondus, and Cloudflare. The earlier assumption that DeltaMath was only reachable via StatusGator turned out to be wrong; their own status page just isn't widely linked.

## Privacy

- **No user data is collected, stored, or transmitted.**
- The only outbound requests are to public vendor status endpoints.
- The only locally stored data is a status cache in browser `localStorage`, used as a fallback when vendor APIs are unreachable. Clearing browser data removes it.
- No tracking, no analytics, no cookies.

## Built by

Jason Beyer · Director of Educational Technology · Regis Jesuit High School
