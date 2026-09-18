import {
  extractPartEdges,
  transformEdge,
  edgeCompatibility,
  sharedSection,
  commonEdgeCandidates,
} from "./common-edge.js?v=0.12.0";
import { contactsAtPlacement } from "./common-contact.js?v=0.12.0";
import {
  contactComponents,
  moveRigidComponent,
} from "./cluster-docking.js?v=0.12.0";
import {
  validateLayout,
  transform,
  bounds,
  transformed,
} from "./geometry.js?v=0.12.0";
const clone = (x) => structuredClone(x);
export function rebuildContacts(parts, poses, settings) {
  const clean = poses.map(({ sharedEdges, ...t }) => t);
  if (!settings.commonEdgeMode) return clean;
  return clean.map((t) => ({
    ...t,
    sharedEdges: contactsAtPlacement(
      parts.find((p) => p.id === t.id),
      t,
      parts,
      clean,
    ),
  }));
}
export function translateSelection(poses, ids, dx, dy) {
  return poses.map((t) =>
    ids.includes(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t,
  );
}
export function rotateSelection(parts, poses, ids, angle) {
  if (!Number.isFinite(angle)) throw Error("Invalid angle / 角度無效");
  const box = bounds(
      poses
        .filter((t) => ids.includes(t.id))
        .flatMap((t) => transformed(parts.find((p) => p.id === t.id).outer, t)),
    ),
    cx = box.x + box.w / 2,
    cy = box.y + box.h / 2;
  return poses.map((t) => {
    if (!ids.includes(t.id)) return t;
    const p = transform({ x: t.x - cx, y: t.y - cy }, { x: cx, y: cy, angle });
    return { ...t, ...p, angle: (((t.angle + angle) % 360) + 360) % 360 };
  });
}
// Project onto the supporting line, retaining the pointer's tangential position.
// No endpoint snapping: a 40 mm edge can slide anywhere along a 100 mm edge.
export function magneticSnap(parts, poses, ids, settings, radius = 3) {
  const map = new Map(parts.map((p) => [p.id, p])),
    candidates = [];
  if (!settings.commonEdgeMode) return null;
  for (const moving of poses.filter((t) => ids.includes(t.id)))
    for (const fixed of poses.filter(
      (t) => !ids.includes(t.id) && t.sheet === moving.sheet,
    )) {
      for (const a of extractPartEdges(map.get(fixed.id)).map((e) =>
        transformEdge(e, fixed),
      ))
        for (const b of extractPartEdges(map.get(moving.id)).map((e) =>
          transformEdge(e, moving),
        )) {
          if (
            !edgeCompatibility(a, b, { angleTolerance: 1e-6, minOverlap: 0.01 })
              .compatible
          )
            continue;
          const n = a.outwardNormal,
            d = (b.start.x - a.start.x) * n.x + (b.start.y - a.start.y) * n.y;
          if (Math.abs(d) > radius) continue;
          const shifted = {
            ...b,
            start: { x: b.start.x - d * n.x, y: b.start.y - d * n.y },
            end: { x: b.end.x - d * n.x, y: b.end.y - d * n.y },
          };
          const section = sharedSection(a, shifted);
          if (!section) continue;
          const trial = rebuildContacts(
              parts,
              translateSelection(poses, ids, -d * n.x, -d * n.y),
              settings,
            ),
            errors = validateLayout(parts, trial, settings);
          candidates.push({
            placements: trial,
            section,
            sharedLength: section.length,
            errors,
            valid: !errors.length,
            distance: Math.abs(d),
            movingId: moving.id,
            fixedId: fixed.id,
          });
        }
    }
  candidates.sort(
    (a, b) =>
      Number(b.valid) - Number(a.valid) ||
      a.distance - b.distance ||
      b.sharedLength - a.sharedLength,
  );
  return candidates[0] || null;
}
export function rotationSuggestion(parts, poses, ids, settings, radius = 15) {
  if (!settings.commonEdgeMode) return null;
  const map = new Map(parts.map((p) => [p.id, p]));
  let best = null,
    events = 0;
  for (const moving of poses.filter((t) => ids.includes(t.id)))
    for (const fixed of poses.filter(
      (t) => !ids.includes(t.id) && t.sheet === moving.sheet,
    )) {
      for (const c of commonEdgeCandidates(
        map.get(moving.id),
        moving,
        map.get(fixed.id),
        fixed,
        {
          rotations: 360,
          diagonalCommonEdgesEnabled: true,
          shouldStop: () => events >= 300,
        },
      )) {
        events++;
        const delta = ((c.placement.angle - moving.angle + 540) % 360) - 180;
        if (Math.abs(delta) < 1e-6) continue;
        const moved = moveRigidComponent(
            poses.filter((t) => ids.includes(t.id)),
            moving,
            c.placement,
          ),
          updates = new Map(moved.map((t) => [t.id, t]));
        const trial = rebuildContacts(
          parts,
          poses.map((t) => updates.get(t.id) || t),
          settings,
        );
        const oldBox = bounds(transformed(map.get(moving.id).outer, moving)),
          newBox = bounds(transformed(map.get(moving.id).outer, c.placement));
        const distance = Math.hypot(
          oldBox.x + oldBox.w / 2 - newBox.x - newBox.w / 2,
          oldBox.y + oldBox.h / 2 - newBox.y - newBox.h / 2,
        );
        if (
          distance > radius ||
          (best && distance >= best.distance) ||
          validateLayout(parts, trial, settings).length
        )
          continue;
        best = {
          placements: trial,
          angle: delta,
          distance,
          sharedLength: c.sharedSection.length,
          section: c.sharedSection,
        };
      }
    }
  return best;
}
export class ManualLayout {
  constructor(parts, poses, settings) {
    this.parts = parts;
    this.settings = settings;
    this.auto = clone(poses);
    this.data = { placements: clone(poses), groups: [], locks: [] };
    this.past = [];
    this.future = [];
  }
  get placements() {
    return this.data.placements;
  }
  validationSettings() {
    return {
      ...this.settings,
      lockedPlacements: this.data.placements.filter((t) =>
        this.data.locks.includes(t.id),
      ),
    };
  }
  selection(id, cluster = false) {
    if (!cluster) return [id];
    const explicit = this.data.groups.find((g) => g.includes(id));
    return (
      explicit ||
      contactComponents(this.placements).find((g) => g.includes(id)) || [id]
    );
  }
  save(next) {
    this.past.push(clone(this.data));
    if (this.past.length > 100) this.past.shift();
    this.data = clone(next);
    this.future = [];
  }
  commit(poses) {
    const next = rebuildContacts(this.parts, poses, this.settings),
      errors = validateLayout(this.parts, next, this.validationSettings());
    if (errors.length) return { valid: false, errors };
    this.save({ ...this.data, placements: next });
    return { valid: true, errors: [] };
  }
  group(ids) {
    if (ids.length < 2) return;
    const sheets = new Set(
      this.placements.filter((t) => ids.includes(t.id)).map((t) => t.sheet),
    );
    if (sheets.size !== 1)
      throw Error("Select parts on one sheet / 請選同一塊板嘅零件");
    const joined = new Set(ids);
    for (const g of this.data.groups)
      if (g.some((id) => joined.has(id))) g.forEach((id) => joined.add(id));
    this.save({
      ...this.data,
      groups: [
        ...this.data.groups.filter((g) => !g.some((id) => joined.has(id))),
        [...joined],
      ],
    });
  }
  ungroup(ids) {
    this.save({
      ...this.data,
      groups: this.data.groups
        .map((g) => g.filter((id) => !ids.includes(id)))
        .filter((g) => g.length > 1),
    });
  }
  lock(ids, on) {
    this.save({
      ...this.data,
      locks: on
        ? [...new Set([...this.data.locks, ...ids])]
        : this.data.locks.filter((id) => !ids.includes(id)),
    });
  }
  reset(ids) {
    return this.commit(
      this.placements.map((t) =>
        ids.includes(t.id)
          ? clone(this.auto.find((a) => a.id === t.id) || t)
          : t,
      ),
    );
  }
  undo() {
    if (!this.past.length) return false;
    this.future.push(clone(this.data));
    this.data = this.past.pop();
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.past.push(clone(this.data));
    this.data = this.future.pop();
    return true;
  }
}
