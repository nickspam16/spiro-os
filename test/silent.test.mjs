// SILENT-FAILURE RATCHET (2026-07-30).
//
// WHY THIS EXISTS. Every long-lived bug found on 2026-07-30 was silent, not loud:
//   * `ask` returned 502 for six days behind the words "AI triage unavailable right now"
//   * fema-flood-lookup had never worked once; the symptom was "Lookup failed"
//   * Buyer Portal sat on "Loading…" forever because one failure path was a bare `return`
//   * the geo-backfill failed on seven properties every night and printed nothing anywhere
// None of these were hard to fix. All of them were hard to NOTICE, and that is the actual defect.
//
// WHAT IT CHECKS. A "silent I/O path" is a `return` (or an empty catch) that fires immediately
// after the code inspected the result of a network call — `.error`, `.ok`, an await, a token — and
// says nothing to anyone: no toast, no field message, no reportError.
//
// WHY A RATCHET AND NOT A BAN. There were 39 of these when the rule was written, and a good number
// are legitimate: a helper returning null on "no match" is not a fault, and a toast about a missing
// photo thumbnail mid-scroll is worse than the missing thumbnail. Failing the build on all 39 would
// have produced exactly one outcome — the rule gets deleted. So the count is frozen instead. Fix
// them and the baseline drops; add one and the build fails.
//
// HOW TO SATISFY IT. Either say something to the user (toast/showFormErr/textContent), or report it
// to telemetry with reportError() so it reaches client_errors, or — when silence is genuinely
// correct — write `silent-ok: <reason>` in a comment within four lines. An annotated silence is a
// decision; an unannotated one is an oversight, and the whole point is to tell those apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './_lib.mjs';

// Frozen at the count measured on 2026-07-30, after the edgeJson() consolidation.
// LOWER THIS when you fix some. Never raise it.
const BASELINE = 11;

function silentIoPaths(src) {
  const lines = src.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const bare = /^\s*(if\s*\([^)]*\)\s*)?\{?\s*return(\s+null|\s+false|\s+\[\])?;\s*\}?\s*$/.test(l);
    const emptyCatch = /catch\s*\([a-z0-9]*\)\s*\{\s*\}/.test(l);
    if (!bare && !emptyCatch) continue;
    const win = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
    const touchedIo = /\.error|\.ok\b|await |\bres\b|\bresp\b|!r\.|!tok|!link|!row|!res/.test(win);
    const saidSomething = /toast\(|showFormErr\(|reportError\(|textContent\s*=|innerHTML\s*=|askFailure\(|renderPortalMsg\(/.test(win);
    const annotated = /silent-ok:/.test(win);
    if (touchedIo && !saidSomething && !annotated) hits.push({ line: i + 1, code: l.trim().slice(0, 80) });
  }
  return hits;
}

test('no NEW silent failure paths', () => {
  const hits = silentIoPaths(app);
  const detail = hits.slice(0, 12).map(h => `  L${h.line}  ${h.code}`).join('\n');
  assert.ok(hits.length <= BASELINE,
    `${hits.length} unannotated silent I/O paths, baseline is ${BASELINE}.\n` +
    `A new one was added. Either tell the user, call reportError(), or write "silent-ok: <reason>".\n${detail}`);
});

// The ratchet only ratchets if someone lowers it. This nags when the real number has dropped,
// so the baseline follows the code down instead of quietly leaving slack for regressions.
test('baseline is not stale (lower it when you fix some)', () => {
  const n = silentIoPaths(app).length;
  assert.ok(n >= BASELINE - 3,
    `Only ${n} silent I/O paths remain but BASELINE is still ${BASELINE}. Lower BASELINE to ${n} in silent.test.mjs.`);
});

// The four geocoding/flood helpers were nine identical lines four times over, every copy ending
// `if (!r.ok) return null`. That duplication is what made one broken endpoint indistinguishable
// from a legitimate no-match. They now share edgeJson(); this stops the pattern growing back.
test('edge-function calls go through the shared reporting helper', () => {
  assert.match(app, /async function edgeJson\(/,
    'edgeJson() is gone — the shared edge caller is what makes a transport failure diagnosable');
  const rawHandlers = (app.match(/if \(!r\.ok\) return null;/g) || []).length;
  assert.ok(rawHandlers === 0,
    `${rawHandlers} hand-rolled "if (!r.ok) return null" edge callers remain — route them through edgeJson(label) instead`);
});
