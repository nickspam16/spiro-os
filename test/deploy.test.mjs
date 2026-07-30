// Deploy-shape checks. These are about the gap between "the file changed" and "users see it".
//
// HISTORY, because this file used to enforce the opposite (2026-07-30):
// It required that any index.html change be accompanied by a bump of a 'spiro-os-vNN' cache name
// in sw.js, on the reasoning that "if the service worker's cache name does not change, some users
// keep the previous build indefinitely and there is no error anywhere to notice."
//
// That was true of the ORIGINAL cache-first worker. It stopped being true the moment sw.js was
// rewritten to stale-while-revalidate — which sw.js's own header records: "a new index.html deploy
// reaches the user on their next open WITHOUT needing this file to change." The rule was never
// retired, so for weeks the gate demanded a manual edit to fix a bug that no longer existed, and
// turned CI red whenever that edit was forgotten. It was forgotten most times: index.html shipped
// through v5.157 → v5.163 while sw.js sat at v85, and the only real consequence was the author
// being served stale builds and mistaking them for failed fixes.
//
// A check that fires constantly for a reason that is no longer real does not make deploys safer —
// it trains you to ignore the gate. So the coupling rule is gone, replaced by tests for the two
// properties that actually carry the guarantee it was pretending to provide:
//   1. the worker really does revalidate (otherwise stale builds DO strand, and the old rule
//      would have been right after all)
//   2. the app registers the worker and tells the user when a new build is ready
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, sw, hasSw } from './_lib.mjs';

test('service worker declares a cache name', { skip: hasSw ? false : 'no sw.js in repo' }, () => {
  assert.match(sw, /const\s+CACHE\s*=\s*['"][^'"]+['"]/,
    'sw.js has no CACHE constant — the activate handler cleans up by comparing against it');
});

// THE LOAD-BEARING CHECK. Dropping the version bump is only safe because the worker refreshes its
// cached copy from the network on every fetch. If someone ever simplifies this back to cache-first,
// deploys would silently stop reaching users — the exact failure the old rule was guarding, now
// guarded at the actual cause rather than by a manual chore.
test('the worker revalidates from the network, so deploys propagate without a cache bump', {
  skip: hasSw ? false : 'no sw.js in repo',
}, () => {
  assert.match(sw, /fetch\(\s*e\.request\s*\)/,
    'sw.js never fetches from the network in its fetch handler — it is cache-only, so a deploy would never reach an existing user');
  assert.match(sw, /cache\.put\(/,
    'sw.js fetches but never writes the fresh response back to the cache — the next open would still serve the old build');
});

test('the app registers the worker and offers an update prompt', { skip: hasSw ? false : 'no sw.js in repo' }, () => {
  assert.ok(/serviceWorker/.test(app),
    'sw.js exists but index.html never registers a service worker');
  assert.ok(/updatefound/.test(app),
    'no updatefound handler — a user sitting on an open session would never be told a new build is ready');
});
