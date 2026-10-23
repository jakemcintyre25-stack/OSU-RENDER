/** Procedural default-skin follow points between consecutive hit objects. */
export interface Vec2 { x: number; y: number }

export function followPointPositions(from: Vec2, to: Vec2, spacing = 32): Vec2[] {
  if (![from.x, from.y, to.x, to.y, spacing].every(Number.isFinite) || spacing <= 0) return [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < spacing * 1.5) return [];
  const count = Math.floor(distance / spacing);
  const points: Vec2[] = [];
  for (let i = 1; i < count; i++) {
    const p = i / count;
    points.push({ x: from.x + dx * p, y: from.y + dy * p });
  }
  return points;
}
