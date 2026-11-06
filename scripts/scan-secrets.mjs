// Looks for credentials in a folder. Used by the test gate (so nothing secret reaches this public repo)
// and by the "Import backend" workflow (so nothing secret is committed from Supabase).
// It prints the FILE, LINE and RULE of a hit, never the matched text, so logs never leak a value.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const RULES = [
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{8,}/],
  ['Supabase access token', /\bsbp_[a-f0-9]{40}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['Database URL with a password', /postgres(?:ql)?:\/\/[^:\s\/'"]+:(?!\[|%5B|\$|<|\{|YOUR|PASSWORD|password)[^@\s'"]{4,}@/i],
  ['API key (sk-...)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{10,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
// name = "long literal" (password, token, key ...). Needs a digit and a letter so plain words pass.
const ASSIGN = /(secret|token|password|passwd|api[_-]?key|apikey|private[_-]?key|trigger[_-]?key|mint[_-]?key)["']?\s*[:=,(]\s*['"`]([A-Za-z0-9+\/_=.-]{20,})['"`]/ig;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]{10,}/g;
const TEXT = /\.(ts|tsx|js|mjs|json|sql|toml|md|txt|yml|yaml|sh|html|env)$/i;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git') continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT.test(n) && st.size < 5_000_000) out.push(p);
  }
  return out;
}

export function scan(dir, { allow = [] } = {}) {
  if (!existsSync(dir)) return [];
  const hits = [];
  for (const file of walk(dir)) {
    const rel = relative(process.cwd(), file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const add = rule => { if (!allow.includes(`${rel}|${rule}`)) hits.push({ file: rel, line: i + 1, rule }); };
      for (const [rule, re] of RULES) if (re.test(line)) add(rule);
      for (const m of line.matchAll(JWT)) {
        let role = '?';
        try { role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role; } catch {}
        // The anon key is public by design. Anything else (service_role, unreadable) is not.
        if (role !== 'anon') add('JWT that is not the public anon key');
      }
      for (const m of line.matchAll(ASSIGN)) {
        const v = m[2];
        if (/[0-9]/.test(v) && /[A-Za-z]/.test(v) && !/^https?:/i.test(v)) add('Secret-looking value assigned to ' + m[1].toLowerCase());
      }
    });
  }
  return hits;
}

export function readAllowList(file = 'scripts/secret-scan-allow.txt') {
  return existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    : [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'backend';
  const hits = scan(dir, { allow: readAllowList() });
  for (const h of hits) console.error(`${h.file}:${h.line}  ${h.rule}`);
  if (hits.length) { console.error(`\n${hits.length} possible secret(s) found. Nothing was committed.`); process.exit(1); }
  console.log(`No secrets found in ${dir}.`);
}
