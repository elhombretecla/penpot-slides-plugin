// Browser suites against the built UI (dist/), with a mock Penpot host.
//
//   npm run e2e                 build, then run every suite
//   node e2e/run.mjs canvas     run one suite (dist/ must be built)
//
// Needs Chrome or Chromium: set CHROME_PATH if it is not in a usual place.
// Screenshots (and a capture of every failing step) go to e2e/output/.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { hostHtml } from './host.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'output');
const PORT = Number(process.env.E2E_PORT ?? 4455);
const URL = `http://127.0.0.1:${PORT}/`;
const SUITES = ['main', 'text-editing', 'canvas', 'perf'];

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH to a Chrome / Chromium binary.');
  return found;
}

async function startPreview() {
  // The vite binary itself (not npx), so killing it stops the server.
  const vite = path.join(ROOT, 'node_modules', '.bin', 'vite');
  const server = spawn(vite, ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(URL)).ok) return server;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  server.kill();
  throw new Error(`vite preview did not start on port ${PORT}`);
}

async function runSuite(browser, name) {
  const suite = await import(`./suites/${name}.mjs`);
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.setContent(hostHtml({ url: URL, ...suite.options }));

  let failed = 0;
  let passed = 0;
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${name}-${n}.png`) });
  const step = async (title, fn) => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${title}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${title} — ${String(e?.message ?? e).split('\n')[0]}`);
      await shot('fail-' + title.replace(/\W+/g, '_')).catch(() => {});
    }
  };

  console.log(`\n${name}`);
  await suite.default({ page, f: page.frameLocator('#ui'), step, shot });
  if (errors.length > 0) {
    failed++;
    console.log(`  ✗ console errors:\n    ${errors.join('\n    ')}`);
  }
  await page.close();
  return { passed, failed };
}

const only = process.argv.slice(2);
const suites = only.length > 0 ? only : SUITES;
if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/ is missing: run "npm run build" first (or "npm run e2e").');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const server = await startPreview();
let browser;
let total = { passed: 0, failed: 0 };
try {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  for (const name of suites) {
    const r = await runSuite(browser, name);
    total = { passed: total.passed + r.passed, failed: total.failed + r.failed };
  }
} finally {
  await browser?.close();
  server.kill();
}
console.log(`\n${total.passed} passed, ${total.failed} failed`);
process.exit(total.failed > 0 ? 1 : 0);
