// Push sender — runs as a scheduled GitHub Actions cron (every 5 min) and as a
// manual workflow dispatch. Reads due reminders from Firestore and sends an FCM
// web push to each device's token, so reminders fire even when the app is fully
// closed (critical on iOS, where background timers are suspended).
//
// Requires: FIREBASE_SERVICE_ACCOUNT (JSON) as an environment variable / secret.
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';

const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!saEnv) {
  console.error('FIREBASE_SERVICE_ACCOUNT env var is required (service account JSON).');
  process.exit(1);
}
const serviceAccount = JSON.parse(saEnv);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const collectionName = process.env.FIRESTORE_PREFIX ? `${process.env.FIRESTORE_PREFIX}pushReminders` : 'pushReminders';

// Grace window: send if the reminder is due within the last 5 minutes (the cron
// interval), so a reminder that just came due is still pushed if the job is a
// little late. Anything older is skipped (it fired long ago / was purged).
const GRACE_MS = 5 * 60 * 1000;

const now = Date.now();
let sent = 0;
let skipped = 0;
let failed = 0;

const snap = await db.collection(collectionName).get();
if (snap.empty) {
  console.log('No push reminder docs found.');
  process.exit(0);
}

for (const doc of snap.docs) {
  const data = doc.data();
  const token = data.token;
  const reminders = Array.isArray(data.reminders) ? data.reminders : [];
  if (!token || reminders.length === 0) continue;

  for (const r of reminders) {
    if (!r || r.fired) continue;
    const fireAt = typeof r.fireAt === 'number' ? r.fireAt : 0;
    if (fireAt > now) continue; // not due yet
    if (now - fireAt > GRACE_MS) {
      skipped++;
      continue; // too old — a stale cron run or a purged reminder
    }

    const title = r.name ? `${r.name} starts in ${r.leadMin === 0 ? 'At showtime' : r.leadMin + ' min'}` : 'EOTR 2026 reminder';
    const body = r.stage ? `${r.stage} · ${r.start || ''}` : 'A set you saved is starting';
    const url = r.artistSlug ? `./#/artist/${r.artistSlug}` : './';

    try {
      await admin.messaging().send({
        token,
        data: {
          title,
          body,
          tag: `rem-${r.actId}`,
          url
        }
      });
      sent++;
      // Mark fired so it isn't re-sent by the next cron.
      r.fired = true;
      await doc.ref.update({ reminders, ts: admin.firestore.FieldValue.serverTimestamp() });
    } catch (err) {
      failed++;
      const msg = err && err.message ? err.message : String(err);
      console.error(`Push failed for ${r.actId} (${data.name || '?'}): ${msg}`);
      // If the token is dead, forget it so we stop hammering a broken registration.
      if (/not-registered|unregistered|invalid-argument|sender-id-mismatch/i.test(msg)) {
        try {
          await doc.ref.update({ token: '', reminders });
          console.log(`  → cleared dead token for ${data.name || doc.id}`);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

console.log(`Done: ${sent} sent, ${skipped} skipped (too old), ${failed} failed.`);
process.exit(failed ? 1 : 0);
