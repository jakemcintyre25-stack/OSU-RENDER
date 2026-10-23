import { describe, expect, it } from 'vitest';
import { createExportTimeline, EXPORT_PRESETS, exportFilename, exportPreset } from '../src/render/export/timeline';

describe('deterministic export timeline', () => {
  it('converts map milliseconds into exact frame timestamps at normal rate', () => {
    const timeline = createExportTimeline({ startMs: 0, endMs: 180_000, rate: 1, fps: 30 });
    expect(timeline.frameCount).toBe(5400);
    expect(timeline.videoDurationSeconds).toBe(180);
    expect(timeline.mapTimeAtFrame(0)).toBe(0);
    expect(timeline.mapTimeAtFrame(30)).toBe(1000);
    expect(timeline.outputTimeAtFrame(30)).toBe(1);
    expect(timeline.mapTimeAtFrame(5399)).toBeCloseTo(179_966.6666667, 6);
  });

  it('does not add an extra frame when the duration is exactly on a frame boundary', () => {
    expect(createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 30 }).frameCount).toBe(30);
    expect(createExportTimeline({ startMs: 0, endMs: 2000, rate: 1, fps: 60 }).frameCount).toBe(120);
    expect(createExportTimeline({ startMs: 0, endMs: 1, rate: 1, fps: 30 }).frameCount).toBe(1);
  });

  it('applies DT/HT rate to map time but not to output frame timestamps', () => {
    const dt = createExportTimeline({ startMs: 0, endMs: 180_000, rate: 1.5, fps: 60 });
    expect(dt.sourceDurationSeconds).toBe(120);
    expect(dt.frameCount).toBe(7200);
    expect(dt.mapTimeAtFrame(60)).toBe(1500);
    expect(dt.outputTimeAtFrame(60)).toBe(1);
    const ht = createExportTimeline({ startMs: 0, endMs: 180_000, rate: 0.75, fps: 30 });
    expect(ht.frameCount).toBe(7200);
    expect(ht.mapTimeAtFrame(30)).toBe(750);
  });

  it('includes negative AudioLeadIn/preroll map time in the exported video', () => {
    const timeline = createExportTimeline({ startMs: -1500, endMs: 60_000, rate: 1, fps: 30 });
    expect(timeline.sourceDurationSeconds).toBe(61.5);
    expect(timeline.frameCount).toBe(1845);
    expect(timeline.mapTimeAtFrame(0)).toBe(-1500);
    expect(timeline.mapTimeAtFrame(45)).toBe(0);
  });

  it('rounds fractional frame coverage up so the final map time is included', () => {
    const timeline = createExportTimeline({ startMs: 0, endMs: 1001, rate: 1, fps: 30 });
    expect(timeline.frameCount).toBe(31);
    expect(timeline.videoDurationSeconds).toBeCloseTo(1.0333333, 6);
    expect(timeline.mapTimeAtFrame(30)).toBeCloseTo(1000, 6);
  });

  it('rejects invalid timelines and frame indexes', () => {
    expect(() => createExportTimeline({ startMs: 0, endMs: 0, rate: 1, fps: 30 })).toThrow(RangeError);
    expect(() => createExportTimeline({ startMs: 10, endMs: 5, rate: 1, fps: 30 })).toThrow(RangeError);
    expect(() => createExportTimeline({ startMs: 0, endMs: 1000, rate: 0, fps: 30 })).toThrow(RangeError);
    expect(() => createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 0 })).toThrow(RangeError);
    expect(() => createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 29.5 })).toThrow(RangeError);
    expect(() => createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 121 })).toThrow(RangeError);
    expect(() => createExportTimeline({ startMs: NaN, endMs: 1000, rate: 1, fps: 30 })).toThrow(RangeError);
    const timeline = createExportTimeline({ startMs: 0, endMs: 1000, rate: 1, fps: 30 });
    expect(() => timeline.mapTimeAtFrame(-1)).toThrow(RangeError);
    expect(() => timeline.mapTimeAtFrame(30)).toThrow(RangeError);
    expect(() => timeline.outputTimeAtFrame(1.5)).toThrow(RangeError);
  });

  it('exposes render presets and safe, resolution-specific filenames', () => {
    expect(EXPORT_PRESETS.map((p) => p.id)).toEqual(['720p30', '720p60', '1080p30', '1080p60']);
    expect(exportPreset('1080p60')).toMatchObject({ width: 1920, height: 1080, fps: 60 });
    expect(() => exportPreset('8k')).toThrow(RangeError);
    expect(exportFilename('../A:<B>?', exportPreset('720p30'), 'mp4')).toBe('osu-replay-A-B-720p30.mp4');
    expect(exportFilename('***', exportPreset('1080p60'), 'webm')).toBe('osu-replay-player-1080p60.webm');
  });
});
