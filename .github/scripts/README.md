# Status collectors

The dashboard reads a JSON snapshot per vendor from the repo root. Those files
are written by the workflows in `.github/workflows/`. There are two families,
and the difference between them matters.

## Family A — parsers

`aws`, `explorelearning`, `gimkit`, `noredink`, `soundtrap`.

These fetch a document and read a status out of it. Their logic lives in
`vendors/<name>.js` — plain Node modules, so they can be read, linted and
tested. The workflow YAML does nothing but call:

```
node .github/scripts/fetch-snapshot.js <name>
```

All the shared machinery — fetching, retrying, deciding whether to write, the
grace period — is in `snapshot-lib.js`.

### Adding a vendor

1. Write `vendors/<name>.js`:

   ```js
   const { BreakageError } = require('../snapshot-lib');
   const PAGE_URL = 'https://example.com/status';

   module.exports = {
     label: 'Example',
     outPath: 'example.json',
     url: PAGE_URL,
     static: { source: PAGE_URL },      // written verbatim every time
     defaults: { severity: 'unknown' }, // content fields + no-prior-reading value
     fetch: { accept: 'text/html', allowedHost: 'example.com' },
     detect(html) {
       if (!/some marker only this page has/i.test(html)) {
         throw new BreakageError('Page not recognised — example.com may have redesigned.');
       }
       return { severity: /all systems go/i.test(html) ? 'operational' : 'partial' };
     },
   };
   ```

2. Copy any existing Family A workflow, change the name, the slug and the cron
   offset.

3. Add the tile to `index.html` (`VENDORS`) and to `alert-changes.yml`.

`detect()` returns an object whose keys match `defaults` exactly. The library
writes `fetchedAt, ...static, ...detect(), parseError, fetchTrouble,
lastSuccessfulParse` — so `defaults` key order determines field order in the
JSON, and `index.html` reads those fields by name.

## Family B — reachability probes

`arbitersports`, `athletics-probes`, `myrj`, `rj-website`.

These have no status page to read; an HTTP response *is* the reading. They
deliberately do **not** use `snapshot-lib`, because for them "unreachable" is a
legitimate result (severity `major`) rather than a broken collector. They keep
their probe logic inline and share only the commit action.

## The three rules the library exists to enforce

**1. Don't commit when nothing changed.** `lastSuccessfulParse` is set to `now`
on every successful run, so including it in the "did anything change?"
comparison means the comparison never matches and every run commits. Five
workflows did this; it produced roughly 288 commits a day each and turned every
push into a race. It is excluded from `contentEqual` on purpose. There is a
regression test for it.

**2. A bad minute is not a broken scraper.** A timeout or 5xx is retried three
times inside the run, then tolerated for three consecutive runs before the tile
is allowed to go grey. A page we cannot *recognise* is reported immediately,
because that never fixes itself. This is the `TransientError` /
`BreakageError` split — throw the right one.

**3. Say when a reading is old.** Because of rule 1, a healthy snapshot can sit
untouched for weeks and its `fetchedAt` goes stale; because of rule 2, a dead
collector stays quiet for a while. So every collector rewrites its timestamps
at least hourly (the heartbeat), and `index.html` flags any tile whose reading
is more than 90 minutes old. Do not remove the heartbeat to "save commits" —
it is what makes the staleness check trustworthy.

## Tests

```
node --test .github/scripts/test/
```

The interesting tests are sequences of runs, not single calls, because all
three bugs above were only visible as behaviour over time.
