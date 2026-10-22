import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { openOsz } from '../src/load/osz';
import { visualSkinFiles, decodeVisualSkin, visualSkinConfig } from '../src/render/skin-visuals';

const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);
const skin = (files: Record<string, Uint8Array>) => openOsz(zipSync(files));

describe('M7 .osk visual skin loading', () => {
  it('resolves supported root assets case-insensitively with @2x preference', () => {
    const archive = skin({
      'HitCircle.PNG': png(1), 'hitcircle@2x.png': png(2),
      'hitcircleoverlay.png': png(3), 'cursor.png': png(4),
      'nested/sliderb.png': png(5), 'arbitrary.png': png(6),
      'skin.ini': strToU8('[General]\nName: Custom'),
    });
    const files = visualSkinFiles(archive);
    expect([...files.hitcircle!]).toEqual([...png(2)]);
    expect([...files.hitcircleoverlay!]).toEqual([...png(3)]);
    expect([...files.cursor!]).toEqual([...png(4)]);
    expect(files.sliderb).toBeUndefined();
    expect(Object.keys(files)).toHaveLength(3);
  });
  it('isolates broken image decoding without losing valid assets', async () => {
    const archive = skin({ 'hitcircle.png': png(1), 'cursor.png': png(2) });
    const calls: number[] = [];
    const result = await decodeVisualSkin(archive, async bytes => {
      calls.push(bytes[4]);
      if (bytes[4] === 1) throw new Error('corrupt PNG');
      return { width: 32, height: 32 } as HTMLImageElement;
    });
    expect(calls).toEqual([1, 2]);
    expect(result.hitcircle).toBeUndefined();
    expect(result.cursor).toBeDefined();
  });
  it('parses known skin.ini options and ignores unsupported or malformed values', () => {
    const archive = skin({ 'skin.ini': strToU8(
      '[General]\nCursorRotate: false\nCursorExpand: 0\nCursorCentre: true\nSliderBallFlip: false\nSliderBallFrames: 12\n[Colours]\nCursorRotate: true'
    ) });
    expect(visualSkinConfig(archive)).toEqual({
      cursorRotate: false, cursorExpand: false, cursorCentre: true,
      sliderBallFlip: false, sliderBallFrames: 12,
    });
    const invalid = skin({ 'skin.ini': strToU8('[General]\nCursorRotate: banana\nSliderBallFrames: 99999') });
    expect(visualSkinConfig(invalid).cursorRotate).toBe(true);
    expect(visualSkinConfig(invalid).sliderBallFrames).toBe(1);
  });
  it('handles BOM, case-insensitive sections, comments, and a capped animation count', () => {
    const archive = skin({ 'SKIN.INI': strToU8(
      '\uFEFF[general]\\nCURSORCENTRE: false // top-left anchor\\nSLIDERBALLFRAMES: 128\\n; ignored\\nCursorRotate: 0'
    ) });
    expect(visualSkinConfig(archive)).toMatchObject({
      cursorCentre: false, sliderBallFrames: 128, cursorRotate: false,
    });
    const tooLarge = skin({ 'skin.ini': new Uint8Array(256 * 1024 + 1) });
    expect(visualSkinConfig(tooLarge).cursorCentre).toBe(true);
  });
  it('supports visual-only archives with no chart or audio files', () => {
    const archive = skin({ 'hitcircle.png': png(9) });
    expect(archive.difficulties).toHaveLength(0);
    expect(Object.keys(visualSkinFiles(archive))).toEqual(['hitcircle']);
  });
});
