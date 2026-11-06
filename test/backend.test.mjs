// Checks on the backend/ folder (Supabase edge functions + migrations) and on the deploy workflows.
// Same rule as the rest of this suite: no npm dependencies, and every check traces to a real failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_lib.mjs';
import { scan, readAllowList } from '../scripts/scan-secrets.mjs';

const PROJECTS = { crm: 'mtnkkeftmcfxeygkbkja', portal: 'bnrkcndpwfvuvtyrpivf' };
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const DOC = join(ROOT, 'docs', 'HOW-DEPLOY-WORKS.md');

const dirs = p => existsSync(p) ? readdirSync(p).filter(n => statSync(join(p, n)).isDirectory()) : [];

for (const [name, ref] of Object.entries(PROJECTS)) {
  const base = join(ROOT, 'backend', name, 'supabase');

  test(`backend/${name}: config.toml targets the right Supabase project`, () => {
    const toml = readFileSync(join(base, 'config.toml'), 'utf8');
    // Deploying CRM functions into the portal project (or the reverse) is not recoverable by a revert.
    assert.match(toml, new RegExp(`^project_id\\s*=\\s*"${ref}"`, 'm'));
  });

  test(`backend/${name}: every function folder has an entry file and a verify_jwt line`, () => {
    const toml = readFileSync(join(base, 'config.toml'), 'utf8');
    const configured = [...toml.matchAll(/^\[functions\.([A-Za-z0-9_-]+)\]\s*\n\s*verify_jwt\s*=\s*(true|false)\s*$/gm)].map(m => m[1]);
    for (const fn of dirs(join(base, 'functions')).filter(n => !n.startsWith('_'))) {
      assert.ok(
        ['index.ts', 'index.js', 'index.tsx', 'index.mjs'].some(f => existsSync(join(base, 'functions', fn, f))),
        `${fn}: no index.ts. Supabase would reject the deploy.`);
      // Without an explicit line the deploy tool defaults to verify_jwt = true and silently breaks
      // every caller that is not signed in (webhooks, cron jobs, the public share link).
      assert.ok(configured.includes(fn), `${fn}: missing from config.toml. Add [functions.${fn}] with verify_jwt set deliberately.`);
    }
  });

  test(`backend/${name}: migration files are named correctly and in unique order`, () => {
    const mdir = join(base, 'migrations');
    const files = existsSync(mdir) ? readdirSync(mdir).filter(f => f.endsWith('.sql')) : [];
    const versions = new Set();
    for (const f of files) {
      assert.match(f, /^\d{14}_[A-Za-z0-9_]+\.sql$/, `${f}: must look like 20261106123000_what_it_does.sql`);
      const v = f.slice(0, 14);
      assert.ok(!versions.has(v), `${f}: two migrations share the version ${v}`);
      versions.add(v);
    }
  });
}

test('backend/: no passwords or keys anywhere (this repository is public)', () => {
  const hits = scan(join(ROOT, 'backend'), { allow: readAllowList(join(ROOT, 'scripts', 'secret-scan-allow.txt')) })
    .map(h => `${h.file}:${h.line} ${h.rule}`);
  assert.deepEqual(hits, [], 'Possible secrets found (values are not shown). Rotate the credential first, then remove it.');
});

test('workflows: actions are pinned to a version, never a moving branch', () => {
  for (const f of readdirSync(WORKFLOWS).filter(n => /\.ya?ml$/.test(n))) {
    const src = readFileSync(join(WORKFLOWS, f), 'utf8');
    for (const m of src.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      assert.match(m[1], /@v?\d/, `${f}: ${m[1]} is not pinned to a version`);
    }
  }
});

test('workflows: every secret a workflow reads is explained in docs/HOW-DEPLOY-WORKS.md', () => {
  assert.ok(existsSync(DOC), 'docs/HOW-DEPLOY-WORKS.md is missing');
  const doc = readFileSync(DOC, 'utf8');
  const used = new Set();
  for (const f of readdirSync(WORKFLOWS).filter(n => /\.ya?ml$/.test(n))) {
    const src = readFileSync(join(WORKFLOWS, f), 'utf8');
    for (const m of src.matchAll(/secrets\.([A-Z0-9_]+)/g)) if (m[1] !== 'GITHUB_TOKEN') used.add(m[1]);
  }
  for (const s of used) assert.ok(doc.includes(s), `A workflow reads the secret ${s} but the instructions never tell anyone to create it.`);
});

test('workflows: deploy and rollback share one queue so two deploys can never overlap', () => {
  for (const f of ['backend-deploy.yml', 'backend-rollback.yml']) {
    assert.match(readFileSync(join(WORKFLOWS, f), 'utf8'), /group:\s*backend-deploy/, `${f} is not in the backend-deploy queue`);
  }
});

test('workflows: the deploy script never prints a secret', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'deploy-backend.sh'), 'utf8');
  assert.ok(!/echo[^\n]*\$\{?(SUPABASE_ACCESS_TOKEN|db_url|SUPABASE_[A-Z_]*DB_URL)/.test(src), 'deploy-backend.sh echoes a secret variable');
  assert.ok(!/set -x|set -o xtrace/.test(src), 'deploy-backend.sh turns on command tracing, which would print secrets');
});
