/** WSOLA time stretching for pitch-preserving DT/HT playback.
 *
 * This is deliberately dependency-free. It is a compact overlap-add
 * implementation, not a mastering-grade stretcher; tests verify duration and
 * pitch rather than artifact-free studio quality.
 */

export interface TimeStretchOptions {
  /** Analysis frame size in samples; must be even. */
  frameSize?: number;
  /** Synthesis hop in output samples. */
  synthesisHop?: number;
  /** Maximum alignment search in input samples. */
  searchRadius?: number;
  /** Search stride; larger is faster and less precise. */
  searchStep?: number;
}

const DEFAULTS: Required<TimeStretchOptions> = {
  frameSize: 2048,
  synthesisHop: 1024,
  searchRadius: 256,
  searchStep: 4,
};

function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return window;
}

function monoMix(channels: Float32Array[], length: number): Float32Array {
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    mono[i] = sum / channels.length;
  }
  return mono;
}

/** Stretch all channels by `rate` (1.5 = 1.5× faster/shorter) with pitch intact. */
export function stretchChannels(
  channels: Float32Array[],
  rate: number,
  options: TimeStretchOptions = {},
): Float32Array[] {
  if (!channels.length) throw new RangeError('Time stretch needs at least one channel');
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new RangeError('Time stretch rate is out of range');
  const length = channels[0].length;
  if (length === 0) return channels.map(() => new Float32Array(0));
  if (channels.some((channel) => channel.length !== length)) throw new RangeError('Time stretch channels differ in length');
  if (Math.abs(rate - 1) < 1e-6) return channels.map((channel) => channel.slice());

  const { frameSize, synthesisHop, searchRadius, searchStep } = { ...DEFAULTS, ...options };
  if (!Number.isInteger(frameSize) || frameSize < 64 || frameSize % 2 !== 0) throw new RangeError('Invalid stretch frame size');
  if (!Number.isInteger(synthesisHop) || synthesisHop < 1 || synthesisHop >= frameSize) throw new RangeError('Invalid synthesis hop');
  if (!Number.isInteger(searchRadius) || searchRadius < 0) throw new RangeError('Invalid search radius');
  if (!Number.isInteger(searchStep) || searchStep < 1) throw new RangeError('Invalid search step');

  const overlap = frameSize - synthesisHop;
  const analysisHop = Math.max(1, Math.round(synthesisHop * rate));
  const outLength = Math.max(1, Math.ceil(length / rate));
  const paddedLength = outLength + frameSize;
  const outputs = channels.map(() => new Float32Array(paddedLength));
  const norm = new Float32Array(paddedLength);
  const window = hann(frameSize);
  const mono = monoMix(channels, length);

  const addFrame = (analysisStart: number, outputStart: number) => {
    for (let c = 0; c < channels.length; c++) {
      const source = channels[c];
      const target = outputs[c];
      for (let i = 0; i < frameSize; i++) {
        const sourceIndex = analysisStart + i;
        const targetIndex = outputStart + i;
        if (sourceIndex < 0 || sourceIndex >= length || targetIndex >= paddedLength) continue;
        target[targetIndex] += source[sourceIndex] * window[i];
      }
    }
    for (let i = 0; i < frameSize; i++) {
      const targetIndex = outputStart + i;
      if (targetIndex >= paddedLength) continue;
      norm[targetIndex] += window[i];
    }
  };

  let previousAnalysis = 0;
  let previousOutput = 0;
  addFrame(0, 0);
  while (previousOutput + synthesisHop < outLength) {
    const nominal = previousAnalysis + analysisHop;
    let best = nominal;
    let bestScore = Infinity;
    for (let delta = -searchRadius; delta <= searchRadius; delta += searchStep) {
      const candidate = nominal + delta;
      if (candidate < 0 || candidate + overlap > length) continue;
      let score = 0;
      for (let i = 0; i < overlap; i += 2) {
        const targetIndex = previousAnalysis + synthesisHop + i;
        if (targetIndex >= length) break;
        const diff = mono[candidate + i] - mono[targetIndex];
        score += diff * diff;
      }
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    const nextOutput = previousOutput + synthesisHop;
    addFrame(best, nextOutput);
    previousAnalysis = best;
    previousOutput = nextOutput;
  }

  return outputs.map((padded) => {
    const result = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) result[i] = padded[i] / Math.max(norm[i], 0.05);
    return result;
  });
}
