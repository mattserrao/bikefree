// The app's source text for tests that check how the page is wired: js/app.js and its modules in js/app/.
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
export function appSource() {
  const files = ['js/app.js', ...readdirSync(new URL('js/app/', root)).filter((f) => f.endsWith('.js')).sort().map((f) => `js/app/${f}`)];
  return files.map((f) => readFileSync(new URL(f, root), 'utf8')).join('\n');
}
