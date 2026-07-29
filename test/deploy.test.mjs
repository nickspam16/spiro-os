// Deploy-shape checks. These are about the gap between "the file changed" and "users see it".
//
// Spiro OS ships as a stale-while-revalidate PWA, which is why opening the app once after an
// upload shows the OLD build. If the service worker's cache name does not change, some users
// keep the previous build indefinitely and there is no error anywhere to notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, sw, hasSw } from './_lib.mjs';

test('service worker declares a versioned cache name', { skip: hasSw ? false : 'no sw.js in repo' }, () => {
  assert.match(sw, /['"]spiro-os-v\d+['"]/,
    "sw.js has no 'spiro-os-vNN' cache name — cache busting cannot work without one");
});

// Set by the CI workflow, which is the only place that can see the diff.
// Locally these are undefined and the test skips rather than lying.
const changedApp = process.env.SPIRO_APP_CHANGED;
const changedSw  = process.env.SPIRO_SW_CHANGED;

test('a changed index.html is accompanied by a service-worker cache bump', {
  skip: changedApp === undefined ? 'no diff info (run in CI)' : false,
}, () => {
  if (changedApp !== '1') return;                 // app untouched: nothing to enforce
  if (!hasSw) return;                             // no service worker: not applicable
  assert.equal(changedSw, '1',
    'index.html changed but sw.js did not. Bump the spiro-os-vNN cache name, ' +
    'or returning users will keep being served the previous build with no error shown.');
});

test('the app and the service worker agree that caching exists', { skip: hasSw ? false : 'no sw.js in repo' }, () => {
  assert.ok(/serviceWorker/.test(app),
    'sw.js exists but index.html never registers a service worker');
});
