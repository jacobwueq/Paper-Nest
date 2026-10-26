import {
  extractPartEdges,
  transformEdge,
  edgeCompatibility,
  sharedSection,
  commonEdgeCandidates,
} from "./common-edge.js?v=0.27.2";
import { contactsAtPlacement } from "./common-contact.js?v=0.27.2";
import {
  contactComponents,
  moveRigidComponent,
} from "./cluster-docking.js?v=0.27.2";
import {
  validateLayout,
  transform,
  bounds,
  transformed,
} from "./geometry.js?v=0.27.2";
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
// Supporting-line projection preserves sliding. Nearby geometric events add
// tangential alignment without sampling or changing any collision exemptions.
export function magneticSnap(parts, poses, ids, settings, radius = 3) {
  return magneticSnapCandidates(parts, poses, ids, settings, radius)[0] || null;
}
export function magneticSnapCandidates(
  parts,
  poses,
  ids,
  settings,
  radius = 3,
  shouldStop = () => false,
) {
  const map = new Map(parts.map((p) => [p.id, p])),
    candidates = [];
  const selected = poses.filter((t) => ids.includes(t.id));
  if (!selected.length || new Set(selected.map((t) => t.sheet)).size !== 1)
    return [];
  const box = bounds(
    selected.flatMap((t) => transformed(map.get(t.id).outer, t)),
  );
  const limits = {
    x: [settings.margin, settings.width - settings.margin],
    y: [settings.margin, settings.height - settings.margin],
  };
  function add(dx, dy, info, priority) {
    if (shouldStop()) return;
    const trial = rebuildContacts(
      parts,
      translateSelection(poses, ids, dx, dy),
      settings,
    );
    const errors = validateLayout(parts, trial, settings);
    candidates.push({
      ...info,
      placements: trial,
      errors,
      valid: !errors.length,
      distance: Math.hypot(dx, dy),
      priority,
    });
  }
  const worldEdges = new Map(
    poses.map((t) => [
      t.id,
      extractPartEdges(map.get(t.id)).map((e) => transformEdge(e, t)),
    ]),
  );
  if (settings.commonEdgeMode)
    for (const moving of selected)
      for (const fixed of poses.filter(
        (t) => !ids.includes(t.id) && t.sheet === moving.sheet,
      ))
        for (const a of worldEdges.get(fixed.id))
          for (const b of worldEdges.get(moving.id)) {
            if (shouldStop())
              return candidates.sort(
                (a, b) =>
                  Number(b.valid) - Number(a.valid) ||
                  b.priority - a.priority ||
                  a.distance - b.distance,
              );
            if (
              !edgeCompatibility(a, b, {
                angleTolerance: 1e-6,
                minOverlap: 0.01,
              }).compatible
            )
              continue;
            const n = a.outwardNormal,
              d = (b.start.x - a.start.x) * n.x + (b.start.y - a.start.y) * n.y;
            if (Math.abs(d) > radius) continue;
            const dx = -d * n.x,
              dy = -d * n.y;
            const length = Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y);
            const u = {
              x: (a.end.x - a.start.x) / length,
              y: (a.end.y - a.start.y) / length,
            };
            const events = [{ t: 0, aligned: false }];
            for (const v of [a.start, a.end])
              for (const w of [b.start, b.end]) {
                const t = (v.x - w.x - dx) * u.x + (v.y - w.y - dy) * u.y;
                if (Math.abs(t) <= radius) events.push({ t, aligned: true });
              }
            // Sheet alignment along the tangent must not undo the common line.
            for (const axis of ["x", "y"])
              if (Math.abs(u[axis]) > 1e-8) {
                const offset = axis === "x" ? dx : dy,
                  extent = axis === "x" ? box.w : box.h;
                for (const [edge, target] of [
                  [box[axis], limits[axis][0]],
                  [box[axis] + extent, limits[axis][1]],
                ]) {
                  const t = (target - edge - offset) / u[axis];
                  if (Math.abs(t) <= radius) events.push({ t, aligned: true });
                }
              }
            const seen = new Set();
            for (const event of events.sort(
              (a, b) => Number(b.aligned) - Number(a.aligned),
            )) {
              const key = event.t.toFixed(7);
              if (seen.has(key)) continue;
              seen.add(key);
              const x = dx + event.t * u.x,
                y = dy + event.t * u.y;
              const shifted = {
                ...b,
                start: { x: b.start.x + x, y: b.start.y + y },
                end: { x: b.end.x + x, y: b.end.y + y },
              };
              const section = sharedSection(a, shifted);
              if (!section) continue;
              add(
                x,
                y,
                {
                  section,
                  sharedLength: section.length,
                  movingId: moving.id,
                  fixedId: fixed.id,
                  kind: event.aligned ? "aligned-edge" : "edge",
                },
                event.aligned ? 4 : 3,
              );
            }
          }
  // Sheet margin snapping is independent of common-edge mode and uses actual
  // transformed exterior bounds, including rotation and the entire selection.
  const xs = [0],
    ys = [0];
  for (const d of [limits.x[0] - box.x, limits.x[1] - box.x - box.w])
    if (Math.abs(d) <= radius) xs.push(d);
  for (const d of [limits.y[0] - box.y, limits.y[1] - box.y - box.h])
    if (Math.abs(d) <= radius) ys.push(d);
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < ys.length; j++) {
      if (!i && !j) continue;
      const x = box.x + xs[i],
        y = box.y + ys[j];
      const edgeX = Math.abs(x - limits.x[0]) < 1e-6 ? x : x + box.w;
      const edgeY = Math.abs(y - limits.y[0]) < 1e-6 ? y : y + box.h;
      const section = i
        ? { start: { x: edgeX, y }, end: { x: edgeX, y: y + box.h } }
        : { start: { x, y: edgeY }, end: { x: x + box.w, y: edgeY } };
      add(
        xs[i],
        ys[j],
        { kind: "sheet", section, sharedLength: 0 },
        i && j ? 2 : 1,
      );
    }
  candidates.sort(
    (a, b) =>
      Number(b.valid) - Number(a.valid) ||
      b.priority - a.priority ||
      a.distance - b.distance ||
      b.sharedLength - a.sharedLength,
  );
  return candidates;
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
