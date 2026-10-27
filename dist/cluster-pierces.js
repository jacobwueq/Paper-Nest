import { lineOperationKey } from "./common-line.js?v=0.28.2";
// Connected source contours provide a lower bound, not a machine pierce schedule.
// Shared outer contours join; separate holes/engraving operations stay separate.
export function clusterPierceLowerBound(parts, placements) {
  const parent = new Map(),
    operations = new Map();
  const root = (k) =>
    parent.get(k) === k
      ? k
      : (parent.set(k, root(parent.get(k))), parent.get(k));
  const join = (a, b) => {
    if (
      parent.has(a) &&
      parent.has(b) &&
      operations.get(a) === operations.get(b)
    )
      parent.set(root(a), root(b));
  };
  for (const p of parts) {
    const entities = p.entities?.length ? p.entities : [{}],
      points = new Map();
    entities.forEach((e, i) => {
      const id = JSON.stringify([p.id, i]);
      parent.set(id, id);
      operations.set(id, lineOperationKey(e));
      for (const v of e.vertices || []) {
        const k = JSON.stringify([v.x, v.y, lineOperationKey(e)]);
        if (points.has(k)) join(id, points.get(k));
        else points.set(k, id);
      }
    });
  }
  for (const t of placements)
    for (const d of t.sharedEdges || [])
      join(
        JSON.stringify([t.id, d.ownEdge.entityIndex ?? 0]),
        JSON.stringify([d.otherPartId, d.otherEdge.entityIndex ?? 0]),
      );
  return new Set([...parent.keys()].map(root)).size;
}
