# EdTech Status Dashboard

A live status dashboard for the EdTech tools in our portfolio at Regis Jesuit High School — one page that aggregates vendor status pages so teachers and IT can see at a glance whether something is down before troubleshooting.

**[Launch EdTech Status Dashboard →](https://rjedtech.github.io/EdTech-Status/)**

## What it does

The dashboard pulls live status from each vendor's official status page and renders a tile per tool. Tiles with active incidents float to the top so problems are visible immediately. A summary banner at the top shows the worst severity across all monitored tools.

It auto-refreshes every five minutes when the tab is visible and pauses when the tab is hidden, so it stays current without hammering vendor APIs. A manual refresh button is also available.

## Tools monitored

**Live status (real-time data):**

- **Canvas** (Instructure) — global status plus a link to RJ's instance-specific uptime
- **Flint** — flintk12.com app and supporting services
- **Respondus** — LockDown Browser and Monitor
- **Vivi** — wireless display and screen mirroring
- **Kahoot** — game-based learning platform
- **Blackbaud** — SIS, LMS, EMS, financials, and Blackbaud ID (rolls up across all components)
- **Copyleaks** — AI detection and plagiarism
- **Microsoft 365** — Admin Center status (scraped via GitHub Actions, see Architecture below)
- **ExploreLearning** (Gizmos, Reflex, Frax) — static status page scraped via GitHub Actions
- **IXL** — `status.ixl.com` scraped via GitHub Actions
- **Quizizz / Wayground** — Freshping-hosted page scraped via GitHub Actions
- **Gimkit** — Crisp Status page scraped via GitHub Actions
- **Soundtrap** — bare HTML status page scraped via GitHub Actions
- **AspirEDU** (Grade Guardian, Dropout Detective, Instructor Insight) — Atlassian Statuspage

**Status pages without live data (link only):**

- **NoRedInk**, **DeltaMath** — only available through StatusGator, which requires an account for API access

## How to read the dashboard

- **Green dot** — operational
- **Yellow dot** — degraded performance or maintenance
- **Orange dot** — partial outage
- **Red dot** — major outage
- **Slate dot with wrench glyph** — *status check broken*. The dashboard tried to read this vendor's status and either couldn't reach the source or didn't recognize the response. The vendor itself may be fine; you just have to verify manually by clicking through.
- **Gray dot** — status couldn't be reached (cached value shown if available)
- **Hollow circle** — link-only tile, manual check required

When a vendor reports an incident, the tile expands to show the incident name, current state (investigating, identified, monitoring, resolved), and how recently it was updated.

When a status check is broken, the tile shows the last-known reading (and how stale it is) plus the underlying error so you can judge whether to trust the prior reading.

## Outage vs. breakage — why the distinction matters

A red tile means the *vendor* says something is wrong. A slate tile means the *dashboard* can't read the source — the vendor itself might be perfectly fine, or might be on fire, we genuinely don't know.

These two failure modes look superficially similar but require different responses:

- **Outage:** trust the dashboard, communicate the issue, escalate per normal incident handling.
- **Breakage:** don't trust the dashboard for that vendor, click through to verify status manually, and Jason needs to fix the scraper (likely the vendor changed their page structure).

The summary banner at the top counts these separately. A line like *"2 tools reporting issues · 1 status check broken"* means two real outages and one tile you can't trust right now.

## Important caveats

**Status pages lag real outages.** Vendors only report what they choose to report, and they don't always do it quickly. A tile can read green while teachers are actively experiencing problems. Treat this dashboard as a first signal, not a definitive answer — if teachers report an issue and the tile is green, the problem is real.

**Cached fallback.** If a vendor's API is unreachable for any reason (CORS, vendor outage, network), the tile shows the most recent cached value with a "(cached)" label rather than going blank.

## Architecture

Single-file vanilla HTML/JS, no build step, no framework dependencies. Hosted on GitHub Pages.

The dashboard makes external API calls to vendor status endpoints — this is a deliberate exception to the standard RJEdTech "no external calls" rule, because the entire purpose of the tool is aggregating those calls. No user data is collected, no analytics are sent, and the only thing stored locally is a cache of the most recent status response per vendor (used as a fallback when an API call fails).

### GitHub Actions workflows (CORS workarounds and scraping)

Six vendors don't expose a browser-fetchable JSON endpoint, so a GitHub Actions workflow scrapes each one every 5 minutes, parses the result server-side, and commits the snapshot back to the repo. The dashboard then reads that JSON file from same-origin — no CORS issue.

- **Microsoft 365** (`.github/workflows/fetch-m365.yml` → `m365.json`) — Microsoft's status RSS feed doesn't send the CORS header browsers require for cross-origin requests. The workflow fetches the feed, parses the first `<item>`, and writes the status field.
- **ExploreLearning** (`.github/workflows/fetch-explorelearning.yml` → `explorelearning.json`) — no machine-readable feed exists. The workflow scrapes the public site-status page and looks for two specific markers (`id="site-status-a-ok"` and the green "A-OK!" heading). When both are present, status is operational; anything else surfaces as "check page" and the user clicks through.
- **IXL** (`.github/workflows/fetch-ixl.yml` → `ixl.json`) — `status.ixl.com` is hosted on Uptime.com, which has no public unauthenticated JSON endpoint. The workflow fetches the page and pulls four flags out of the inline JS blob the React controller is initialized with: `global_is_operational`, `has_components_under_maintenance_state`, `has_components_under_critical_state`, and the `active_incidents` array. The workflow does the severity mapping itself and writes the result.
- **Quizizz / Wayground** (`.github/workflows/fetch-quizizz.yml` → `quizizz.json`) — Quizizz's status page is hosted on Freshping (a Freshworks product). Freshping has a v1 REST API but it requires authentication, and public status pages don't expose unauthenticated JSON. The workflow scrapes the rendered banner and maps to one of `operational`, `partial`, `major`, or `maintenance`. Note: Quizizz has been rebranded to "Wayground" but everyone still calls it Quizizz, so the tile keeps the Quizizz label.
- **Gimkit** (`.github/workflows/fetch-gimkit.yml` → `gimkit.json`) — Gimkit's status page is hosted on Crisp Status (a SaaS version of the open-source Vigil tool). Crisp's REST API is for managing pages from the operator side, not for reading public status. The workflow scrapes the rendered banner and maps Crisp's healthy/sick/dead replica states to one of `operational`, `degraded`, `partial`, or `major`.
- **Soundtrap** (`.github/workflows/fetch-soundtrap.yml` → `soundtrap.json`) — the most minimal status page in the portfolio. A single sentence ("Soundtrap is working fine.") on an otherwise bare HTML page, no API, no structured data. The scraper detects presence/absence of that exact string. Because only one bit of state is exposed, the tile shows operational or "see vendor page" — no degraded/partial nuance is possible.

All six workflows only commit when the status content actually changes — not on every timestamp tick — so the repo doesn't fill up with noise commits. If a vendor changes their page structure and the scraper can't find what it expects, the workflow exits with a non-zero status (loud failure beats silent wrong data).

## Privacy

- **No user data is collected, stored, or transmitted.**
- The only outbound requests are to public vendor status endpoints.
- The only locally stored data is a status cache in browser `localStorage`, used as a fallback when vendor APIs are unreachable. Clearing browser data removes it.
- No tracking, no analytics, no cookies.

## Built by

Jason Beyer · Director of Educational Technology · Regis Jesuit High School
