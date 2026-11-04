import { readFileSync } from 'node:fs';
import { requireMenuClients } from './v2-readiness.js';

export function parseShare(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('new-client share must be a number from 0 to 1');
  return value;
}

// Replace the small JSON-number file atomically. Invalid runtime updates retain
// the last accepted share and are logged; invalid startup configuration fails.
export async function createClientMix({ initial = 0, file, targets, log, intervalMs = 250 }) {
  const read = () => {
    const raw = readFileSync(file, 'utf8');
    if (raw.length > 64) throw new Error('client-mix file exceeds 64 characters');
    return parseShare(JSON.parse(raw));
  };
  let share = file ? read() : parseShare(initial);
  if (share > 0) await requireMenuClients(targets);
  let nextPoll = 0, pending, lastError;
  return {
    get share() { return share; },
    async reload() {
      if (!file) return;
      if (pending) return pending;
      if (Date.now() < nextPoll) return;
      nextPoll = Date.now() + intervalMs;
      pending = (async () => {
        try {
          const next = read();
          if (next !== share) {
            if (next > 0) await requireMenuClients(targets);
            log(`CLIENT_MIX ${share} -> ${next} file=${file}`);
            share = next;
          }
          lastError = undefined;
        } catch (e) {
          const message = `CLIENT_MIX rejected: ${e.message}; retaining ${share}`;
          if (message !== lastError) log(message);
          lastError = message;
        }
      })();
      try { await pending; } finally { pending = undefined; }
    },
  };
}
