// Penpot evaluates plugin.js as a classic script, not a module: a shared
// chunk `import` (or any module syntax) breaks the plugin at load. Compile
// the bundle the same way to catch that at build time.
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../dist/plugin.js', import.meta.url), 'utf8');
try {
  new Function(code);
} catch (err) {
  console.error(`dist/plugin.js is not a classic script: ${err.message}`);
  process.exit(1);
}
console.log('dist/plugin.js is a self-contained script.');
