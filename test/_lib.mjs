// Shared helpers. No npm dependencies anywhere in this suite, on purpose:
// a deploy gate that can be broken by a transitive package update is not a gate.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_PATH = join(ROOT, 'index.html');
export const SW_PATH = join(ROOT, 'sw.js');

export const hasApp = existsSync(APP_PATH);
export const app = hasApp ? readFileSync(APP_PATH, 'utf8') : '';
export const hasSw = existsSync(SW_PATH);
export const sw = hasSw ? readFileSync(SW_PATH, 'utf8') : '';

/** Inline <script> bodies only (external src= tags excluded). */
export function inlineScripts(src = app) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) if (!/\bsrc\s*=/i.test(m[1])) out.push(m[2]);
  return out;
}

/** External <script src="..."> tags, with their raw attribute string. */
export function externalScripts(src = app) {
  const out = [];
  const re = /<script([^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*)>/gi;
  let m;
  while ((m = re.exec(src))) out.push({ attrs: m[1], url: m[2] });
  return out;
}

/** Character offset -> 1-indexed line, for failure messages that point somewhere real. */
export function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/** CDN <link href="..."> tags (stylesheets etc). Same supply-chain surface as a script. */
export function externalLinks(src = app) {
  const out = [];
  const re = /<link([^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*)>/gi;
  let m;
  while ((m = re.exec(src))) out.push({ attrs: m[1], url: m[2] });
  return out;
}
