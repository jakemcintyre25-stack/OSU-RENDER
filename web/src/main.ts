import './style.css';
import { getRecent, getReplayFile, getBeatmapset, getOsuFile, lookupBeatmap, type RecentPlay } from './api';
import { openOsz, type OszArchive } from './load/osz';
import { assertLocalUploadSize } from './load/upload-limits';
import { createIndexedDbSkinStore } from './load/skin-store';
import { decodeReplay } from './load/replay';
import { sessionFromReplay, sessionFromAutoplay, type Session } from './session';
import { PlayfieldRenderer } from './render/renderer';
import { decodeVisualSkin, visualSkinFiles, visualSkinConfig, type VisualSkinConfig, type VisualSkinKey } from './render/skin-visuals';
import { Clock } from './audio/clock';
import { supportedSkinAudioFiles } from './audio/skin-assets';
import { parseLaunchTarget, scoreShareUrl, userShareUrl } from './launch';
import { playbackEndTime } from './audio/timeline';
import { initialPlaybackTime } from './audio/lead-in';
import { PlaybackRequestGate, type PlaybackLease } from './playback-gate';
import { checkedPlayerSpeed, effectivePlaybackRate } from './audio/speed';
import { markerReviewTime } from './render/marker-review';
import { hitErrorSamples, hitErrorSummary } from './render/hit-error';
import { recentScorePlayability } from './playability';
import { storedToggle } from './render/preferences';
import { ReplayVideoCapture, safeCaptureFilename } from './render/video-capture';
import { hpAt } from './game/hp-engine';
import { healthBarPercent, hpHasFailed, isLowHealth } from './render/hp-bar';
import { createExportTimeline, exportFilename, exportPreset, type ExportPreset } from './render/export/timeline';
import { describeCodecChoice, type ExportCodecChoice } from './render/export/codecs';
import { renderOfflineMix } from './audio/offline-mix';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

// ------------------------------------------------------------------ feedback helpers

let toastTimer = 0;
function toast(message: string, ok = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('ok', ok);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 7000);
}

function loading(text: string | null, progress?: number) {
  $('loading').hidden = text === null;
  if (text !== null) $('loading-text').textContent = text;
  $('loading-bar').style.width = progress === undefined || progress < 0 ? '0%' : `${Math.round(progress * 100)}%`;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ recent plays

function playItem(p: RecentPlay): HTMLLIElement {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'play';
  btn.type = 'button';
  const img = p.coverUrl ? Object.assign(document.createElement('img'), { src: p.coverUrl, alt: '', loading: 'lazy' }) : Object.assign(document.createElement('div'), { className: 'noimg' });
  const mid = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `${p.artist} - ${p.title}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const when = p.endedAt ? new Date(p.endedAt).toLocaleString() : '';
  meta.textContent = `[${p.version}]${p.mods.length ? ' +' + p.mods.join('') : ''} · ${(p.accuracy * 100).toFixed(2)}% · ${p.maxCombo}x · ${when}`;
  mid.append(title, meta);
  const side = document.createElement('div');
  side.className = 'side';
  const rank = document.createElement('div');
  rank.className = `rank rank-${p.passed ? p.rank : 'F'}`;
  rank.textContent = p.passed ? p.rank.replace('X', 'SS').replace('H', '') : 'F';
  side.append(rank);
  if (p.pp) side.append(Object.assign(document.createElement('div'), { textContent: `${Math.round(p.pp)}pp` }));
  if (!p.hasReplay) side.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'no replay' }));
  else if (p.isLazer) side.append(Object.assign(document.createElement('span'), { className: 'tag warn', textContent: 'lazer' }));
  btn.append(img, mid, side);
  const playability = recentScorePlayability(p);
  btn.disabled = !playability.playable;
  btn.title = playability.reason ?? 'Watch this replay';
  btn.addEventListener('click', () => void openPlay(p));
  li.append(btn);
  return li;
}

let recentRequestId = 0;
async function showRecent(name: string, updateUrl = false) {
  const requestId = ++recentRequestId;
  const status = $('user-status');
  const list = $('plays');
  status.textContent = 'Loading…';
  list.replaceChildren();
  try {
    const { user, plays } = await getRecent(name);
    if (requestId !== recentRequestId) return;
    ($('username') as HTMLInputElement).value = user.username;
    store.set('username', user.username);
    status.textContent = plays.length
      ? `${user.username}'s last ${plays.length} plays (last 24 hours, including fails)`
      : `${user.username} has no osu!standard plays in the last 24 hours.`;
    list.replaceChildren(...plays.map(playItem));
    if (updateUrl) history.replaceState(null, '', userShareUrl(location.href, user.id));
  } catch (err) {
    if (requestId === recentRequestId) status.textContent = (err as Error).message;
  }
}

$('user-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = ($('username') as HTMLInputElement).value.trim();
  if (name) void showRecent(name, true);
});

const videoCapture = new ReplayVideoCapture();
let captureAutoStop: ReturnType<typeof setTimeout> | null = null;
let currentSkinVisuals: Partial<Record<VisualSkinKey, ImageBitmap | HTMLImageElement>> = {};
let currentSkinConfig: VisualSkinConfig | undefined;
let exporting = false;
let exportAbort: AbortController | null = null;
let selectedCodecs: ExportCodecChoice | null = null;
let exportModule: Promise<typeof import('./render/export/export-video')> | null = null;
function captureButton() {
  const button = $('capture-video') as HTMLButtonElement;
  button.disabled = !session || !renderer || exporting;
  button.textContent = videoCapture.active ? 'Stop recording' : 'Record WebM';
  const exportButton = $('export-video') as HTMLButtonElement;
  exportButton.disabled = !session || !renderer || videoCapture.active || exporting;
}

async function toggleCapture() {
  if (videoCapture.active) {
    if (captureAutoStop) clearTimeout(captureAutoStop);
    captureAutoStop = null;
    try {
      const { blob, mime, audio } = await videoCapture.stop();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeCaptureFilename(session?.player ?? 'player', mime);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast(audio
        ? 'Real-time WebM saved with synchronized audio. Use Export video for a deterministic MP4.'
        : 'Video-only WebM saved; this browser could not record audio.', true);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      captureButton();
    }
    return;
  }
  if (!renderer || !session) return;
  let audio: ReturnType<Clock['createCaptureAudio']> | null = null;
  try {
    try {
      audio = clock?.createCaptureAudio() ?? null;
    } catch {
      // A browser without MediaStreamAudioDestinationNode can still record video.
      audio = null;
    }
    const withAudio = videoCapture.start(renderer.app.canvas, 30, { audio });
    // Save before the encoder's hard 60-second safety stop.
    captureAutoStop = setTimeout(() => { if (videoCapture.active) void toggleCapture(); }, 59_000);
    captureButton();
    toast(withAudio
      ? 'Recording WebM with synchronized audio, maximum 60 seconds. Press Stop recording to save.'
      : 'Recording video only, maximum 60 seconds. Press Stop recording to save.');
  } catch (error) {
    audio?.dispose();
    toast((error as Error).message);
  }
}

// ------------------------------------------------------------------ deterministic export

const exportDialog = $('export-dialog') as HTMLDialogElement;
const exportResolution = $('export-resolution') as HTMLSelectElement;
const exportFps = $('export-fps') as HTMLSelectElement;
const exportProgress = $('export-progress') as HTMLProgressElement;
const exportCapability = $('export-capability') as HTMLElement;
const exportEstimate = $('export-estimate') as HTMLElement;
const exportStatus = $('export-status') as HTMLElement;
const exportStart = $('export-start') as HTMLButtonElement;
const exportCancel = $('export-cancel') as HTMLButtonElement;
const exportClose = $('export-close') as HTMLButtonElement;
let capabilityRequest = 0;

function chosenExportPreset(): ExportPreset {
  const size = exportResolution.value === '1080p' ? '1080p' : '720p';
  return exportPreset(`${size}${exportFps.value === '60' ? 60 : 30}`);
}

function loadExportModule() {
  exportModule ??= import('./render/export/export-video');
  return exportModule;
}

function exportTimelineFor(preset: ExportPreset) {
  if (!session || !clock) throw new Error('Open a replay before exporting');
  return createExportTimeline({
    startMs: initialPlaybackTime(session.map.firstObjectTime, session.map.audioLeadIn),
    endMs: playbackEndTime(session.map.lastObjectTime, clock.duration),
    rate: session.map.rate,
    fps: preset.fps,
  });
}

function updateExportEstimate() {
  const preset = chosenExportPreset();
  try {
    const timeline = exportTimelineFor(preset);
    exportEstimate.textContent = `${preset.width}×${preset.height} · ${timeline.frameCount.toLocaleString()} frames · ${fmt(timeline.videoDurationSeconds * 1000)}`;
  } catch {
    exportEstimate.textContent = '';
  }
}

async function refreshExportCapability() {
  const request = ++capabilityRequest;
  selectedCodecs = null;
  exportStart.disabled = true;
  exportCapability.textContent = 'Checking encoder support…';
  updateExportEstimate();
  const preset = chosenExportPreset();
  try {
    const module = await loadExportModule();
    const codecs = await module.detectExportCodecs(preset.width, preset.height);
    if (request !== capabilityRequest) return;
    selectedCodecs = codecs;
    if (!codecs) {
      exportCapability.textContent = 'This browser cannot encode MP4 or WebM with WebCodecs. Use Record WebM for real-time capture instead.';
      return;
    }
    exportCapability.textContent = `Will encode ${describeCodecChoice(codecs)}${codecs.audio ? '' : ' (no supported audio encoder; video only)'}.`;
    exportStart.disabled = exporting;
  } catch (error) {
    if (request !== capabilityRequest) return;
    exportCapability.textContent = `Encoder check failed: ${(error as Error).message}`;
  }
}

function setExportBusy(busy: boolean) {
  exporting = busy;
  exportResolution.disabled = busy;
  exportFps.disabled = busy;
  exportStart.disabled = busy || !selectedCodecs;
  exportCancel.disabled = !busy;
  exportClose.disabled = busy;
  ($('playpause') as HTMLButtonElement).disabled = busy;
  ($('seek') as HTMLInputElement).disabled = busy;
  captureButton();
}

function openExportDialog() {
  if (!session || !renderer || exporting) return;
  exportProgress.value = 0;
  exportStatus.textContent = '';
  if (!exportDialog.open) {
    if (typeof exportDialog.showModal === 'function') exportDialog.showModal();
    else exportDialog.setAttribute('open', '');
  }
  void refreshExportCapability();
}

function downloadExport(
  buffer: ArrayBuffer, mime: string, extension: 'mp4' | 'webm',
  preset: ExportPreset, player: string,
): string {
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename(player, preset, extension);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return link.download;
}

async function startExport() {
  if (exporting || !session || !clock || !renderer || !selectedCodecs) return;
  const s = session;
  const previewRenderer = renderer;
  const preset = chosenExportPreset();
  const codecs = selectedCodecs;
  const controller = new AbortController();
  exportAbort = controller;
  const wasPlaying = clock.isPlaying;
  if (wasPlaying) clock.pause();
  setExportBusy(true);
  exportProgress.value = 0;
  exportStatus.textContent = 'Mixing music and hitsounds…';
  let host: HTMLDivElement | null = null;
  let exportRenderer: PlayfieldRenderer | null = null;
  try {
    const timeline = exportTimelineFor(preset);
    let audio: AudioBuffer | null = null;
    try {
      audio = await renderOfflineMix({
        audio: s.audio,
        hitsounds: s.hitsounds,
        startMs: timeline.startMs,
        rate: timeline.rate,
        durationSeconds: timeline.videoDurationSeconds,
        musicVolume: Number(($('volume') as HTMLInputElement).value) / 100,
        effectsVolume: Number(($('effects-volume') as HTMLInputElement).value) / 100,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      // A corrupt soundtrack must not block a useful video export.
      audio = null;
    }
    exportStatus.textContent = 'Preparing the export renderer…';
    host = document.createElement('div');
    host.className = 'export-stage';
    host.style.width = `${preset.width}px`;
    host.style.height = `${preset.height}px`;
    document.body.append(host);
    exportRenderer = new PlayfieldRenderer();
    await exportRenderer.init(host, { resolution: 1 });
    if (exportRenderer.app.canvas.width !== preset.width || exportRenderer.app.canvas.height !== preset.height) {
      exportRenderer.resize(preset.width, preset.height);
    }
    exportRenderer.options = { ...previewRenderer.options };
    exportRenderer.setSkinVisuals(currentSkinVisuals, currentSkinConfig);
    exportRenderer.setBackground(s.background);
    exportRenderer.load(s.map, s.frames, s.judgement, { player: s.player });
    const module = await loadExportModule();
    let lastUpdate = 0;
    const result = await module.exportReplayVideo({
      renderer: exportRenderer,
      timeline,
      preset,
      codecs,
      audio,
      signal: controller.signal,
      onProgress: (done, total) => {
        const now = performance.now();
        if (done !== total && now - lastUpdate < 100) return;
        lastUpdate = now;
        exportProgress.value = done / total;
        exportStatus.textContent = `Encoding frame ${done.toLocaleString()} / ${total.toLocaleString()}…`;
      },
    });
    const filename = downloadExport(result.buffer, result.mime, result.extension, preset, s.player);
    exportStatus.textContent = `Saved ${filename} · ${(result.bytes / 1_000_000).toFixed(1)} MB · ${result.description}`;
    toast(`Exported ${filename}.`, true);
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    exportStatus.textContent = aborted ? 'Export cancelled.' : `Export failed: ${(error as Error).message}`;
    if (!aborted) toast((error as Error).message);
  } finally {
    try {
      exportRenderer?.destroy();
    } catch {
      /* renderer init may have failed before its stage existed */
    }
    host?.remove();
    exportAbort = null;
    setExportBusy(false);
    // Pixi textures are cached by source image. If destroying the export app
    // invalidated shared entries, rebuild the preview from the same session.
    if (renderer === previewRenderer && session === s) {
      previewRenderer.setSkinVisuals(currentSkinVisuals, currentSkinConfig);
      previewRenderer.setBackground(s.background);
      previewRenderer.load(s.map, s.frames, s.judgement, { player: s.player });
    }
    if (wasPlaying && clock) void clock.play();
  }
}

$('export-video').addEventListener('click', openExportDialog);
exportStart.addEventListener('click', () => void startExport());
exportCancel.addEventListener('click', () => {
  exportAbort?.abort();
  exportStatus.textContent = 'Cancelling…';
});
exportClose.addEventListener('click', () => {
  if (!exporting) exportDialog.close();
});
exportResolution.addEventListener('change', () => void refreshExportCapability());
exportFps.addEventListener('change', () => void refreshExportCapability());
exportDialog.addEventListener('cancel', (event) => {
  if (!exporting) return;
  event.preventDefault();
  exportAbort?.abort();
});

const playbackGate = new PlaybackRequestGate();

async function openPlay(p: RecentPlay) {
  const playability = recentScorePlayability(p);
  if (!playability.playable) {
    toast(playability.reason ?? 'This replay cannot be played');
    return;
  }
  const lease = playbackGate.begin();
  try {
    loading('Downloading replay…');
    const replayBytes = await getReplayFile(p.scoreId, lease.signal);
    if (!lease.isCurrent()) return;
    const { osz, osuFallback } = await downloadMap(p.beatmapsetId, p.beatmapId, lease);
    if (!lease.isCurrent()) return;
    loading('Preparing…');
    await skinReady;
    const s = await sessionFromReplay(replayBytes, osz, osuFallback, p.beatmapId, localSkin);
    if (!lease.isCurrent()) return;
    await startPlayer(s, p.scoreId, lease);
    if (lease.isCurrent()) history.replaceState(null, '', scoreShareUrl(location.href, p.scoreId));
  } catch (err) {
    if (lease.isCurrent()) {
      loading(null);
      toast((err as Error).message);
    }
  }
}

async function downloadMap(setId: number, beatmapId: number, lease: PlaybackLease): Promise<{ osz: OszArchive | null; osuFallback: string | null }> {
  if (lease.isCurrent()) loading('Downloading beatmap…', 0);
  try {
    const bytes = await getBeatmapset(setId, (p) => {
      if (lease.isCurrent()) loading('Downloading beatmap…', p);
    }, lease.signal);
    if (!lease.isCurrent()) throw new DOMException('Superseded replay download', 'AbortError');
    loading('Unpacking beatmap…');
    return { osz: openOsz(bytes), osuFallback: null };
  } catch (err) {
    // An intentional cancellation must NEVER start an unrelated fallback download.
    if (!lease.isCurrent()) throw err;
    console.warn('beatmapset download failed, falling back to .osu only', err);
    loading('Mirrors unavailable — getting the map without audio…');
    return { osz: null, osuFallback: await getOsuFile(beatmapId, lease.signal) };
  }
}

// ------------------------------------------------------------------ file inputs

function wireDrop(dropId: string, inputId: string, onFile: (f: File) => void) {
  const drop = $(dropId);
  const input = $(inputId) as HTMLInputElement;
  input.addEventListener('change', () => input.files?.[0] && onFile(input.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
}

wireDrop('osr-drop', 'osr-input', async (file) => {
  const lease = playbackGate.begin();
  try {
    loading('Reading replay…');
    assertLocalUploadSize('osr', file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!lease.isCurrent()) return;
    const replay = await decodeReplay(bytes);
    if (!lease.isCurrent()) return;
    if (!replay.beatmapMD5) throw new Error('This replay has no beatmap reference');
    loading('Finding the beatmap…');
    const md5 = replay.beatmapMD5.toLowerCase();
    const local = localOsz?.difficulties.find((d) => d.md5.toLowerCase() === md5);
    if (localOsz && local) {
      loading('Preparing…');
      await skinReady;
      const session = await sessionFromReplay(bytes, localOsz, null, local.beatmapId ?? 0, localSkin);
      if (lease.isCurrent()) await startPlayer(session, null, lease);
      return;
    }
    let found: { beatmapId: number; beatmapsetId: number };
    try {
      found = await lookupBeatmap(replay.beatmapMD5, lease.signal);
    } catch (error) {
      if (!lease.isCurrent()) return;
      throw new Error('Map not found. Drop the matching .osz file first (or set up osu! API keys for automatic lookup).', { cause: error });
    }
    if (!lease.isCurrent()) return;
    const { osz, osuFallback } = await downloadMap(found.beatmapsetId, found.beatmapId, lease);
    if (!lease.isCurrent()) return;
    loading('Preparing…');
    await skinReady;
    const session = await sessionFromReplay(bytes, osz, osuFallback, found.beatmapId, localSkin);
    if (lease.isCurrent()) await startPlayer(session, null, lease);
  } catch (err) {
    if (lease.isCurrent()) {
      loading(null);
      toast((err as Error).message);
    }
  }
});

let localSkin: OszArchive | null = null;
let localOsz: OszArchive | null = null;
const skinStore = createIndexedDbSkinStore();
const MOD_CHOICES = ['EZ', 'HR', 'HD', 'DT', 'NC', 'HT', 'FL'];

function showSkinStatus(name: string, archive: OszArchive, saved: boolean) {
  const usable = supportedSkinAudioFiles(archive);
  // Visual-only .osk archives are valid: their sprites are used by the renderer.
  const visualCount = Object.keys(visualSkinFiles(archive)).length;
  if (!usable.length && !visualCount) throw new Error('This skin contains no supported audio or visual files.');
  $('osk-status').textContent = `${name}: ${usable.length} hitsound files and ${visualCount} visual sprites.${saved ? ' Saved for this browser.' : ' This session only.'}`;
  $('osk-drop').querySelector('span')!.textContent = name;
  ($('osk-clear') as HTMLButtonElement).hidden = false;
}

wireDrop('osk-drop', 'osk-input', async (file) => {
  try {
    loading('Checking skin archive…');
    assertLocalUploadSize('osk', file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const archive = openOsz(bytes);
    showSkinStatus(file.name, archive, false);
    localSkin = archive;
    const saved = await skinStore.save({ name: file.name, bytes: bytes.slice().buffer as ArrayBuffer, savedAt: Date.now() });
    if (saved) showSkinStatus(file.name, archive, true);
    loading(null);
    toast(saved ? 'Skin loaded and saved for this browser.' : 'Skin loaded for this session only.', true);
  } catch (error) {
    loading(null);
    toast((error as Error).message);
  }
});

$('osk-clear').addEventListener('click', async () => {
  localSkin = null;
  await skinStore.clear();
  $('osk-status').textContent = 'Uses your own skin audio for sounds missing from the beatmap. Supported visual skin sprites also apply to the next replay you open.';
  $('osk-drop').querySelector('span')!.textContent = 'Drop a .osk skin archive or click to choose';
  ($('osk-clear') as HTMLButtonElement).hidden = true;
});

async function restoreSavedSkin() {
  try {
    const stored = await skinStore.load();
    if (!stored || localSkin) return;
    const archive = openOsz(new Uint8Array(stored.bytes));
    localSkin = archive;
    showSkinStatus(stored.name, archive, true);
  } catch {
    await skinStore.clear();
  }
}

wireDrop('osz-drop', 'osz-input', async (file) => {
  try {
    loading('Unpacking beatmap…');
    assertLocalUploadSize('osz', file.size);
    localOsz = openOsz(new Uint8Array(await file.arrayBuffer()));
    loading(null);
    const std = localOsz.difficulties.filter((d) => d.mode === 0);
    if (!std.length) throw new Error('This beatmap has no osu!standard difficulties');
    const sel = $('osz-diff') as HTMLSelectElement;
    sel.replaceChildren(...std.map((d, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: d.version })));
    $('osz-mods').replaceChildren(
      ...MOD_CHOICES.map((m) => {
        const l = document.createElement('label');
        const c = Object.assign(document.createElement('input'), { type: 'checkbox', value: m });
        l.append(c, m);
        return l;
      }),
    );
    $('osz-options').hidden = false;
    $('osz-drop').querySelector('span')!.textContent = file.name;
  } catch (err) {
    loading(null);
    toast((err as Error).message);
  }
});

$('osz-play').addEventListener('click', async () => {
  if (!localOsz) return;
  const lease = playbackGate.begin();
  try {
    const std = localOsz.difficulties.filter((d) => d.mode === 0);
    const diff = std[Number(($('osz-diff') as HTMLSelectElement).value)];
    const mods = [...$('osz-mods').querySelectorAll<HTMLInputElement>('input:checked')].map((c) => c.value);
    loading('Preparing…');
    const result = await sessionFromAutoplay(localOsz, diff, mods, localSkin);
    if (lease.isCurrent()) await startPlayer(result, null, lease);
  } catch (err) {
    if (lease.isCurrent()) {
      loading(null);
      toast((err as Error).message);
    }
  }
});

// ------------------------------------------------------------------ player

let renderer: PlayfieldRenderer | null = null;
let clock: Clock | null = null;
let session: Session | null = null;
let raf = 0;
let seeking = false;
let hpFailed = false;
let activeScoreId: number | null = null;

let rendererInit: Promise<void> | null = null;

async function startPlayer(s: Session, scoreId: number | null = null, lease = playbackGate.begin()) {
  if (!lease.isCurrent()) return;
  stopPlayer();
  activeScoreId = scoreId;
  ($('share-score') as HTMLButtonElement).disabled = scoreId === null;
  session = s;
  hpFailed = false;
  $('hpbar').hidden = false;
  $('fail').hidden = true;
  $('home').hidden = true;
  $('player').hidden = false;
  loading('Decoding audio…');
  const playerClock = new Clock();
  clock = playerClock;
  const active = () => lease.isCurrent() && clock === playerClock;
  try {
    try {
      await playerClock.load(s.audio);
    } catch {
      if (!active()) return;
      s.warnings.push('The audio could not be decoded by this browser.');
      await playerClock.load(null);
    }
    if (!active()) return;
    loading('Decoding beatmap hitsounds…');
    const samples = await playerClock.loadHitsounds(s.hitsounds);
    if (!active()) return;
    if (samples.failed > 0) s.warnings.push(`${samples.failed} beatmap hitsound files could not be decoded by this browser.`);
    if (s.hitsounds.unavailable > 0) s.warnings.push('Some hitsounds are unavailable from this beatmap and your selected skin; bundled defaults are not included.');
    playerClock.rate = effectivePlaybackRate(s.map.rate, Number(($('playback-speed') as HTMLSelectElement).value));
    loading('Preparing pitch-preserving audio…');
    const stretched = await playerClock.prepareRate(playerClock.rate);
    if (!active()) return;
    if (!stretched && Math.abs(playerClock.rate - 1) > 1e-6) {
      s.warnings.push('Pitch-preserving speed change is unavailable; audio pitch will follow playback speed.');
    }
    playerClock.volume = Number(($('volume') as HTMLInputElement).value) / 100;
    playerClock.effectsVolume = Number(($('effects-volume') as HTMLInputElement).value) / 100;
    playerClock.offset = Number(($('sync-offset') as HTMLInputElement).value);
    playerClock.onEnded = () => { if (active()) updatePlayButton(); };
    if (!renderer) {
      const newRenderer = new PlayfieldRenderer();
      renderer = newRenderer;
      rendererInit = newRenderer.init($('stage')).catch((error) => {
        if (renderer === newRenderer) renderer = null;
        rendererInit = null;
        throw error;
      });
    }
    if (rendererInit) await rendererInit;
    if (!active() || !renderer) return;
    renderer.options.backgroundDim = Number(($('dim') as HTMLInputElement).value) / 100;
    renderer.options.showCursorTrail = ($('cursor-trail') as HTMLInputElement).checked;
    renderer.options.showKeyOverlay = ($('key-overlay') as HTMLInputElement).checked;
    // Decode local skin sprites once for this session, after renderer init.
    // The request gate prevents stale async skin decoding from replacing a newer replay.
    const visuals = localSkin
      ? await decodeVisualSkin(localSkin, async bytes =>
          createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' })))
      : {};
    if (!active() || !renderer) return;
    const skinConfig = localSkin ? visualSkinConfig(localSkin) : undefined;
    currentSkinVisuals = visuals;
    currentSkinConfig = skinConfig;
    renderer.setSkinVisuals(visuals, skinConfig);
    renderer.setBackground(s.background);
    renderer.load(s.map, s.frames, s.judgement, { player: s.player });
    captureButton();
    playerClock.seek(initialPlaybackTime(s.map.firstObjectTime, s.map.audioLeadIn));
    updateHpBar(s, playerClock.now(), false);
    buildMarkers(s);
    fillInfo(s);
    fillHitError(s);
    loading(null);
    if (s.warnings.length) toast(s.warnings.join(' '));
    await playerClock.play();
    if (!active()) return;
    updatePlayButton();
    const loop = () => {
      if (!active() || !renderer || !session) return;
      raf = requestAnimationFrame(loop);
      const t = playerClock.now();
      playerClock.scheduleHitsounds();
      updateHpBar(session, t, true);
      renderer.render(t);
      const end = endTime();
      if (!seeking) ($('seek') as HTMLInputElement).value = String(Math.round((clamp(t, 0, end) / end) * 1000));
      $('time').textContent = `${fmt(t / playerClock.rate)} / ${fmt(end / playerClock.rate)}`;
      if (playerClock.isPlaying && t > end + 1000) {
        playerClock.pause();
        updatePlayButton();
      }
    };
    loop();
  } catch (error) {
    if (active()) {
      stopPlayer();
      $('player').hidden = true;
      $('home').hidden = false;
    }
    throw error;
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const endTime = () => session ? playbackEndTime(session.map.lastObjectTime, clock?.duration ?? 0) : 1;

function updateHpBar(s: Session, t: number, pauseOnFail: boolean) {
  const maximum = s.hp.coefficients.maximum;
  const hp = hpAt(s.hp.trace, t);
  const fill = $('hpfill');
  fill.style.width = `${healthBarPercent(hp, maximum)}%`;
  fill.classList.toggle('low', isLowHealth(hp, maximum));
  const bar = $('hpbar');
  bar.setAttribute('aria-valuenow', String(Math.round(clamp(hp, 0, maximum))));
  const failed = hpHasFailed(s.hp.failTime, t);
  $('fail').hidden = !failed;
  if (failed && !hpFailed) {
    hpFailed = true;
    if (pauseOnFail) {
      clock?.pause();
      updatePlayButton();
    }
  } else if (!failed) {
    hpFailed = false;
  }
}

function stopPlayer() {
  if (captureAutoStop) clearTimeout(captureAutoStop);
  captureAutoStop = null;
  videoCapture.cancel();
  exportAbort?.abort();
  if (exportDialog.open) exportDialog.close();
  currentSkinVisuals = {};
  currentSkinConfig = undefined;
  hpFailed = false;
  $('hpbar').hidden = true;
  $('fail').hidden = true;
  $('hit-error').hidden = true;
  $('hit-error-points').replaceChildren();
  activeScoreId = null;
  ($('share-score') as HTMLButtonElement).disabled = true;
  cancelAnimationFrame(raf);
  clock?.dispose();
  clock = null;
  session = null;
  captureButton();
}

function closePlayer() {
  playbackGate.cancel();
  stopPlayer();
  $('player').hidden = true;
  $('home').hidden = false;
  $('info').hidden = true;
  history.replaceState(null, '', location.pathname);
}

function updatePlayButton() {
  $('playpause').textContent = clock?.isPlaying ? '❚❚' : '▶';
}

async function togglePlay() {
  if (!clock) return;
  if (clock.isPlaying) clock.pause();
  else {
    if (session && hpHasFailed(session.hp.failTime, clock.now())) {
      toast('This replay failed here. Seek earlier to continue.');
      return;
    }
    if (clock.now() > endTime()) clock.seek(initialPlaybackTime(session?.map.firstObjectTime ?? 0, session?.map.audioLeadIn));
    await clock.play();
  }
  updatePlayButton();
}

function buildMarkers(s: Session) {
  const end = endTime();
  const box = $('markers');
  box.replaceChildren(
    ...s.judgement.events
      .filter((e) => e.result === 0 || e.result === 100)
      .map((e) => {
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = e.result === 100 ? 'marker m100' : 'marker miss';
        marker.style.left = `${(clamp(e.t, 0, end) / end) * 100}%`;
        const label = `${e.result === 100 ? '100' : 'Miss'} at ${fmt(e.t / s.map.rate)} — review 2 seconds earlier`;
        marker.title = label;
        marker.setAttribute('aria-label', label);
        marker.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (clock && session === s) clock.seek(markerReviewTime(e.t));
        });
        return marker;
      }),
  );
}

function fillInfo(s: Session) {
  const c = s.judgement.counts;
  const h = s.replay?.stats;
  const row = (label: string, ours: number, theirs?: number) =>
    `<tr><td>${label}</td><td>${ours}</td>${h ? `<td class="${theirs !== ours ? 'diff' : ''}">${theirs ?? ''}</td>` : ''}</tr>`;
  const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  $('info').innerHTML = `
    <strong>${esc(s.map.artist)} - ${esc(s.map.title)} [${esc(s.map.version)}]</strong>
    <div class="muted">${esc(s.player)}${s.map.mods.length ? ' · +' + esc(s.map.mods.join('')) : ''} · CS ${s.map.cs.toFixed(1)} AR ${s.map.ar.toFixed(1)} OD ${s.map.od.toFixed(1)}</div>
    <table>
      <tr><th></th><th>Renderer</th>${h ? '<th>osu!</th>' : ''}</tr>
      ${row('300', c.c300, h?.count300)}${row('100', c.c100, h?.count100)}${row('50', c.c50, h?.count50)}${row('Miss', c.miss, h?.countMiss)}
      ${row('Max combo', s.judgement.maxCombo, h?.maxCombo)}
      ${row('Score V1 (calculated)', s.judgement.totalScore, h?.totalScore)}
    </table>
    ${h ? '<p>Highlighted values differ from the osu!stable replay header. Scores are reconstructed and not yet proven exact.</p>' : '<p>Calculated Score V1 is provisional until validated against real replay headers.</p>'}`;
}

function fillHitError(s: Session) {
  const host = $('hit-error');
  const points = $('hit-error-points');
  const text = $('hit-error-text');
  const samples = hitErrorSamples(s.map.objects, s.judgement.objects);
  if (samples.length < 2) {
    host.hidden = true;
    points.replaceChildren();
    return;
  }
  const summary = hitErrorSummary(samples);
  points.replaceChildren(...samples.slice(-40).map((sample) => {
    const point = document.createElement('span');
    point.className = 'hit-error-point';
    const offset = Math.max(-100, Math.min(100, sample.offset));
    point.style.left = `${50 + offset / 2}%`;
    point.style.background = sample.result === 300 ? '#6ee36e' : sample.result === 100 ? '#f5c542' : '#5fb4ff';
    point.title = `${sample.offset >= 0 ? '+' : ''}${sample.offset.toFixed(0)} ms`;
    return point;
  }));
  text.textContent = `avg ${summary.average >= 0 ? '+' : ''}${summary.average.toFixed(1)}ms · UR ${summary.unstableRate.toFixed(0)}`;
  host.hidden = false;
}

$('playpause').addEventListener('click', () => void togglePlay());
$('capture-video').addEventListener('click', () => void toggleCapture());
$('back').addEventListener('click', closePlayer);
$('info-btn').addEventListener('click', () => ($('info').hidden = !$('info').hidden));
$('share-score').addEventListener('click', async () => {
  if (activeScoreId === null) return;
  const url = scoreShareUrl(location.href, activeScoreId);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(url);
    toast('Replay link copied to clipboard.', true);
  } catch {
    toast('Unable to copy automatically. Copy the ?score= link from the address bar.');
  }
});
const seek = $('seek') as HTMLInputElement;
seek.addEventListener('input', () => {
  seeking = true;
  if (clock) {
    clock.seek((Number(seek.value) / 1000) * endTime());
    if (session) updateHpBar(session, clock.now(), false);
  }
});
seek.addEventListener('change', () => (seeking = false));
$('dim').addEventListener('input', (e) => {
  if (renderer) renderer.options.backgroundDim = Number((e.target as HTMLInputElement).value) / 100;
  store.set('dim', (e.target as HTMLInputElement).value);
});
$('volume').addEventListener('input', (e) => {
  if (clock) clock.volume = Number((e.target as HTMLInputElement).value) / 100;
  store.set('volume', (e.target as HTMLInputElement).value);
});
$('effects-volume').addEventListener('input', (e) => {
  const value = Number((e.target as HTMLInputElement).value) / 100;
  if (clock) clock.effectsVolume = value;
  store.set('effects-volume', (e.target as HTMLInputElement).value);
});
for (const [control, option] of [
  ['cursor-trail', 'showCursorTrail'],
  ['key-overlay', 'showKeyOverlay'],
] as const) {
  ($(control) as HTMLInputElement).addEventListener('change', (e) => {
    const visible = (e.target as HTMLInputElement).checked;
    if (renderer) renderer.options[option] = visible;
    store.set(control, String(visible));
  });
}
$('playback-speed').addEventListener('change', (e) => {
  const speed = checkedPlayerSpeed(Number((e.target as HTMLSelectElement).value));
  if (clock && session) {
    const rate = effectivePlaybackRate(session.map.rate, speed);
    clock.setRate(rate);
    void clock.prepareRate(rate).then((ok) => {
      if (!ok && Math.abs(rate - 1) > 1e-6) {
        toast('Pitch-preserving speed change is unavailable; audio pitch follows speed.');
      }
    });
  }
  store.set('playback-speed', String(speed));
});
const syncOffset = $('sync-offset') as HTMLInputElement;
const showOffset = () => {
  const value = Number(syncOffset.value);
  $('sync-offset-label').textContent = `${value > 0 ? '+' : ''}${value}ms`;
};
syncOffset.addEventListener('input', () => {
  if (clock) clock.setOffset(Number(syncOffset.value));
  store.set('sync-offset', syncOffset.value);
  showOffset();
});

document.addEventListener('keydown', (e) => {
  if ($('player').hidden || (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
  if (e.code === 'Space') {
    e.preventDefault();
    void togglePlay();
  } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault();
    if (clock) {
      clock.seek(clock.now() + (e.code === 'ArrowRight' ? 5000 : -5000));
      if (session) updateHpBar(session, clock.now(), false);
    }
  } else if (e.code === 'Escape') closePlayer();
});

// ------------------------------------------------------------------ startup

for (const id of ['dim', 'volume', 'effects-volume']) {
  const v = store.get(id);
  if (v !== null) ($(id) as HTMLInputElement).value = v;
}
for (const control of ['cursor-trail', 'key-overlay']) {
  ($(control) as HTMLInputElement).checked = storedToggle(store.get(control));
}
const savedOffset = Number(store.get('sync-offset') ?? 0);
if (Number.isFinite(savedOffset)) {
  // Clamp legacy/out-of-range saved preferences rather than trusting storage.
  syncOffset.value = String(Math.max(-250, Math.min(250, Math.round(savedOffset / 5) * 5)));
}
showOffset();
const speedChoice = checkedPlayerSpeed(Number(store.get('playback-speed') ?? 1));
($('playback-speed') as HTMLSelectElement).value = String(speedChoice);
const savedUser = store.get('username');
if (savedUser) ($('username') as HTMLInputElement).value = savedUser;
const skinReady = restoreSavedSkin();

const launch = parseLaunchTarget(location.search);
if (launch.kind === 'user') {
  void showRecent(String(launch.id));
} else if (launch.kind === 'score') {
  const lease = playbackGate.begin();
  void (async () => {
    try {
      loading('Downloading replay…');
      const replayBytes = await getReplayFile(launch.id, lease.signal);
      if (!lease.isCurrent()) return;
      const replay = await decodeReplay(replayBytes);
      if (!lease.isCurrent()) return;
      const { beatmapId, beatmapsetId } = await lookupBeatmap(replay.beatmapMD5, lease.signal);
      if (!lease.isCurrent()) return;
      const { osz, osuFallback } = await downloadMap(beatmapsetId, beatmapId, lease);
      if (!lease.isCurrent()) return;
      loading('Preparing…');
      await skinReady;
      const result = await sessionFromReplay(replayBytes, osz, osuFallback, beatmapId, localSkin);
      if (lease.isCurrent()) await startPlayer(result, launch.id, lease);
    } catch (err) {
      if (lease.isCurrent()) {
        loading(null);
        toast((err as Error).message);
      }
    }
  })();
}
