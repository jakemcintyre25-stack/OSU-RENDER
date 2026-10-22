import './style.css';
import { getRecent, getReplayFile, getBeatmapset, getOsuFile, lookupBeatmap, type RecentPlay } from './api';
import { openOsz, type OszArchive } from './load/osz';
import { decodeReplay } from './load/replay';
import { sessionFromReplay, sessionFromAutoplay, type Session } from './session';
import { PlayfieldRenderer } from './render/renderer';
import { Clock } from './audio/clock';
import { playbackEndTime } from './audio/timeline';

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

$('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = ($('username') as HTMLInputElement).value.trim();
  if (!name) return;
  store.set('username', name);
  const status = $('user-status');
  const list = $('plays');
  status.textContent = 'Loading…';
  list.replaceChildren();
  try {
    const { user, plays } = await getRecent(name);
    status.textContent = plays.length
      ? `${user.username}'s last ${plays.length} plays (last 24 hours, including fails)`
      : `${user.username} has no osu!standard plays in the last 24 hours.`;
    list.replaceChildren(...plays.map(playItem));
  } catch (err) {
    status.textContent = (err as Error).message;
  }
});

async function openPlay(p: RecentPlay) {
  try {
    loading('Downloading replay…');
    const replayBytes = await getReplayFile(p.scoreId);
    const { osz, osuFallback } = await downloadMap(p.beatmapsetId, p.beatmapId);
    loading('Preparing…');
    const s = await sessionFromReplay(replayBytes, osz, osuFallback, p.beatmapId);
    history.replaceState(null, '', `?score=${p.scoreId}`);
    await startPlayer(s);
  } catch (err) {
    loading(null);
    toast((err as Error).message);
  }
}

async function downloadMap(setId: number, beatmapId: number): Promise<{ osz: OszArchive | null; osuFallback: string | null }> {
  loading('Downloading beatmap…', 0);
  try {
    const bytes = await getBeatmapset(setId, (p) => loading('Downloading beatmap…', p));
    loading('Unpacking beatmap…');
    return { osz: openOsz(bytes), osuFallback: null };
  } catch (err) {
    console.warn('beatmapset download failed, falling back to .osu only', err);
    loading('Mirrors unavailable — getting the map without audio…');
    return { osz: null, osuFallback: await getOsuFile(beatmapId) };
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
  try {
    loading('Reading replay…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const replay = await decodeReplay(bytes);
    if (!replay.beatmapMD5) throw new Error('This replay has no beatmap reference');
    loading('Finding the beatmap…');
    // A beatmap .osz already dropped on the page wins: it works offline and needs no API.
    const md5 = replay.beatmapMD5.toLowerCase();
    const local = localOsz?.difficulties.find((d) => d.md5.toLowerCase() === md5);
    if (localOsz && local) {
      loading('Preparing…');
      await startPlayer(await sessionFromReplay(bytes, localOsz, null, local.beatmapId ?? 0));
      return;
    }
    let found: { beatmapId: number; beatmapsetId: number };
    try {
      found = await lookupBeatmap(replay.beatmapMD5);
    } catch {
      throw new Error('Map not found. Drop the matching .osz file first (or set up osu! API keys for automatic lookup).');
    }
    const { osz, osuFallback } = await downloadMap(found.beatmapsetId, found.beatmapId);
    loading('Preparing…');
    await startPlayer(await sessionFromReplay(bytes, osz, osuFallback, found.beatmapId));
  } catch (err) {
    loading(null);
    toast((err as Error).message);
  }
});

let localOsz: OszArchive | null = null;
const MOD_CHOICES = ['EZ', 'HR', 'HD', 'DT', 'NC', 'HT'];

wireDrop('osz-drop', 'osz-input', async (file) => {
  try {
    loading('Unpacking beatmap…');
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
  try {
    const std = localOsz.difficulties.filter((d) => d.mode === 0);
    const diff = std[Number(($('osz-diff') as HTMLSelectElement).value)];
    const mods = [...$('osz-mods').querySelectorAll<HTMLInputElement>('input:checked')].map((c) => c.value);
    loading('Preparing…');
    await startPlayer(await sessionFromAutoplay(localOsz, diff, mods));
  } catch (err) {
    loading(null);
    toast((err as Error).message);
  }
});

// ------------------------------------------------------------------ player

let renderer: PlayfieldRenderer | null = null;
let clock: Clock | null = null;
let session: Session | null = null;
let raf = 0;
let seeking = false;

async function startPlayer(s: Session) {
  stopPlayer();
  session = s;
  $('home').hidden = true;
  $('player').hidden = false;
  loading('Decoding audio…');
  clock = new Clock();
  try {
    await clock.load(s.audio);
  } catch {
    s.warnings.push('The audio could not be decoded by this browser.');
    await clock.load(null);
  }
  loading('Decoding beatmap hitsounds…');
  const samples = await clock.loadHitsounds(s.hitsounds);
  if (samples.failed > 0) s.warnings.push(`${samples.failed} beatmap hitsound files could not be decoded by this browser.`);
  if (s.hitsounds.unavailable > 0) s.warnings.push('Some hitsounds are missing; default skin samples are not yet supported.');
  clock.rate = s.map.rate;
  clock.volume = Number(($('volume') as HTMLInputElement).value) / 100;
  clock.offset = Number(($('sync-offset') as HTMLInputElement).value);
  clock.onEnded = () => updatePlayButton();
  if (!renderer) {
    renderer = new PlayfieldRenderer();
    await renderer.init($('stage'));
  }
  renderer.options.backgroundDim = Number(($('dim') as HTMLInputElement).value) / 100;
  renderer.setBackground(s.background);
  renderer.load(s.map, s.frames, s.judgement, { player: s.player });
  const start = Math.min(0, s.map.firstObjectTime - 1500);
  clock.seek(Math.max(start, s.map.firstObjectTime - 2500));
  buildMarkers(s);
  fillInfo(s);
  loading(null);
  if (s.warnings.length) toast(s.warnings.join(' '));
  await clock.play();
  updatePlayButton();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!clock || !renderer || !session) return;
    const t = clock.now();
    clock.scheduleHitsounds();
    renderer.render(t);
    const end = endTime();
    if (!seeking) ($('seek') as HTMLInputElement).value = String(Math.round((clamp(t, 0, end) / end) * 1000));
    $('time').textContent = `${fmt(t / clock.rate)} / ${fmt(end / clock.rate)}`;
    if (clock.isPlaying && t > end + 1000) {
      clock.pause();
      updatePlayButton();
    }
  };
  loop();
}

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const endTime = () => session ? playbackEndTime(session.map.lastObjectTime, clock?.duration ?? 0) : 1;

function stopPlayer() {
  cancelAnimationFrame(raf);
  clock?.dispose();
  clock = null;
  session = null;
}

function closePlayer() {
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
    if (clock.now() > endTime()) clock.seek(Math.min(0, (session?.map.firstObjectTime ?? 0) - 1500));
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
        const i = document.createElement('i');
        if (e.result === 100) i.className = 'm100';
        i.style.left = `${(clamp(e.t, 0, end) / end) * 100}%`;
        return i;
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
    </table>
    ${h ? '<p>Yellow numbers differ from what osu! recorded — the judgement engine is still being matched to stable.</p>' : ''}`;
}

$('playpause').addEventListener('click', () => void togglePlay());
$('back').addEventListener('click', closePlayer);
$('info-btn').addEventListener('click', () => ($('info').hidden = !$('info').hidden));
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

for (const id of ['dim', 'volume']) {
  const v = store.get(id);
  if (v !== null) ($(id) as HTMLInputElement).value = v;
}
const savedOffset = Number(store.get('sync-offset') ?? 0);
if (Number.isFinite(savedOffset)) {
  // Clamp legacy/out-of-range saved preferences rather than trusting storage.
  syncOffset.value = String(Math.max(-250, Math.min(250, Math.round(savedOffset / 5) * 5)));
}
showOffset();
const savedUser = store.get('username');
if (savedUser) ($('username') as HTMLInputElement).value = savedUser;

const scoreParam = new URLSearchParams(location.search).get('score');
if (scoreParam && /^\d+$/.test(scoreParam)) {
  void (async () => {
    try {
      loading('Downloading replay…');
      const replayBytes = await getReplayFile(Number(scoreParam));
      const replay = await decodeReplay(replayBytes);
      const { beatmapId, beatmapsetId } = await lookupBeatmap(replay.beatmapMD5);
      const { osz, osuFallback } = await downloadMap(beatmapsetId, beatmapId);
      loading('Preparing…');
      await startPlayer(await sessionFromReplay(replayBytes, osz, osuFallback, beatmapId));
    } catch (err) {
      loading(null);
      toast((err as Error).message);
    }
  })();
}
