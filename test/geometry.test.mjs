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

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { /* not installed */ }
const runnable = hasApp && chromium && existsSync(CHROME);
const skip = runnable ? false : 'playwright/chromium not available';

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
  const browser = await chromium.launch({ executablePath: CHROME });
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
