import { Application, Container, Graphics, Text, Sprite, Texture, AlphaFilter } from 'pixi.js';
import type { PreparedMap, HitObj, SliderObj, SpinnerObj, Vec } from '../game/prepare';
import { sliderBallAt } from '../game/prepare';
import type { Judgement } from '../game/judge';
import { eventAt } from '../game/judge';
import { scoreHudLabel } from './hud-score';
import { cursorAt, KEY, type ReplayFrame } from '../load/replay';
import { playfieldLayout, type PlayfieldLayout } from './layout';
import { hitLightAt } from './effects';
import { firstFollowPointAtOrAfter, planFollowPoints, type FollowPoint } from './follow-points';
import { flashlightRadius, flashlightTrackDim } from './flashlight';
import { VisibleObjectIndex } from './visible-index';
import { DEFAULT_VISUAL_SKIN_CONFIG, fontDigitLayout, skinComboColor, sliderBallFrame, type VisualSkinKey, type VisualSkinConfig } from './skin-visuals';

const HIT_FADE = 240; // ms for a hit circle to expand and fade after being hit
const MISS_FADE = 120;
const SLIDER_FADE = 200;
const JUDGEMENT_SHOW = 650;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
}

interface CircleParts {
  root: Container;
  body: Graphics;
  light: Graphics;
  number: Text;
  numberContainer?: Container;
  skinBody?: Sprite;
  skinOverlay?: Sprite;
}

interface Display {
  obj: HitObj;
  root: Container;
  head?: CircleParts;
  approach?: Graphics;
  skinApproach?: Sprite;
  // sliders
  body?: Graphics;
  bodyAlpha?: AlphaFilter;
  bodyProgress?: number;
  cumLen?: number[];
  decor?: Graphics;
  ball?: Graphics;
  follow?: Graphics;
  skinBall?: Sprite;
  skinFollow?: Sprite;
  reverseStart?: Sprite;
  reverseEnd?: Sprite;
  skinStart?: Sprite;
  skinEnd?: Sprite;
  // spinners
  spinnerDisc?: Graphics;
  spinnerRing?: Graphics;
  skinSpinnerBackground?: Sprite;
  skinSpinnerDisc?: Sprite;
  skinSpinnerApproach?: Sprite;
}

export interface RenderOptions {
  backgroundDim: number;
  showCursorTrail: boolean;
  showKeyOverlay: boolean;
}

export class PlayfieldRenderer {
  readonly app = new Application();
  private bg = new Sprite(Texture.EMPTY);
  private field = new Container();
  private followLayer = new Container();
  private followGfx = new Graphics();
  private flashGfx = new Graphics();
  private followPoints: FollowPoint[] = [];
  private trackingRanges: [number, number][] = [];
  private objectLayer = new Container({ sortableChildren: true });
  private approachLayer = new Container();
  private judgementLayer = new Container();
  private cursorLayer = new Container();
  private cursorGfx = new Graphics();
  private cursorMiddleSprite = new Sprite(Texture.EMPTY);
  private cursorSprite = new Sprite(Texture.EMPTY);
  private cursorTrailSprites: Sprite[] = [];
  private cursorBaseScale = { x: 1, y: 1 };
  private hud = new Container();
  private comboText!: Text;
  private accText!: Text;
  private scoreText!: Text;
  private infoText!: Text;
  private keyBoxes: { g: Graphics; label: Text; count: Text; mask: number; presses: number[] }[] = [];
  private displays = new Map<number, Display>();
  private judgementTexts = new Map<number, Text>();
  private layout: PlayfieldLayout = { scale: 1, x: 0, y: 0 };
  private map: PreparedMap | null = null;
  private skinTextures: Partial<Record<VisualSkinKey, Texture>> = {};
  private sliderBallTextures: Texture[] = [];
  private hitCircleFontTextures: Array<Texture | null> = [];
  private skinConfig: VisualSkinConfig = { ...DEFAULT_VISUAL_SKIN_CONFIG };
  private visibility: VisibleObjectIndex | null = null;
  private judgement: Judgement | null = null;
  private frames: ReplayFrame[] = [];
  private frameHint = 0;
  private resultEvents: { t: number; x: number; y: number; result: number }[] = [];
  options: RenderOptions = { backgroundDim: 0.8, showCursorTrail: true, showKeyOverlay: true };

  async init(host: HTMLElement, options: { resolution?: number } = {}) {
    const resolution = options.resolution ?? Math.min(window.devicePixelRatio || 1, 2);
    if (!Number.isFinite(resolution) || resolution <= 0 || resolution > 4) {
      throw new RangeError('Invalid renderer resolution');
    }
    await this.app.init({
      resizeTo: host,
      background: '#000000',
      antialias: true,
      autoDensity: true,
      resolution,
      preference: 'webgl',
      autoStart: false,
    });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.field, this.hud);
    this.followLayer.addChild(this.followGfx);
    this.field.addChild(this.followLayer, this.objectLayer, this.approachLayer, this.judgementLayer, this.flashGfx, this.cursorLayer);
    this.cursorLayer.addChild(this.cursorGfx, this.cursorMiddleSprite, this.cursorSprite);
    this.cursorSprite.anchor.set(0.5);
    this.cursorSprite.visible = false;
    this.cursorMiddleSprite.anchor.set(0.5);
    this.cursorMiddleSprite.visible = false;
    for (let i = 0; i < 12; i++) {
      const trail = new Sprite(Texture.EMPTY);
      trail.anchor.set(0.5);
      trail.visible = false;
      this.cursorTrailSprites.push(trail);
      this.cursorLayer.addChildAt(trail, 0);
    }
    this.buildHud();
    this.app.renderer.on('resize', () => this.relayout());
    this.relayout();
  }

  resize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('Invalid renderer size');
    }
    this.app.renderer.resize(width, height);
    this.relayout();
  }

  setSkinVisuals(images: Partial<Record<VisualSkinKey, ImageBitmap | HTMLImageElement>>, config?: VisualSkinConfig) {
    this.skinConfig = { ...DEFAULT_VISUAL_SKIN_CONFIG, ...(config ?? {}), comboColors: config?.comboColors ?? [] };
    this.cursorSprite.anchor.set(this.skinConfig.cursorCentre ? 0.5 : 0);
    this.skinTextures = {};
    for (const [name, image] of Object.entries(images)) {
      if (!image) continue;
      this.skinTextures[name as VisualSkinKey] = Texture.from(image);
    }
    this.sliderBallTextures = [];
    for (let i = 0; i < this.skinConfig.sliderBallFrames; i++) {
      const texture = this.skinTextures[`sliderb${i}`];
      if (texture) this.sliderBallTextures.push(texture);
    }
    this.hitCircleFontTextures = Array.from({ length: 10 }, (_, digit) => this.skinTextures[`font${digit}`] ?? null);
    const trail = this.skinTextures.cursortrail;
    for (const sprite of this.cursorTrailSprites) {
      sprite.texture = trail ?? Texture.EMPTY;
      sprite.visible = false;
      if (trail) {
        sprite.width = 24;
        sprite.height = 24;
      }
    }
    const cursor = this.skinTextures.cursor;
    const cursorSize = 64 * this.skinConfig.cursorScale;
    this.cursorSprite.texture = cursor ?? Texture.EMPTY;
    this.cursorSprite.visible = Boolean(cursor);
    if (cursor) {
      // Playfield coordinates: osu!standard skin cursors use 128px at 1x.
      this.cursorSprite.width = cursorSize;
      this.cursorSprite.height = cursorSize;
      this.cursorBaseScale = { x: this.cursorSprite.scale.x, y: this.cursorSprite.scale.y };
    }
    const middle = this.skinTextures.cursormiddle;
    this.cursorMiddleSprite.texture = middle ?? Texture.EMPTY;
    this.cursorMiddleSprite.visible = Boolean(middle);
    this.cursorMiddleSprite.width = cursorSize;
    this.cursorMiddleSprite.height = cursorSize;
  }

  setBackground(img: ImageBitmap | HTMLImageElement | null) {
    this.bg.texture = img ? Texture.from(img) : Texture.EMPTY;
    this.relayout();
  }

  load(map: PreparedMap, frames: ReplayFrame[], judgement: Judgement, meta: { player: string }) {
    this.clearObjects();
    this.map = map;
    this.visibility = new VisibleObjectIndex(map.objects);
    this.followPoints = planFollowPoints(map.objects, map.radius);
    this.frames = frames;
    this.judgement = judgement;
    this.frameHint = 0;
    this.trackingRanges = judgement.objects.flatMap((o) => o.tracking ?? []);
    this.resultEvents = judgement.events
      .filter((e) => e.result !== undefined && e.result !== 300 && e.x !== undefined)
      .map((e) => ({ t: e.t, x: e.x!, y: e.y!, result: e.result! }));
    this.infoText.text = `${meta.player}${map.mods.length ? '  +' + map.mods.join('') : ''}\n${map.artist} - ${map.title} [${map.version}]`;
    for (const k of this.keyBoxes) k.presses = [];
    let prev = 0;
    for (const f of frames) {
      for (const k of this.keyBoxes) {
        // K1/K2 also set M1/M2, so only count mouse buttons when the key bit isn't set.
        const down = (f.keys & k.mask) === k.mask && !(k.mask === KEY.M1 && f.keys & KEY.K1) && !(k.mask === KEY.M2 && f.keys & KEY.K2);
        const was = (prev & k.mask) === k.mask && !(k.mask === KEY.M1 && prev & KEY.K1) && !(k.mask === KEY.M2 && prev & KEY.K2);
        if (down && !was) k.presses.push(f.t);
      }
      prev = f.keys;
    }
    this.relayout();
  }

  private clearObjects() {
    for (const d of this.displays.values()) this.destroyDisplay(d);
    this.displays.clear();
    for (const t of this.judgementTexts.values()) t.destroy();
    this.judgementTexts.clear();
    this.followPoints = [];
    this.followGfx.clear();
  }

  // ---------------------------------------------------------------- layout & HUD

  private buildHud() {
    const style = (size: number, weight: '400' | '700' = '700') => ({ fontFamily: FONT, fontSize: size, fill: 0xffffff, fontWeight: weight, dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 1 } });
    this.comboText = new Text({ text: '', style: style(48) });
    this.comboText.anchor.set(0, 1);
    this.accText = new Text({ text: '', style: style(32) });
    this.accText.anchor.set(1, 0);
    this.scoreText = new Text({ text: '', style: style(18, '400') });
    this.scoreText.anchor.set(1, 0);
    this.infoText = new Text({ text: '', style: style(15, '400') });
    this.hud.addChild(this.comboText, this.accText, this.scoreText, this.infoText);
    const keys: [string, number][] = [['K1', KEY.K1], ['K2', KEY.K2], ['M1', KEY.M1], ['M2', KEY.M2]];
    for (const [name, mask] of keys) {
      const g = new Graphics();
      const label = new Text({ text: name, style: style(13) });
      const count = new Text({ text: '0', style: style(11, '400') });
      label.anchor.set(0.5);
      count.anchor.set(0.5);
      this.hud.addChild(g, label, count);
      this.keyBoxes.push({ g, label, count, mask, presses: [] });
    }
  }

  private relayout() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.layout = playfieldLayout(w, h);
    this.field.position.set(this.layout.x, this.layout.y);
    this.field.scale.set(this.layout.scale);
    // Background: cover the screen.
    const tex = this.bg.texture;
    if (tex !== Texture.EMPTY && tex.width > 0) {
      const s = Math.max(w / tex.width, h / tex.height);
      this.bg.scale.set(s);
      this.bg.position.set((w - tex.width * s) / 2, (h - tex.height * s) / 2);
    }
    this.bg.alpha = 1 - this.options.backgroundDim;
    const u = h / 768; // HUD scale relative to a 768px-tall screen, like stable
    this.comboText.scale.set(u);
    this.comboText.position.set(12 * u, h - 8 * u);
    this.accText.scale.set(u);
    this.accText.position.set(w - 14 * u, 10 * u);
    this.scoreText.scale.set(u);
    this.scoreText.position.set(w - 14 * u, 50 * u);
    this.infoText.scale.set(u);
    this.infoText.position.set(14 * u, 10 * u);
    // On narrow screens the HP bar occupies the top-left; map/player text
    // would overlap it, so keep the playfield clear.
    this.infoText.visible = w >= 640;
    const res = this.app.renderer.resolution;
    for (const t of [this.comboText, this.accText, this.scoreText, this.infoText]) t.resolution = res;
    this.keyBoxes.forEach((k, i) => {
      const size = 34 * u;
      const x = w - size - 8 * u;
      const y = h / 2 - 2 * (size + 6 * u) + i * (size + 6 * u);
      k.g.position.set(x, y);
      k.label.position.set(x + size / 2, y + size / 2 - 5 * u);
      k.count.position.set(x + size / 2, y + size / 2 + 9 * u);
      k.label.scale.set(u);
      k.count.scale.set(u);
      (k.g as Graphics & { _size?: number })._size = size;
    });
    for (const d of this.displays.values()) if (d.head) d.head.number.resolution = this.textResolution();
  }

  private textResolution() {
    return Math.max(1, this.layout.scale * this.app.renderer.resolution);
  }

  // ---------------------------------------------------------------- per-frame drawing

  render(t: number) {
    const map = this.map;
    if (!map || !this.judgement) {
      this.app.render();
      return;
    }
    this.bg.alpha = 1 - this.options.backgroundDim;
    const keep = new Set<number>();
    // Conservative indexed window: the exact per-judgement fade logic below
    // still decides which candidates are drawn.
    const candidates = this.visibility?.at(t, map.preempt, SLIDER_FADE + HIT_FADE + 400) ?? [];
    for (const o of candidates) {
      const appear = o.start - map.preempt;
      const gone = o.end + (o.kind === 'circle' ? HIT_FADE + 40 : SLIDER_FADE + HIT_FADE);
      const j = this.judgement.objects[o.index];
      const lastNeeded = Math.max(gone, (j.hitTime ?? 0) + HIT_FADE, j.resultTime + MISS_FADE);
      if (t < appear || t > lastNeeded) continue;
      keep.add(o.index);
      let d = this.displays.get(o.index);
      if (!d) {
        d = this.createDisplay(o);
        this.displays.set(o.index, d);
      }
      this.updateDisplay(d, t);
    }
    for (const [i, d] of this.displays) {
      if (!keep.has(i)) {
        this.destroyDisplay(d);
        this.displays.delete(i);
      }
    }
    this.updateFollowPoints(t);
    this.updateFlashlight(t);
    this.updateJudgements(t);
    this.updateCursor(t);
    this.updateHud(t);
    this.app.render();
  }

  private displayColor(o: HitObj): number {
    const map = this.map;
    return map ? skinComboColor(map.comboColors, o.comboColor, this.skinConfig.comboColors) : o.comboColor;
  }

  private makeCircle(o: HitObj): CircleParts {
    const r = this.map!.radius;
    const color = this.displayColor(o);
    const root = new Container();
    const light = new Graphics();
    light.circle(0, 0, r * 1.8).fill({ color: 0xffffff, alpha: 0.18 });
    light.visible = false;
    const body = new Graphics();
    body.circle(0, 0, r * 0.93).fill({ color: shade(color, 0.55) });
    body.circle(0, 0, r * 0.8).fill({ color });
    body.circle(0, -r * 0.18, r * 0.5).fill({ color: 0xffffff, alpha: 0.12 });
    body.circle(0, 0, r * 0.93).stroke({ width: r * 0.12, color: 0xffffff });
    const number = new Text({ text: String(o.comboNumber), style: { fontFamily: FONT, fontSize: r * 0.75, fontWeight: '700', fill: 0xffffff, dropShadow: { color: 0x000000, alpha: 0.5, blur: 2, distance: 0 } } });
    number.anchor.set(0.5);
    number.resolution = this.textResolution();
    let numberContainer: Container | undefined;
    const digitTextures = String(o.comboNumber).split('').map((digit) => this.hitCircleFontTextures[Number(digit)]);
    if (digitTextures.length > 0 && digitTextures.every((texture): texture is Texture => Boolean(texture))) {
      const height = r * 1.05;
      const widths = digitTextures.map((texture) => (texture.width * height) / Math.max(1, texture.height));
      const layout = fontDigitLayout(widths, this.skinConfig.hitCircleOverlap * (r / 64));
      numberContainer = new Container();
      digitTextures.forEach((texture, index) => {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = widths[index];
        sprite.height = height;
        sprite.position.set(layout.positions[index], 0);
        numberContainer!.addChild(sprite);
      });
      number.visible = false;
    }
    root.addChild(light, body, numberContainer ?? number);
    const bodyTexture = this.skinTextures.hitcircle;
    const overlayTexture = this.skinTextures.hitcircleoverlay;
    let skinBody: Sprite | undefined;
    let skinOverlay: Sprite | undefined;
    if (bodyTexture) {
      skinBody = new Sprite(bodyTexture);
      skinBody.anchor.set(0.5);
      skinBody.width = skinBody.height = r * 2;
      skinBody.tint = color;
      root.addChildAt(skinBody, 1);
      body.visible = false;
    }
    if (overlayTexture) {
      skinOverlay = new Sprite(overlayTexture);
      skinOverlay.anchor.set(0.5);
      skinOverlay.width = skinOverlay.height = r * 2;
      root.addChildAt(skinOverlay, root.children.length - 1);
    }
    root.position.set(o.x, o.y);
    return { root, body, light, number, numberContainer, skinBody, skinOverlay };
  }

  private createDisplay(o: HitObj): Display {
    const root = new Container();
    root.zIndex = -o.index; // earlier objects draw on top, like osu!
    this.objectLayer.addChild(root);
    const d: Display = { obj: o, root };
    const r = this.map!.radius;
    if (o.kind === 'spinner') {
      if (this.skinTextures['spinner-background']) {
        d.skinSpinnerBackground = new Sprite(this.skinTextures['spinner-background']);
        d.skinSpinnerBackground.anchor.set(0.5);
        d.skinSpinnerBackground.width = 512;
        d.skinSpinnerBackground.height = 384;
        if (this.skinConfig.spinnerBackground !== null) d.skinSpinnerBackground.tint = this.skinConfig.spinnerBackground;
        root.addChild(d.skinSpinnerBackground);
      }
      d.spinnerDisc = new Graphics();
      d.spinnerDisc.circle(0, 0, 180).fill({ color: 0x000000, alpha: 0.45 }).stroke({ width: 4, color: 0xffffff, alpha: 0.8 });
      d.spinnerDisc.circle(0, 0, 8).fill({ color: 0xffffff });
      d.spinnerRing = new Graphics();
      d.spinnerRing.circle(0, 0, 180).stroke({ width: 6, color: 0xffffff });
      root.addChild(d.spinnerDisc, d.spinnerRing);
      if (this.skinTextures['spinner-circle']) {
        d.skinSpinnerDisc = new Sprite(this.skinTextures['spinner-circle']);
        d.skinSpinnerDisc.anchor.set(0.5);
        d.skinSpinnerDisc.width = d.skinSpinnerDisc.height = 360;
        d.spinnerDisc.visible = false;
        root.addChild(d.skinSpinnerDisc);
      }
      if (this.skinTextures['spinner-approachcircle']) {
        d.skinSpinnerApproach = new Sprite(this.skinTextures['spinner-approachcircle']);
        d.skinSpinnerApproach.anchor.set(0.5);
        d.skinSpinnerApproach.width = d.skinSpinnerApproach.height = 360;
        d.spinnerRing.visible = false;
        root.addChild(d.skinSpinnerApproach);
      }
      root.position.set(256, 192);
      return d;
    }
    if (o.kind === 'slider') {
      const color = this.displayColor(o);
      d.body = new Graphics();
      d.bodyAlpha = new AlphaFilter({ alpha: 1 });
      d.body.filters = [d.bodyAlpha];
      d.bodyProgress = -1;
      const cum = [0];
      for (let i = 1; i < o.path.length; i++) cum.push(cum[i - 1] + Math.hypot(o.path[i].x - o.path[i - 1].x, o.path[i].y - o.path[i - 1].y));
      d.cumLen = cum;
      d.decor = new Graphics();
      d.follow = new Graphics();
      d.follow.circle(0, 0, r * 2.4).fill({ color, alpha: 0.12 }).stroke({ width: 3, color: 0xffffff, alpha: 0.85 });
      d.ball = new Graphics();
      d.ball.circle(0, 0, r * 0.8).fill({ color }).stroke({ width: r * 0.12, color: 0xffffff });
      d.follow.visible = false;
      d.ball.visible = false;
      const ballTexture = this.skinTextures.sliderb ?? this.sliderBallTextures[0];
      if (ballTexture) {
        d.skinBall = new Sprite(ballTexture);
        d.skinBall.anchor.set(0.5);
        d.skinBall.width = d.skinBall.height = r * 2;
        d.skinBall.tint = color;
        d.skinBall.visible = false;
      }
      if (this.skinTextures.sliderstartcircle) {
        d.skinStart = new Sprite(this.skinTextures.sliderstartcircle);
        d.skinStart.anchor.set(0.5);
        d.skinStart.width = d.skinStart.height = r * 2;
        d.skinStart.tint = color;
        d.skinStart.position.set(o.path[0].x, o.path[0].y);
      }
      if (this.skinTextures.sliderendcircle) {
        d.skinEnd = new Sprite(this.skinTextures.sliderendcircle);
        d.skinEnd.anchor.set(0.5);
        d.skinEnd.width = d.skinEnd.height = r * 2;
        d.skinEnd.tint = color;
        const tail = o.path[o.path.length - 1];
        d.skinEnd.position.set(tail.x, tail.y);
      }
      if (this.skinTextures.reversearrow) {
        d.reverseStart = new Sprite(this.skinTextures.reversearrow);
        d.reverseEnd = new Sprite(this.skinTextures.reversearrow);
        for (const sprite of [d.reverseStart, d.reverseEnd]) {
          sprite.anchor.set(0.5);
          sprite.width = sprite.height = r * 1.3;
          sprite.visible = false;
        }
        const path = o.path;
        const a = path[0], b = path[path.length - 1];
        const nearA = path[Math.min(path.length - 1, 3)];
        const nearB = path[Math.max(0, path.length - 4)];
        d.reverseStart.position.set(a.x, a.y);
        d.reverseEnd.position.set(b.x, b.y);
        d.reverseStart.rotation = Math.atan2(nearA.y - a.y, nearA.x - a.x) - Math.PI / 2;
        d.reverseEnd.rotation = Math.atan2(nearB.y - b.y, nearB.x - b.x) - Math.PI / 2;
      }
      if (this.skinTextures.sliderfollowcircle) {
        d.skinFollow = new Sprite(this.skinTextures.sliderfollowcircle);
        d.skinFollow.anchor.set(0.5);
        d.skinFollow.width = d.skinFollow.height = r * 4.8;
        d.skinFollow.visible = false;
      }
      root.addChild(d.body, d.decor);
      if (d.skinStart) root.addChild(d.skinStart);
    }
    d.head = this.makeCircle(o);
    root.addChild(d.head.root);
    if (d.ball && d.follow) {
      root.addChild(d.follow, d.ball);
      if (d.skinFollow) root.addChild(d.skinFollow);
      if (d.skinBall) root.addChild(d.skinBall);
      if (d.reverseStart) root.addChild(d.reverseStart);
      if (d.reverseEnd) root.addChild(d.reverseEnd);
      if (d.skinEnd) root.addChild(d.skinEnd);
    }
    d.approach = new Graphics();
    d.approach.circle(0, 0, r).stroke({ width: r * 0.08, color: this.displayColor(o) });
    d.approach.position.set(o.x, o.y);
    this.approachLayer.addChild(d.approach);
    if (this.skinTextures.approachcircle) {
      d.skinApproach = new Sprite(this.skinTextures.approachcircle);
      d.skinApproach.anchor.set(0.5);
      d.skinApproach.width = d.skinApproach.height = r * 2;
      d.skinApproach.tint = this.displayColor(o);
      d.skinApproach.position.set(o.x, o.y);
      d.approach.visible = false;
      this.approachLayer.addChild(d.skinApproach);
    }
    return d;
  }

  private destroyDisplay(d: Display) {
    d.approach?.destroy();
    d.skinApproach?.destroy();
    d.root.destroy({ children: true });
  }

  private updateDisplay(d: Display, t: number) {
    const map = this.map!;
    const o = d.obj;
    const j = this.judgement!.objects[o.index];
    const appear = o.start - map.preempt;
    const fadeInAlpha = clamp01((t - appear) / map.fadeIn);

    if (o.kind === 'spinner') {
      this.updateSpinner(d, o, t, fadeInAlpha);
      return;
    }

    // Head circle (circles and slider heads).
    let headAlpha = fadeInAlpha;
    let headScale = 1;
    if (map.hidden) headAlpha = Math.min(headAlpha, 1 - clamp01((t - appear - map.fadeIn) / (map.preempt * 0.3)));
    if (j.hitTime !== null && t >= j.hitTime) {
      const k = clamp01((t - j.hitTime) / HIT_FADE);
      headScale = 1 + 0.4 * k;
      headAlpha = map.hidden ? 0 : (1 - k) * fadeInAlpha;
    } else if (j.hitTime === null) {
      const missAt = o.kind === 'circle' ? j.resultTime : Math.min(j.resultTime, o.start + 200 - 10 * map.od);
      if (t >= missAt) headAlpha *= 1 - clamp01((t - missAt) / MISS_FADE);
    }
    if (d.head) {
      d.head.root.alpha = headAlpha;
      d.head.root.scale.set(headScale);
      const light = hitLightAt(t, j.hitTime);
      d.head.light.visible = light.visible;
      if (light.visible) {
        d.head.light.alpha = light.alpha;
        d.head.light.scale.set(light.scale);
      }
    }
    if (d.skinStart) {
      d.skinStart.alpha = headAlpha;
      d.skinStart.scale.set(headScale);
      d.skinStart.visible = headAlpha > 0.01;
    }

    // Approach circle: shrinks from 4× to 1× over the preempt time. Hidden removes all but the first.
    if (d.approach) {
      const showApproach = !map.hidden || o.index === 0;
      const until = j.hitTime ?? o.start;
      const visible = showApproach && t < until;
      d.approach.visible = visible && !d.skinApproach;
      if (d.skinApproach) d.skinApproach.visible = visible;
      if (visible) {
        const p = clamp01((t - appear) / map.preempt);
        const factor = 4 - 3 * p;
        d.approach.scale.set(factor);
        d.approach.alpha = 0.9 * clamp01((t - appear) / Math.min(map.fadeIn * 2, map.preempt));
        if (d.skinApproach) {
          d.skinApproach.width = d.skinApproach.height = map.radius * 2 * factor;
          d.skinApproach.alpha = d.approach.alpha;
        }
      }
    }

    if (o.kind === 'slider') this.updateSlider(d, o, t, fadeInAlpha);
  }

  private updateSlider(d: Display, s: SliderObj, t: number, fadeInAlpha: number) {
    const map = this.map!;
    const j = this.judgement!.objects[s.index];
    const r = map.radius;
    const appear = s.start - map.preempt;

    // Body alpha: fade in, hold, fade out after the end (or across the slider with HD).
    let bodyAlpha = fadeInAlpha;
    if (map.hidden) bodyAlpha *= 1 - clamp01((t - appear - map.fadeIn) / Math.max(1, s.end - appear - map.fadeIn));
    if (t > s.end) bodyAlpha *= 1 - clamp01((t - s.end) / SLIDER_FADE);
    d.bodyAlpha!.alpha = bodyAlpha;
    d.decor!.alpha = bodyAlpha;
    if (d.skinEnd) {
      d.skinEnd.alpha = bodyAlpha;
      d.skinEnd.visible = bodyAlpha > 0.01;
    }

    // Snaking: the body grows along its path over the first third of the approach.
    const snake = clamp01((t - appear) / (map.preempt / 3));
    if (Math.abs(snake - (d.bodyProgress ?? -1)) > 0.004 || (snake === 1 && d.bodyProgress !== 1)) {
      d.bodyProgress = snake;
      this.drawSliderBody(d, s, snake);
    }

    // Ticks (current span only) and reverse arrows.
    const g = d.decor!;
    g.clear();
    const curSpan = t < s.start ? 0 : Math.min(Math.floor((t - s.start) / s.spanDuration), s.spans - 1);
    s.parts.forEach((p, k) => {
      if (p.kind === 'tick' && p.span === curSpan && p.t > t && snake >= 1) g.circle(p.x, p.y, r * 0.12).fill({ color: 0xffffff });
      void k;
    });
    const nextRepeats = s.parts.filter((p) => p.kind === 'repeat' && p.t > t);
    const drawn = new Set<number>();
    for (const rep of nextRepeats) {
      const atEnd = rep.span % 2 === 0; // repeat at the end of an even span is at the far end
      const key = atEnd ? 1 : 0;
      if (drawn.has(key) || (atEnd && snake < 1)) continue;
      drawn.add(key);
      if (!this.skinTextures.reversearrow) this.drawArrow(g, s, atEnd, r);
    }

    if (d.reverseStart) {
      d.reverseStart.visible = drawn.has(0);
      d.reverseStart.alpha = bodyAlpha;
    }
    if (d.reverseEnd) {
      d.reverseEnd.visible = drawn.has(1);
      d.reverseEnd.alpha = bodyAlpha;
    }

    // Ball and follow circle while the slider is running.
    const running = t >= s.start && t <= s.end;
    d.ball!.visible = running && !d.skinBall;
    if (d.skinBall) d.skinBall.visible = running;
    if (running) {
      const b = sliderBallAt(s, t);
      d.ball!.position.set(b.x, b.y);
      d.follow!.position.set(b.x, b.y);
      if (d.skinBall) {
        d.skinBall.position.set(b.x, b.y);
        if (this.sliderBallTextures.length > 1) {
          d.skinBall.texture = this.sliderBallTextures[sliderBallFrame(t, this.sliderBallTextures.length)];
        }
        const span = Math.max(0, Math.min(s.spans - 1, Math.floor((t - s.start) / Math.max(1, s.spanDuration))));
        const reverse = this.skinConfig.sliderBallFlip && span % 2 === 1;
        d.skinBall.scale.x = Math.abs(d.skinBall.scale.x) * (reverse ? -1 : 1);
      }
      if (d.skinFollow) d.skinFollow.position.set(b.x, b.y);
      const tracking = j.tracking?.some(([a, e]) => t >= a && t <= e) ?? false;
      d.follow!.visible = tracking && !d.skinFollow;
      if (d.skinFollow) d.skinFollow.visible = tracking;
    } else {
      d.follow!.visible = false;
      if (d.skinFollow) d.skinFollow.visible = false;
    }
  }

  private drawSliderBody(d: Display, s: SliderObj, progress: number) {
    const r = this.map!.radius;
    const color = skinComboColor(this.map!.comboColors, s.comboColor, this.skinConfig.comboColors);
    const track = this.skinConfig.sliderTrackOverride ?? color;
    const pts = partialPath(s.path, d.cumLen!, progress);
    const g = d.body!;
    g.clear();
    if (pts.length < 2) {
      g.circle(s.x, s.y, r * 0.93).fill({ color: 0xffffff });
      return;
    }
    const stroke = (width: number, color: number) => {
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ width, color, join: 'round', cap: 'round' });
    };
    stroke(r * 2 * 0.98, this.skinConfig.sliderBorder ?? 0xffffff); // border
    stroke(r * 2 * 0.84, shade(track, 0.28)); // track edge
    stroke(r * 2 * 0.6, shade(track, 0.42)); // track middle (lighter, like stable's gradient)
  }

  private drawArrow(g: Graphics, s: SliderObj, atEnd: boolean, r: number) {
    const path = s.path;
    const p = atEnd ? path[path.length - 1] : path[0];
    const q = atEnd ? path[Math.max(0, path.length - 4)] : path[Math.min(path.length - 1, 3)];
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const sz = r * 0.5;
    const pt = (a: number, l: number) => ({ x: p.x + Math.cos(ang + a) * l, y: p.y + Math.sin(ang + a) * l });
    const tip = pt(0, sz);
    const l = pt(Math.PI * 0.75, sz);
    const rr = pt(-Math.PI * 0.75, sz);
    g.moveTo(l.x, l.y).lineTo(tip.x, tip.y).lineTo(rr.x, rr.y).stroke({ width: r * 0.16, color: 0xffffff, cap: 'round', join: 'round' });
  }

  private updateSpinner(d: Display, s: SpinnerObj, t: number, fadeInAlpha: number) {
    const map = this.map!;
    let a = fadeInAlpha;
    if (t > s.end) a *= 1 - clamp01((t - s.end) / SLIDER_FADE);
    d.root.alpha = a;
    const p = clamp01((t - s.start) / Math.max(1, s.end - s.start));
    const approachScale = Math.max(0.02, 1 - p);
    d.spinnerRing!.scale.set(approachScale);
    d.spinnerRing!.visible = !d.skinSpinnerApproach && t >= s.start && t <= s.end;
    if (d.skinSpinnerApproach) {
      d.skinSpinnerApproach.scale.set(approachScale);
      d.skinSpinnerApproach.visible = t >= s.start && t <= s.end;
    }
    // Spin the disc with the player's cursor angle while held.
    const c = cursorAt(this.frames, t, this.frameHint);
    if (t >= s.start && t <= s.end && c.keys & (KEY.M1 | KEY.M2)) {
      const angle = Math.atan2(c.y - 192, c.x - 256);
      d.spinnerDisc!.rotation = angle;
      if (d.skinSpinnerDisc) d.skinSpinnerDisc.rotation = angle;
    }
    void map;
  }

  private updateFlashlight(t: number) {
    const g = this.flashGfx;
    g.clear();
    const map = this.map;
    if (!map?.mods.includes('FL') || !this.frames.length) return;
    const combo = this.judgement ? eventAt(this.judgement, t)?.combo ?? 0 : 0;
    const inBreak = map.breaks.some((b) => t >= b.start && t <= b.end);
    const radius = flashlightRadius(combo, inBreak);
    const cursor = cursorAt(this.frames, t, this.frameHint);
    g.rect(0, 0, 512, 384).fill({ color: 0x000000, alpha: 0.9 });
    g.circle(cursor.x, cursor.y, radius).cut();
    const tracking = this.trackingRanges.some(([start, end]) => t >= start && t <= end);
    const dim = flashlightTrackDim(tracking);
    if (dim > 0) g.circle(cursor.x, cursor.y, radius).fill({ color: 0x000000, alpha: dim });
  }

  private updateFollowPoints(t: number) {
    const g = this.followGfx;
    g.clear();
    const map = this.map;
    if (!map || !this.followPoints.length) return;
    const window = 300;
    let i = firstFollowPointAtOrAfter(this.followPoints, t - window);
    for (; i < this.followPoints.length; i++) {
      const point = this.followPoints[i];
      if (point.t > t + window) break;
      const dt = point.t - t;
      const alpha = dt >= 0 ? 1 - dt / window : 1 + dt / window;
      if (alpha <= 0) continue;
      g.circle(point.x, point.y, map.radius * 0.18).fill({ color: 0xffffff, alpha: alpha * 0.8 });
    }
  }

  private updateJudgements(t: number) {
    const keep = new Set<number>();
    this.resultEvents.forEach((e, i) => {
      if (t < e.t || t > e.t + JUDGEMENT_SHOW) return;
      keep.add(i);
      let txt = this.judgementTexts.get(i);
      if (!txt) {
        const color = e.result === 100 ? 0x5fe36b : e.result === 50 ? 0x5fb4ff : 0xff3b3b;
        txt = new Text({ text: e.result === 0 ? '✕' : String(e.result), style: { fontFamily: FONT, fontSize: e.result === 0 ? 34 : 26, fontWeight: '700', fill: color, dropShadow: { color: 0x000000, alpha: 0.6, blur: 2, distance: 1 } } });
        txt.anchor.set(0.5);
        txt.resolution = this.textResolution();
        txt.position.set(e.x, e.y);
        this.judgementLayer.addChild(txt);
        this.judgementTexts.set(i, txt);
      }
      const k = (t - e.t) / JUDGEMENT_SHOW;
      txt.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      txt.scale.set(e.result === 0 ? 1 + 0.2 * (1 - Math.min(1, k * 4)) : 0.9 + 0.1 * Math.min(1, k * 6));
      txt.y = e.y + (e.result === 0 ? k * 12 : 0);
    });
    for (const [i, txt] of this.judgementTexts) {
      if (!keep.has(i)) {
        txt.destroy();
        this.judgementTexts.delete(i);
      }
    }
  }

  private updateCursor(t: number) {
    const g = this.cursorGfx;
    g.clear();
    if (!this.frames.length) {
      for (const sprite of this.cursorTrailSprites) sprite.visible = false;
      this.cursorSprite.visible = false;
      this.cursorMiddleSprite.visible = false;
      return;
    }
    const c = cursorAt(this.frames, t, this.frameHint);
    this.frameHint = c.index;
    const customTrail = Boolean(this.skinTextures.cursortrail);
    for (const sprite of this.cursorTrailSprites) sprite.visible = false;
    if (this.options.showCursorTrail) {
      for (let k = 12; k >= 1; k--) {
        const p = cursorAt(this.frames, t - k * 6, Math.max(0, c.index - 8));
        if (customTrail) {
          const sprite = this.cursorTrailSprites[k - 1];
          sprite.visible = true;
          sprite.position.set(p.x, p.y);
          sprite.alpha = 0.8 * (1 - k / 13);
        } else {
          g.circle(p.x, p.y, 7 * (1 - k / 16)).fill({ color: 0xffe08a, alpha: 0.35 * (1 - k / 13) });
        }
      }
    }
    const pressed = (c.keys & (KEY.M1 | KEY.M2)) !== 0;
    const factor = pressed && this.skinConfig.cursorExpand ? 1.12 : 1;
    if (this.cursorSprite.visible) {
      this.cursorSprite.position.set(c.x, c.y);
      this.cursorSprite.rotation = this.skinConfig.cursorRotate ? Math.atan2(c.y - 192, c.x - 256) : 0;
      this.cursorSprite.scale.set(this.cursorBaseScale.x * factor, this.cursorBaseScale.y * factor);
    } else {
      g.circle(c.x, c.y, pressed ? 11 : 9.5).fill({ color: 0xffe08a, alpha: 0.95 }).stroke({ width: 2, color: 0xffffff });
    }
    const middle = Boolean(this.skinTextures.cursormiddle);
    this.cursorMiddleSprite.visible = middle;
    if (middle) {
      const size = 64 * this.skinConfig.cursorScale * factor;
      this.cursorMiddleSprite.position.set(c.x, c.y);
      this.cursorMiddleSprite.width = size;
      this.cursorMiddleSprite.height = size;
    }
  }

  private updateHud(t: number) {
    const e = this.judgement ? eventAt(this.judgement, t) : null;
    this.comboText.text = `${e?.combo ?? 0}x`;
    this.accText.text = `${((e?.accuracy ?? 1) * 100).toFixed(2)}%`;
    this.scoreText.text = scoreHudLabel(e?.score);
    const c = this.frames.length ? cursorAt(this.frames, t, this.frameHint) : null;
    for (const k of this.keyBoxes) {
      k.g.visible = k.label.visible = k.count.visible = this.options.showKeyOverlay;
      const size = (k.g as Graphics & { _size?: number })._size ?? 34;
      const down = c ? (c.keys & k.mask) === k.mask && !(k.mask === KEY.M1 && c.keys & KEY.K1) && !(k.mask === KEY.M2 && c.keys & KEY.K2) : false;
      k.g.clear();
      k.g.roundRect(0, 0, size, size, size * 0.15).fill({ color: down ? 0xffcc22 : 0x000000, alpha: down ? 0.9 : 0.35 }).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
      k.label.style.fill = down ? 0x000000 : 0xffffff;
      k.count.text = String(countUpTo(k.presses, t));
    }
  }

  destroy() {
    this.clearObjects();
    this.app.destroy(true, { children: true });
  }
}

function countUpTo(sorted: number[], t: number) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Path points from the head up to `progress` of the total length. */
export function partialPath(path: Vec[], cum: number[], progress: number): Vec[] {
  if (progress >= 1) return path;
  const total = cum[cum.length - 1];
  const target = total * progress;
  const out: Vec[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (cum[i] <= target) {
      out.push(path[i]);
      continue;
    }
    const seg = cum[i] - cum[i - 1];
    const k = seg > 0 ? (target - cum[i - 1]) / seg : 0;
    out.push({ x: path[i - 1].x + (path[i].x - path[i - 1].x) * k, y: path[i - 1].y + (path[i].y - path[i - 1].y) * k });
    break;
  }
  return out;
}
