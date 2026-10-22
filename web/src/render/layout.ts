// osu!'s playfield placement: the 512×384 field fills 80% of the largest 4:3 box that fits the
// screen, centred, then shifted down by 8 osu! pixels (matches stable and lazer's classic layout).

export interface PlayfieldLayout {
  scale: number;
  x: number;
  y: number;
}

export const PLAYFIELD_W = 512;
export const PLAYFIELD_H = 384;

export function playfieldLayout(width: number, height: number): PlayfieldLayout {
  const boxW = Math.min(width, (height * 4) / 3);
  const scale = (boxW * 0.8) / PLAYFIELD_W;
  return {
    scale,
    x: (width - PLAYFIELD_W * scale) / 2,
    y: (height - PLAYFIELD_H * scale) / 2 + 8 * scale,
  };
}
