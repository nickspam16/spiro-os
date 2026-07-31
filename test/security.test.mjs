// The checks that protect a PUBLIC repo holding a private business's app.
//
// Note what is deliberately absent: nothing here talks to Supabase. Wiring a service-role key
// into CI for a public repository would hand every fork a full-privilege credential. The gate
// tests the artifact, not the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, inlineScripts, lineOf } from './_lib.mjs';

test('no credentials of any kind are committed', () => {
  const patterns = [
    [/service_role/i,                    'the literal "service_role"'],
    [/\bsb_secret_[A-Za-z0-9_-]{8,}/,    'a Supabase secret key (sb_secret_...)'],
    [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'a JWT — service-role keys are JWTs'],
    [/SUPABASE_SERVICE_ROLE/i,           'a service-role env var name'],
    [/\bspiro-key-[A-Za-z0-9_-]{10,}/,   'the __link owner-session minting key'],
    [/\bghp_[A-Za-z0-9]{30,}/,           'a GitHub personal access token'],
  ];
  for (const [re, what] of patterns) {
    const m = app.match(re);
    assert.ok(!m, `index.html line ${m ? lineOf(app, m.index) : '?'} contains ${what}. ` +
      'This repo is public: treat the value as burned and rotate it before doing anything else.');
  }
});

test('escaping helpers are defined', () => {
  assert.match(app, /function\s+esc\s*\(/,   'esc() is missing — HTML escaping helper');
  assert.match(app, /function\s+escJs\s*\(/, 'escJs() is missing — JS-literal escaping helper');
});

test('escJs escapes quotes as hex, not as backslash-quote', () => {
  // \' still emits a real quote character, which closes the surrounding HTML attribute.
  // Only \xNN survives both the HTML attribute decode and the JS parse. This test pins the
  // property, not the implementation.
  const body = app.match(/function\s+escJs\s*\([\s\S]{0,900}?\n\}/);
  assert.ok(body, 'could not locate the escJs body to inspect');
  assert.ok(/\\\\x27|\\\\x22/.test(body[0]) || /x27|x22/.test(body[0]),
    'escJs does not appear to use \\xNN hex escapes for quotes');
});

test('values interpolated into on*= handler code are JS-escaped', () => {
  // The subtle one. An attribute like onclick="<code>" is HTML-decoded BEFORE its JS is compiled,
  // so esc()-ing the finished attribute does not protect a value sitting inside a JS string
  // literal within it: &#39; decodes back to ' and closes the literal.
  // Rule: any variable concatenated into a *Attr handler-code builder must pass through escJs().
  const failures = [];
  const re = /var\s+(\w*Attr)\s*=\s*'([\s\S]{0,400}?)';/g;
  let m;
  while ((m = re.exec(app))) {
    const [, name, bodyRaw] = m;
    const body = m[0];
    if (!/on\w+=|stopPropagation|\(\\?'/.test(bodyRaw)) continue;   // only handler-code builders
    const bare = body.match(/\+\s*(?!escJs\s*\()([A-Za-z_$][\w$]*)\s*\+/g) || [];
    if (bare.length) {
      failures.push(`line ${lineOf(app, m.index)}: ${name} interpolates ${bare.join(', ')} without escJs()`);
    }
  }
  assert.deepEqual(failures, [],
    'handler-attribute builders interpolate values without JS escaping:\n  ' + failures.join('\n  '));
});

test('every inline script parses as valid JavaScript', async () => {
  const vm = await import('node:vm');
  inlineScripts().forEach((src, i) => {
    assert.doesNotThrow(() => new vm.Script(src, { filename: `inline-script-${i}.js` }),
      `inline script #${i} is not syntactically valid — the app would be dead on load`);
  });
});

// Handler-escaping ratchet (2026-07-31, v5.183.0). The codebase's own rule (documented at the
// esc()/escJs() definitions) is that a value interpolated into the JS inside an on*="..." handler
// must be escJs()-escaped — the HTML parser decodes esc()'s entities BEFORE the JS engine reads
// the string, so esc() there is both a live apostrophe bug and an injection path. The rule was
// enforced for *Attr builders only; 201 inline sites still used esc(). All were converted, and
// this pins the class at ZERO — the marker sequence  \'' + esc(  is the idiom's fingerprint.
test('no esc() interpolated into inline handler JS strings', () => {
  const marker = "\\'' + esc(";
  let count = 0, idx = -1;
  while ((idx = app.indexOf(marker, idx + 1)) !== -1) count++;
  assert.equal(count, 0,
    `${count} inline on*-handler interpolation(s) use esc() where escJs() is required — ` +
    `the HTML parser decodes &#39; back to a live quote before the JS runs. Use escJs().`);
});
