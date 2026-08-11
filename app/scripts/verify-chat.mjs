// Validates the Firebase chat config in app/.env without needing the SDK.
//   node app/scripts/verify-chat.mjs
// Prints PASS/FAIL for: config present, Firestore reachable, rules allow read.
// (Cheap REST call — no test data is written.)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');

function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv(envPath);
const apiKey = env.VITE_FIREBASE_API_KEY || '';
const projectId = env.VITE_FIREBASE_PROJECT_ID || '';

if (!apiKey || !projectId) {
  console.log('NOT CONFIGURED — no Firebase keys found in app/.env');
  console.log('  Copy app/.env.example to app/.env and fill in your values (see plan.md "Chat setup").');
  process.exit(0);
}
console.log(`Config found: project ${projectId}, apiKey ${apiKey.slice(0, 8)}…`);

try {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/messages?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    const n = body.documents ? body.documents.length : 0;
    console.log(`PASS  Firestore reachable + readable (rules OK). ${n} message(s) currently in the wall.`);
    process.exit(0);
  }
  const msg = body.error?.message || body.error?.status || `${res.status}`;
  console.log(`FAIL  ${msg}`);
  console.log('  Common causes: Firestore not enabled, wrong project id, API key typo,');
  console.log('  or the Firestore security rules (see firestore.rules) were not published.');
  process.exit(1);
} catch (err) {
  console.log(`FAIL  network error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
