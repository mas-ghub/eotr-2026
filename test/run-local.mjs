// Local e2e runner — builds the app with VITE_FIRESTORE_PREFIX=devtest_ so every
// test writes ONLY to isolated devtest_* Firestore collections (never the live
// app data), starts a preview, VERIFIES the served bundle really is the isolated
// one, runs the suites, then cleans up.
//   node test/run-local.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', 'app');
const testDir = here;

// A dedicated port so a lingering production preview on :4173 can never be
// accidentally hit by the suites.
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

const SUITES = [
  'smoke.mjs',
  'feature-check.mjs',
  'greeting-check.mjs',
  'chat-check.mjs',
  'chat-e2e.mjs',
  'group-e2e.mjs',
  'name-unique-check.mjs',
  'reminder-check.mjs',
  'favorites-e2e.mjs'
];

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function waitForServer(url, tries = 40) {
  return new Promise((resolve) => {
    let n = 0;
    const check = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve(true);
      } catch {
        /* not up yet */
      }
      if (++n >= tries) return resolve(false);
      setTimeout(check, 250);
    };
    check();
  });
}

async function killPreview() {
  // best-effort: kill any process running 'vite preview' on the test port.
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vite.*preview.*${PORT}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', script], { cwd: here, shell: false, stdio: 'ignore' });
    child.on('close', resolve);
    child.on('error', resolve);
  });
  await new Promise((r) => setTimeout(r, 500));
}

/** Guard: confirm the served page really loads the devtest_ bundle, so a stale
 *  or wrong preview can never silently run the suites against production. */
async function verifyIsolatedBundle() {
  try {
    const html = await (await fetch(BASE + '/')).text();
    const jsFiles = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    if (!jsFiles.length) return false;
    // Normalize './assets/x.js' to '/assets/x.js' for the fetch.
    const norm = (p) => (p.startsWith('/') ? p : '/' + p.replace(/^\.\//, ''));
    const entry = await (await fetch(BASE + norm(jsFiles[0]))).text();
    if (entry.includes('devtest_')) return true;
    // Some builds keep the prefix in a dynamic chunk — scan referenced chunks.
    for (const c of [...entry.matchAll(/["']\.?\/?assets\/([^"']+\.js)["']/g)].map((m) => m[1])) {
      try {
        const chunk = await (await fetch(BASE + norm('assets/' + c))).text();
        if (chunk.includes('devtest_')) return true;
      } catch {
        /* keep scanning */
      }
    }
    return false;
  } catch {
    return false;
  }
}

const started = Date.now();
let failed = 0;

console.log('▶ Building isolated test bundle (devtest_ prefix)…');
await killPreview();
const buildCode = await run('npm', ['run', 'build:test'], appDir);
if (buildCode !== 0) {
  console.error('✗ build:test failed');
  process.exit(1);
}

console.log(`▶ Starting preview on :${PORT} (test bundle)…`);
await killPreview();
const preview = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', String(PORT), '--strictPort'], {
  cwd: appDir,
  shell: true,
  stdio: 'ignore',
  detached: process.platform !== 'win32'
});
preview.unref?.();
const up = await waitForServer(BASE + '/');
if (!up) {
  console.error('✗ preview never came up');
  process.exit(1);
}
const isolated = await verifyIsolatedBundle();
if (!isolated) {
  console.error('✗ served bundle does NOT contain the devtest_ prefix — aborting (won’t risk polluting production)');
  await killPreview();
  process.exit(1);
}
console.log('✓ confirmed: served bundle is the isolated devtest_ build');

for (const suite of SUITES) {
  const t = Date.now();
  console.log(`\n▶ ${suite}`);
  const code = await run('node', [join(testDir, suite)], testDir);
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  if (code !== 0) {
    failed++;
    console.error(`✗ ${suite} FAILED (${secs}s)`);
  } else {
    console.log(`✓ ${suite} passed (${secs}s)`);
  }
}

await killPreview();
const total = SUITES.length;
console.log(`\n${total - failed}/${total} suites passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
