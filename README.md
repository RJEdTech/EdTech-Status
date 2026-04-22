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
- **Copyleaks** — AI detection and plagiarism
- **Microsoft 365** — Admin Center status

**Status pages without live data (link only):**

- **NoRedInk**, **DeltaMath**, **AspirEDU** (Grade Guardian) — only available through StatusGator, which requires an account for API access
- **IXL** — runs on Uptime.com without a public unauthenticated JSON endpoint
- **ExploreLearning** (Gizmos, Reflex, Frax) — static status page, no machine-readable feed

## How to read the dashboard

- **Green dot** — operational
- **Yellow dot** — degraded performance or maintenance
- **Orange dot** — partial outage
- **Red dot** — major outage
- **Gray dot** — status couldn't be reached (cached value shown if available)
- **Hollow circle** — link-only tile, manual check required

When a vendor reports an incident, the tile expands to show the incident name, current state (investigating, identified, monitoring, resolved), and how recently it was updated.

## Important caveats

**Status pages lag real outages.** Vendors only report what they choose to report, and they don't always do it quickly. A tile can read green while teachers are actively experiencing problems. Treat this dashboard as a first signal, not a definitive answer — if teachers report an issue and the tile is green, the problem is real.

**Cached fallback.** If a vendor's API is unreachable for any reason (CORS, vendor outage, network), the tile shows the most recent cached value with a "(cached)" label rather than going blank.

## Architecture

Single-file vanilla HTML/JS, no build step, no framework dependencies. Hosted on GitHub Pages.

The dashboard makes external API calls to vendor status endpoints — this is a deliberate exception to the standard RJEdTech "no external calls" rule, because the entire purpose of the tool is aggregating those calls. No user data is collected, no analytics are sent, and the only thing stored locally is a cache of the most recent status response per vendor (used as a fallback when an API call fails).

### Microsoft 365 (special case)

Microsoft's status RSS feed doesn't send the CORS header browsers require for cross-origin requests, so the dashboard can't fetch it directly from the client. To work around this, a GitHub Actions workflow (`.github/workflows/fetch-m365.yml`) runs every 5 minutes, fetches the feed server-side, parses it, and commits the result as `m365.json`. The dashboard then reads that JSON file from same-origin, no CORS issue.

The workflow only commits when the status content actually changes — not on every timestamp tick — so the repo doesn't fill up with noise commits.

## Privacy

- **No user data is collected, stored, or transmitted.**
- The only outbound requests are to public vendor status endpoints.
- The only locally stored data is a status cache in browser `localStorage`, used as a fallback when vendor APIs are unreachable. Clearing browser data removes it.
- No tracking, no analytics, no cookies.

## Built by

Jason Beyer · Director of Educational Technology · Regis Jesuit High School
