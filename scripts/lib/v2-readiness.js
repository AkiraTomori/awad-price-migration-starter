// Health checks are a preflight, not proof of DB identity or absence of other writers.
export async function requireV2(targets) {
  if (targets.length !== 2 || new Set(targets.map((t) => new URL(t).origin)).size !== 2)
    throw new Error('exactly two distinct instance TARGETS are required');
  for (const target of targets) {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash)
      throw new Error('TARGETS must be HTTP(S) instance origins');
    const res = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(3000) });
    const health = await res.json();
    if (!res.ok || health.ok !== true || health.version !== 'v2')
      throw new Error(`${target} must report healthy version v2 before backfill/new clients`);
  }
}
