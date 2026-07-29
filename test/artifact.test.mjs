// Does the file we are about to serve look like the app at all?
//
// Every assertion here exists because the failure actually happened, not because it is tidy.
// On 2026-07-28 the repo was briefly believed to hold a 413,382-byte build stamped
// "v2.4 - redirect fixed" while the intended build was 787KB. Nobody could tell from the
// GitHub UI. These checks make that condition loud instead of a forensic exercise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, hasApp, inlineScripts, externalScripts, externalLinks, APP_PATH } from './_lib.mjs';

test('index.html exists at the repo root', () => {
  assert.ok(hasApp, `expected the app at ${APP_PATH} — GitHub Pages serves this path`);
});

test('is not a truncated or placeholder build', () => {
  // Floor, not an exact size: the app grows. 600KB is comfortably below the real build and
  // comfortably above any stub, redirect shim or half-written upload.
  assert.ok(app.length > 600_000,
    `index.html is ${app.length} bytes — under the 600,000 floor. A partial upload or the wrong file.`);
});

test('the document is complete, not cut off mid-write', () => {
  assert.match(app.trimEnd().slice(-20), /<\/html>\s*$/i,
    'index.html does not end with </html> — the upload was truncated');
});

test('APP_VERSION is present and is a bare semver tag', () => {
  const m = app.match(/var\s+APP_VERSION\s*=\s*'([^']*)'/);
  assert.ok(m, "no `var APP_VERSION = '...'` found — cannot tell what build this is");
  assert.match(m[1], /^v\d+\.\d+\.\d+$/,
    `APP_VERSION is ${JSON.stringify(m[1])}. It must be a bare vX.Y.Z tag. ` +
    'Anything else means either a stray build or prose leaking into a public file — ' +
    'this app is readable via view-source, and the version string used to carry the internal changelog.');
});

test('exactly one inline application script', () => {
  const inline = inlineScripts();
  assert.equal(inline.length, 1,
    `expected 1 inline <script> (the app), found ${inline.length} — the build shape changed`);
  assert.ok(inline[0].length > 500_000,
    `the inline app script is only ${inline[0].length} chars — truncated`);
});

test('third-party library assets are pinned to an exact version', () => {
  // A floating CDN reference ("/latest/") silently swaps third-party code inside your origin with
  // no commit and no review. Scoped to LIBRARY CDNs on purpose: font providers do not version their
  // URLs, and a gate that flags Google Fonts every run is a gate that gets switched off.
  // Covers <script src> AND <link href> -- a mutation test on 2026-07-28 showed the script-only
  // version missed an unpinned stylesheet entirely.
  const LIB_CDN = /(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)/i;
  const assets = [...externalScripts().map(a => ({ ...a, kind: 'script' })),
                  ...externalLinks().map(a => ({ ...a, kind: 'link' }))];
  for (const { url, kind, attrs } of assets) {
    if (!LIB_CDN.test(url)) continue;
    if (/rel\s*=\s*["'](preconnect|dns-prefetch)["']/i.test(attrs || '')) continue;
    assert.ok(!/\/latest\//i.test(url) && /\d+\.\d+\.\d+/.test(url),
      `third-party ${kind} is not version-pinned: ${url}`);
  }
});
