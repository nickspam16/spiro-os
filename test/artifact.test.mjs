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

/* FORM_SPECS <-> loadAll select conformance (added 2026-07-30).
 *
 * buildPayload() writes EVERY key in a table's FORM_SPECS entry on every save. The edit form is
 * populated from DATA, which holds only what loadAll selected. So any key that is in the spec but
 * missing from the select renders blank and is then written back as blank — the form silently
 * overwrites database columns it was never able to read.
 *
 * That is what happened to offmarket.beds/baths/sqft/lot_sqft. Snapshots showed only one row had
 * ever carried a value there, so nothing was actually destroyed, but the mechanism was live and the
 * next edit of that row would have taken it. This test is the durable fix: the one-line select
 * change would drift again the next time a field is added to a spec.
 *
 * select('*') returns every column and therefore always conforms.
 */
test('every FORM_SPECS field is fetched by its table’s select', () => {
  const specsStart = app.indexOf('var FORM_SPECS = {');
  assert.ok(specsStart > -1, 'FORM_SPECS not found');
  let depth = 0, i = app.indexOf('{', specsStart), end = i;
  for (;; end++) {
    if (app[end] === '{') depth++;
    else if (app[end] === '}' && --depth === 0) break;
  }
  const block = app.slice(i, end + 1);

  // Virtual fields resolved after save, never columns on the row.
  const VIRTUAL = new Set(['list_agent']);

  const specs = {};
  for (const m of block.matchAll(/(\w+):\s*\[/g)) {
    let d = 0, s = m.end !== undefined ? m.end : m.index + m[0].length, e = s - 1;
    for (;; e++) {
      if (block[e] === '[') d++;
      else if (block[e] === ']' && --d === 0) break;
    }
    specs[m[1]] = [...block.slice(s - 1, e + 1).matchAll(/\[\s*'([a-z_0-9]+)'/g)].map((x) => x[1]);
  }
  assert.ok(Object.keys(specs).length >= 5, 'parsed too few FORM_SPECS entries — parser drifted');

  const selects = {};
  for (const m of app.matchAll(/sb\.from\('(\w+)'\)\.select\('([^']*)'\)/g)) {
    (selects[m[1]] ||= []).push(m[2]);
  }

  const problems = [];
  for (const [table, keys] of Object.entries(specs)) {
    const forTable = selects[table] || [];
    if (!forTable.length) { problems.push(`${table}: FORM_SPECS entry but no select() found`); continue; }
    if (forTable.some((c) => c.trim() === '*')) continue; // '*' fetches everything
    const fetched = new Set(forTable.flatMap((c) => c.split(',').map((x) => x.trim())));
    const missing = keys.filter((k) => !fetched.has(k) && !VIRTUAL.has(k));
    if (missing.length) {
      problems.push(`${table}: saved by buildPayload but never fetched -> ${missing.join(', ')}`);
    }
  }
  assert.deepStrictEqual(problems, [],
    'FORM_SPECS keys missing from their select will be written back blank on every edit:\n  '
    + problems.join('\n  '));
});
