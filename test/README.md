# Spiro OS deploy gate

Run it locally, from the repo root:

```
node --test --test-reporter=spec test/
```

No `npm install`. No dependencies. Node 18+ (22 in CI). It reads `index.html` off disk and checks it.

## Why each check exists

Every assertion here traces to something that actually went wrong, not to a style guide.

| Check | The failure it prevents |
|---|---|
| size floor, `</html>` present, one inline script | A truncated or wrong-file upload. On 2026-07-28 a 413KB build was mistaken for the intended 787KB one, and nothing in the GitHub UI made that visible. |
| `APP_VERSION` is bare `vX.Y.Z` | Catches a stray build (`v2.4 - redirect fixed`) **and** prose leaking into the version string — that field once carried the internal changelog, in a file anyone can read via view-source. |
| no credentials | This repo is public. Catches Supabase service-role JWTs, `sb_secret_…`, the `__link` owner-session key, GitHub PATs. A hit means rotate first, fix second. |
| `esc()` / `escJs()` defined | Deleting an escaping helper is an easy refactor and a silent XSS reintroduction. |
| `escJs` uses `\xNN` | `\'` still emits a real quote, which closes the surrounding HTML attribute. Only hex escapes survive both the attribute decode and the JS parse. |
| handler values are JS-escaped | The subtle one. `onclick="…"` is HTML-decoded **before** its JS is compiled, so escaping the finished attribute does not protect a value inside a JS string literal within it — `&#39;` decodes back to `'` and closes the literal. Values need `escJs()`; the assembled attribute still needs `esc()`. Both, in that order. |
| inline scripts parse | A syntax error ships an app that is dead on load, with a green deploy. |
| library CDN assets pinned | A `/latest/` URL swaps third-party code inside your origin with no commit and no review. Covers `<script src>` and `<link href>`. |
| sw.js cache bump | Stale-while-revalidate means a changed `index.html` without a new `spiro-os-vNN` cache name leaves returning users on the old build, silently. |

## What this gate deliberately does not do

It does not touch Supabase. A public repo must never hold a service-role key, so database behaviour is
out of scope here by design — not by oversight.

## Keeping it honest

`test/` is only worth having if it can fail. The suite was validated by mutation: ten deliberate
breakages (truncation, a planted service-role JWT, a deleted `escJs`, an un-escaped handler value, a
syntax error, an unpinned CDN URL, and others) were each confirmed to turn it red, and to be caught by
the specific assertion meant to catch them. If you add a check, break it once on purpose before you
trust it.
