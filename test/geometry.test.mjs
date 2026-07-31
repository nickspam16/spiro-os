// GEOMETRY GATE (2026-07-30).
//
// Three separate bugs on 2026-07-30 were the same bug: the DOM was correct and the human could not
// see it. None of them are visible to a parser, and all three shipped.
//   * form errors rendered 158px ABOVE the viewport on a 390x780 phone — the save looked like it
//     had silently done nothing
//   * choosing a second panel from the menu APPENDED it a full screen below the one on screen, so
//     the whole menu read as dead
//   * "Track" on a market row opened its picker 887px above the button, on an 880px viewport —
//     Nick reported it as "wont let me click track on this". It let him. He just couldn't see it.
//
// The existing CI reads index.html as text. It can prove the markup is well-formed and the handlers
// are escaped; it cannot prove a person can see the thing they just summoned. This renders the real
// file in a real browser at real phone dimensions and asserts on PIXELS.
//
// The rule these encode: ANYTHING OPENED BY A ROW MUST APPEAR INSIDE THAT ROW, and anything opened
// at all must be within the viewport. Both are cheap to assert and neither can be checked by
// reading code.
//
// Skips cleanly when Playwright/Chromium is absent so the suite still runs anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { APP_PATH, hasApp } from './_lib.mjs';

// Chromium lives in different places depending on how Playwright was installed. Probe rather than
// hard-code, so a normal `npx playwright install chromium` works without editing this file.
const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
];
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
const CHROME = CHROME_CANDIDATES.find(p => p && existsSync(p)) || null;
// executablePath is optional — if Playwright manages its own browser, let it.
const launchOpts = CHROME ? { executablePath: CHROME } : {};
const runnable = hasApp && !!chromium;

// A SKIPPED GATE THAT LOOKS LIKE A PASSING ONE IS THE EXACT BUG THIS SUITE EXISTS TO CATCH.
// Node prints "ok N - ... # SKIP", CI goes green, and everyone believes the geometry is covered.
// That is the same shape as "AI triage unavailable right now" — a reassuring message over a thing
// that is not running. So: skipping is fine on a laptop, and a hard failure in CI. If this fires,
// the fix is `npm i -D playwright && npx playwright install chromium`, not deleting the test.
const inCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
// The checks themselves always skip when they cannot run — five cascading failures with five
// different stack traces obscure the one fact that matters. The single guard test below is the
// loud one, and it names the fix.
const skip = runnable ? false : 'playwright not installed';

test('the geometry gate can actually run in CI', { skip: inCI ? false : 'only enforced in CI' }, () => {
  assert.ok(runnable,
    'Playwright is not installed, so every geometry check below SKIPPED and CI went green anyway. ' +
    'A silently skipped gate is indistinguishable from a passing one — that is the bug class this ' +
    'file exists to catch. Fix: npm i -D playwright && npx playwright install chromium');
});

const VIEWPORT = { width: 390, height: 780 };   // the phone Nick actually uses

// index.html loads <script src="supabase.js"> as a SIBLING. Rendering it from a directory without
// that file leaves `supabase` undefined and every test here fails on boot for a reason that has
// nothing to do with the app. Stage a self-contained copy: the real client when it sits next to
// index.html (as it does in the repo), otherwise an offline stub with the same surface. Network is
// stubbed by page.route() either way, so the stub only has to exist, not work.
const STUB = `window.supabase = { createClient: function () {
  var q = function () { return chain; };
  var chain = { select:q, insert:q, update:q, delete:q, upsert:q, eq:q, neq:q, in:q, is:q, not:q,
    gte:q, lte:q, gt:q, lt:q, or:q, order:q, limit:q, single:q, maybeSingle:q,
    then: function (res) { return Promise.resolve({ data: [], error: null }).then(res); } };
  return { from: function () { return chain; },
    rpc: function () { return Promise.resolve({ data: null, error: null }); },
    functions: { invoke: function () { return Promise.resolve({ data: null, error: { message: 'stub' } }); } },
    storage: { from: function () { return { remove: function () { return Promise.resolve({ error: null }); },
      upload: function () { return Promise.resolve({ error: null }); },
      getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
    auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({}); },
      signInWithOtp: function () { return Promise.resolve({ error: null }); },
      verifyOtp: function () { return Promise.resolve({ error: null }); } } };
} };`;

function stageApp() {
  const dir = mkdtempSync(join(tmpdir(), 'spiro-geom-'));
  copyFileSync(APP_PATH, join(dir, 'index.html'));
  const sibling = join(dirname(APP_PATH), 'supabase.js');
  if (existsSync(sibling)) copyFileSync(sibling, join(dir, 'supabase.js'));
  else writeFileSync(join(dir, 'supabase.js'), STUB);
  return join(dir, 'index.html');
}
const STAGED = runnable ? stageApp() : null;

async function withPage(fn) {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/functions/v1/**', r => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"stub"}' }));
  await page.goto('file://' + STAGED);
  await page.waitForTimeout(700);
  try { return await fn(page, errors); } finally { await browser.close(); }
}

test('the app boots on a phone-sized screen without throwing', { skip }, async () => {
  const errors = await withPage(async (page, errs) => { await page.waitForTimeout(500); return errs; });
  assert.deepEqual(errors, [], 'uncaught errors during boot: ' + errors.join(' | '));
});

test('row pickers open INSIDE their row and on screen, not a screenful away', { skip }, async () => {
  const r = await withPage(async (page) => page.evaluate(() => {
    MARKET.events = Array.from({ length: 40 }, (_, i) => ({
      id: 'e' + i, event_type: 'new', event_date: '2026-07-30', neighborhood: 'Brentwood',
      address: (3000 + i) + ' Test Rd', list_price: 2800000, review_status: 'pending', extra: {} }));
    MARKET.config = [{ neighborhood: 'Brentwood', active: true }];
    DATA.buyers = [{ id: 'b1', name: 'Test Buyer', budget_min_num: 2e6, budget_max_num: 4e6, areas: 'Brentwood', extra: {} }];
    document.getElementById('screen-app').style.display = 'block';
    menuGoMarket();
    const target = 'e30';                                  // deep in the list, where the bug was worst
    const row = [...document.querySelectorAll('#market-body .qi')].find(x => x.innerText.includes('3030 Test Rd'));
    row.scrollIntoView({ block: 'center' });
    const out = {};
    for (const [name, open, hostPrefix] of [
      ['track', openTrackMarketEvent, 'mtrack-'],
      ['flag', openFlagMarketEvent, 'mflag-'],
      ['dismiss', dismissMarketEvent, 'mdismiss-'],
    ]) {
      open(target);
      const host = document.getElementById(hostPrefix + target);
      const box = host ? host.getBoundingClientRect() : null;
      out[name] = {
        opened: !!(host && host.innerHTML),
        insideRow: !!host && row.contains(host),
        onScreen: !!box && box.top > -60 && box.top < window.innerHeight,
        leakedToListTop: !!document.querySelector('#market-body > .card'),
      };
      if (host) host.innerHTML = '';
    }
    return out;
  }));
  for (const [name, v] of Object.entries(r)) {
    assert.ok(v.opened, `${name} picker did not open`);
    assert.ok(v.insideRow, `${name} picker rendered OUTSIDE the row that opened it — this is the "won't let me click Track" bug`);
    assert.ok(v.onScreen, `${name} picker opened off-screen`);
    assert.ok(!v.leakedToListTop, `${name} picker was inserted at the top of the list instead of the row`);
  }
});

test('panels replace each other instead of stacking', { skip }, async () => {
  const r = await withPage(async (page) => page.evaluate(() => {
    const ids = () => [...document.getElementById('panel-slot').children].map(c => c.id);
    openPanel('activity-card'); openPanel('coverage-card'); openPanel('brief-card');
    const afterThree = ids();
    closePanel();
    return { afterThree, afterClose: ids(),
             rehomed: document.getElementById('activity-card').parentNode.id !== 'panel-slot' };
  }));
  assert.equal(r.afterThree.length, 1,
    `opening three panels left ${r.afterThree.length} in the slot (${r.afterThree}) — panels are stacking, so the menu looks dead`);
  assert.equal(r.afterClose.length, 0, 'Back left a card orphaned in the panel slot');
  assert.ok(r.rehomed, 'a superseded panel never went back to its home position');
});

test('a save error is rendered where the person is looking', { skip }, async () => {
  const r = await withPage(async (page) => {
    const out = await page.evaluate(() => {
      document.getElementById('screen-app').style.display = 'block';
      showForm('buyers', null);
      window.scrollTo(0, 0);
      const field = FORM_SPECS.buyers[FORM_SPECS.buyers.length - 1][0];   // the LAST field, worst case
      showFormErr('Something went wrong', field);
      return { field };
    });
    // scrollIntoView is SMOOTH — measuring immediately reports the pre-scroll position and invents
    // a bug that isn't there. Let it settle first. (Cost one false alarm while writing this test.)
    await page.waitForTimeout(900);
    return page.evaluate(({ field }) => {
      const err = document.getElementById('form-err').getBoundingClientRect();
      const fld = document.getElementById('f_' + field).getBoundingClientRect();
      return { errTop: err.top, fieldTop: fld.top, viewport: window.innerHeight };
    }, out);
  });
  // The FIELD is the thing that must be reachable — that is what v5.165.0 fixed. The message being
  // on screen too is the stronger property; assert the field hard, and the message where it fits.
  assert.ok(r.fieldTop > -60 && r.fieldTop < r.viewport,
    `the offending field sat at y=${Math.round(r.fieldTop)} on a ${r.viewport}px screen — the person cannot see what to fix`);
  assert.ok(r.errTop < r.viewport,
    `the error text rendered at y=${Math.round(r.errTop)}, below the fold on a ${r.viewport}px screen`);
});

// Review queue (2026-07-31, v5.181.0): the panel is new — assert it opens IN the slot, ON screen,
// with at least an empty-state message. Same invisible-UI bug class the rest of this file guards.
test('the review queue panel opens on screen with content', { skip }, async () => {
  const r = await withPage(async (page) => page.evaluate(async () => {
    document.getElementById('screen-app').style.display = 'block';
    menuShowReviewQueue();
    await new Promise((res) => setTimeout(res, 300));
    const card = document.getElementById('review-queue-card');
    const rect = card.getBoundingClientRect();
    return { inSlot: card.parentNode.id === 'panel-slot',
             visible: card.style.display !== 'none',
             onScreen: rect.top >= 0 && rect.top < window.innerHeight,
             hasBody: !!document.getElementById('rq-body').textContent.trim() };
  }));
  assert.ok(r.inSlot, 'review-queue-card did not move into the panel slot');
  assert.ok(r.visible, 'review-queue-card stayed display:none after menuShowReviewQueue()');
  assert.ok(r.onScreen, 'the review queue opened off-screen — the "won\'t let me click" bug class');
  assert.ok(r.hasBody, 'rq-body rendered nothing — not even an empty state');
});

// Back-gesture (2026-07-31, v5.182.0): opening a panel must register exactly one history entry so
// the phone's back gesture closes the panel and lands home — instead of exiting the PWA, which is
// what every Android back-swipe did for the app's entire life until tonight.
test('the phone back gesture closes a panel instead of exiting the app', { skip }, async () => {
  const r = await withPage(async (page) => {
    await page.evaluate(() => {
      document.getElementById('screen-app').style.display = 'block';
      openPanel('activity-card');
    });
    await page.waitForTimeout(150);
    const openState = await page.evaluate(() => ({
      panelOpen: !!PANEL_HOME,
      historyOwned: !!(history.state && history.state.spiroPanel),
    }));
    await page.goBack();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      panelOpen: !!PANEL_HOME,
      homeVisible: document.getElementById('home-view').style.display !== 'none',
    }));
    return { openState, after };
  });
  assert.ok(r.openState.panelOpen, 'panel did not open');
  assert.ok(r.openState.historyOwned, 'opening a panel registered no history entry — Back would exit the PWA');
  assert.ok(!r.after.panelOpen, 'the back gesture did not close the panel');
  assert.ok(r.after.homeVisible, 'Back closed the panel but never restored the home view');
});

// Panel round-trip sweep (2026-07-31, v5.183.0). Derives the card list from the DOM, so every
// FUTURE card is covered automatically. Would have auto-caught the v5.180 bug where
// review-queue-card was missing from closePanel's hidden-restore list and stayed parked visible
// at the bottom of the home page after one open/close.
test('every home card opened as a panel lands on screen, goes home, and re-hides', { skip }, async () => {
  const failures = await withPage(async (page) => page.evaluate(() => {
    document.getElementById('screen-app').style.display = 'block';
    const out = [];
    const cards = [...document.querySelectorAll('#home-view .card[id]')];
    for (const c of cards) {
      const id = c.id, parent0 = c.parentNode, hidden0 = c.style.display === 'none';
      openPanel(id);
      const inSlot = c.parentNode && c.parentNode.id === 'panel-slot';
      const rect = c.getBoundingClientRect();
      const onScreen = rect.top >= 0 && rect.top < window.innerHeight;
      closePanel();
      const homeAgain = c.parentNode === parent0;
      const hiddenAgain = hidden0 ? c.style.display === 'none' : true;
      if (!inSlot || !onScreen || !homeAgain || !hiddenAgain)
        out.push(id + ' ' + JSON.stringify({ inSlot, onScreen, homeAgain, hiddenAgain }));
    }
    return out;
  }));
  assert.equal(failures.length, 0, 'panel round-trip failures:\n' + failures.join('\n'));
});
