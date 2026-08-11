// Local e2e runner — builds the app with VITE_FIRESTORE_PREFIX=devtest_ so every
// test writes ONLY to isolated devtest_* Firestore collections (never the live
// app data), starts a preview, runs the suites, then cleans up.
//   node test/run-local.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', 'app');
const testDir = here;

const SUITES = [
  'smoke.mjs',
  'feature-check.mjs',
  'greeting-check.mjs',
  'chat-check.mjs',
  'chat-e2e.mjs',
  'group-e2e.mjs',
  'name-unique-check.mjs',
  'map-check.mjs',
  'map-e2e.mjs'
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
  // best-effort: kill any process running 'vite preview' on 4173.
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vite.*preview.*4173' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  await new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', script], { cwd: here, shell: false, stdio: 'ignore' });
    child.on('close', resolve);
    child.on('error', resolve);
  });
  await new Promise((r) => setTimeout(r, 500));
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

console.log('▶ Starting preview on :4173 (test bundle)…');
await killPreview();
const preview = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4173', '--strictPort'], {
  cwd: appDir,
  shell: true,
  stdio: 'ignore',
  detached: process.platform !== 'win32'
});
preview.unref?.();
const up = await waitForServer('http://localhost:4173/');
if (!up) {
  console.error('✗ preview never came up');
  process.exit(1);
}

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
