import './style.css';
import { getRecent, getReplayFile, getBeatmapset, getOsuFile, lookupBeatmap, type RecentPlay } from './api';
import { openOsz, type OszArchive } from './load/osz';
import { assertLocalUploadSize } from './load/upload-limits';
import { decodeReplay } from './load/replay';
import { sessionFromReplay, sessionFromAutoplay, type Session } from './session';
import { PlayfieldRenderer } from './render/renderer';
import { decodeVisualSkin, visualSkinFiles, visualSkinConfig } from './render/skin-visuals';
import { Clock } from './audio/clock';
import { supportedSkinAudioFiles } from './audio/skin-assets';
import { parseLaunchTarget, scoreShareUrl, userShareUrl } from './launch';
import { playbackEndTime } from './audio/timeline';
import { initialPlaybackTime } from './audio/lead-in';
import { PlaybackRequestGate, type PlaybackLease } from './playback-gate';
import { checkedPlayerSpeed, effectivePlaybackRate } from './audio/speed';
import { markerReviewTime } from './render/marker-review';
import { storedToggle } from './render/preferences';
import { ReplayVideoCapture, safeCaptureFilename } from './render/video-capture';

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
  btn.disabled = !p.hasReplay;
  btn.title = p.hasReplay ? 'Watch this replay' : 'osu! did not keep a replay for this play';
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
function captureButton() {
  const button = $('capture-video') as HTMLButtonElement;
  button.disabled = !session || !renderer;
  button.textContent = videoCapture.active ? 'Stop recording' : 'Record WebM';
}

async function toggleCapture() {
  if (videoCapture.active) {
    if (captureAutoStop) clearTimeout(captureAutoStop);
    captureAutoStop = null;
    try {
      const { blob } = await videoCapture.stop();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeCaptureFilename(session?.player ?? 'player');
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast('Video-only WebM saved. Audio and MP4 export are not implemented yet.', true);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      captureButton();
    }
    return;
  }
  if (!renderer || !session) return;
  try {
    videoCapture.start(renderer.app.canvas);
    // Save before the encoder's hard 60-second safety stop.
    captureAutoStop = setTimeout(() => { if (videoCapture.active) void toggleCapture(); }, 59_000);
    captureButton();
    toast('Recording video only, maximum 60 seconds. Press Stop recording to save.');
  } catch (error) {
    toast((error as Error).message);
  }
}

const playbackGate = new PlaybackRequestGate();

async function openPlay(p: RecentPlay) {
  const lease = playbackGate.begin();
  try {
    loading('Downloading replay…');
    const replayBytes = await getReplayFile(p.scoreId, lease.signal);
    if (!lease.isCurrent()) return;
    const { osz, osuFallback } = await downloadMap(p.beatmapsetId, p.beatmapId, lease);
    if (!lease.isCurrent()) return;
    loading('Preparing…');
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
const MOD_CHOICES = ['EZ', 'HR', 'HD', 'DT', 'NC', 'HT'];

wireDrop('osk-drop', 'osk-input', async (file) => {
  try {
    loading('Checking skin archive…');
    assertLocalUploadSize('osk', file.size);
    const archive = openOsz(new Uint8Array(await file.arrayBuffer()));
    const usable = supportedSkinAudioFiles(archive);
    // Visual-only .osk archives are valid: their sprites are used by the renderer.
    const visualCount = Object.keys(visualSkinFiles(archive)).length;
    if (!usable.length && !visualCount) throw new Error('This skin contains no supported audio or visual files.');
    localSkin = archive;
    $('osk-status').textContent = `${file.name}: ${usable.length} hitsound files and ${visualCount} visual sprites. The next replay will use supported assets.`;
    $('osk-drop').querySelector('span')!.textContent = file.name;
    loading(null);
    toast('Supported skin assets loaded for the next replay.', true);
  } catch (error) {
    loading(null);
    toast((error as Error).message);
  }
});

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
let activeScoreId: number | null = null;

let rendererInit: Promise<void> | null = null;

async function startPlayer(s: Session, scoreId: number | null = null, lease = playbackGate.begin()) {
  if (!lease.isCurrent()) return;
  stopPlayer();
  activeScoreId = scoreId;
  ($('share-score') as HTMLButtonElement).disabled = scoreId === null;
  session = s;
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
    renderer.setSkinVisuals(visuals, localSkin ? visualSkinConfig(localSkin) : undefined);
    renderer.setBackground(s.background);
    renderer.load(s.map, s.frames, s.judgement, { player: s.player });
    captureButton();
    playerClock.seek(initialPlaybackTime(s.map.firstObjectTime, s.map.audioLeadIn));
    buildMarkers(s);
    fillInfo(s);
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

function stopPlayer() {
  if (captureAutoStop) clearTimeout(captureAutoStop);
  captureAutoStop = null;
  videoCapture.cancel();
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
  if (clock) clock.seek((Number(seek.value) / 1000) * endTime());
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
  if (clock && session) clock.setRate(effectivePlaybackRate(session.map.rate, speed));
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
    if (clock) clock.seek(clock.now() + (e.code === 'ArrowRight' ? 5000 : -5000));
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
