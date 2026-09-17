// Synchronous, per-job scope. Caches never survive a worker job or retain drawings.
let active = null;
export function count(name, amount = 1) {
  if (active?.measure)
    active.counts[name] = (active.counts[name] || 0) + amount;
}
export function measured(name, fn) {
  if (!active?.measure) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    active.ms[name] = (active.ms[name] || 0) + performance.now() - start;
  }
}
export function cached(name, key, fn) {
  count(name + "Calls");
  if (!active?.optimise) {
    count(name + "Computations");
    return measured(name, fn);
  }
  let map = active.caches.get(name);
  if (!map) active.caches.set(name, (map = new Map()));
  if (map.has(key)) {
    count(name + "CacheHits");
    return map.get(key);
  }
  count(name + "Computations");
  const result = measured(name, fn);
  // Bound memory without changing geometry or pruning candidate sources.
  if (map.size >= 5000) map.delete(map.keys().next().value);
  map.set(key, result);
  return result;
}
export function objectKey(object) {
  if (!active) return "";
  if (!active.ids.has(object)) active.ids.set(object, ++active.nextId);
  return active.ids.get(object);
}
export const poseKey = (t) =>
  JSON.stringify([
    t.id,
    t.x,
    t.y,
    t.angle,
    t.scale ?? 1,
    !!t.mirrored,
    t.sheet,
    t.sharedEdges || [],
  ]);
export function profiled(options, fn) {
  if (active) return fn();
  active = {
    measure: !!options.profile,
    optimise: options.optimise !== false,
    counts: {},
    ms: {},
    caches: new Map(),
    ids: new WeakMap(),
    nextId: 0,
  };
  const start = performance.now();
  try {
    const result = fn();
    if (options.profile)
      result.profile = {
        runtimeMs: performance.now() - start,
        counts: { ...active.counts },
        inclusiveMs: { ...active.ms },
      };
    return result;
  } finally {
    active = null;
  }
}
