/**
 * PixiJS combat renderer — owns main #c WebGL canvas.
 * Game logic / DOM HUD unchanged. Falls back if PIXI missing.
 */
(function () {
  'use strict';
  const MAX_ENEMY = 220;
  const MAX_TERRAIN = 180;
  const MAX_FX = 120;
  const MAX_GEM = 80;
  const MAX_PROJ = 100;
  // dzmm: keep original cultivation sheet skill FX (not SpineSkillFx)
  const USE_SPINE_SKILL_FX = false;
  window.__DZMM_SKILL_SHEETS = true;

  let app = null;
  let world = null;
  let layers = {};
  let ready = false;
  let initPromise = null;
  let baseScale = 1;
  let texCache = new Map(); // key -> { source, frames: Map }
  let playerSpr = null;
  let playerSpineTex = null;
  let playerSpineCls = null;
  let fxOverlaySpr = null;
  let fxOverlayTex = null;
  let skillPool = [];
  let skillSpinePool = [];
  let enemyPool = [];
  let barPool = [];
  let terrainPool = [];
  let gemPool = [];
  let projPool = [];
  let relicPool = [];
  let txtPool = [];
  let fxGfx = null;
  let spineFrameTick = 0;
  let skillFxDt = 1 / 60;
  let bgFill = null;
  let bgTiles = [];
  let lastBgKey = '';
  let shakeX = 0, shakeY = 0;
  let groundTile = null;

  function PIXI() { return window.PIXI; }

  function visible(x, y, m = 120) {
    return x > CAMX - m && x < CAMX + W + m && y > CAMY - m && y < CAMY + H + m;
  }

  const COMBAT_DPR_CAP = 1.75; // FPS: 2.5 fills too many pixels

  function ensureAppSize(cw, ch, dpr) {
    if (!app?.renderer) return;
    const res = Math.min(Math.max(dpr || 1, 1), COMBAT_DPR_CAP);
    app.renderer.resolution = res;
    app.renderer.resize(Math.max(1, cw), Math.max(1, ch));
  }

  function setTexLinear(source) {
    if (!source) return;
    try {
      if (source.scaleMode != null) source.scaleMode = 'linear';
      if (source.autoGenerateMipmaps != null) source.autoGenerateMipmaps = false;
      if (source.mipmap != null) source.mipmap = false;
      if (source.style) {
        if (source.style.scaleMode != null) source.style.scaleMode = 'linear';
        try {
          source.style.addressMode = 'clamp-to-edge';
        } catch (_) {}
      }
    } catch (_) {}
  }

  function getImgFrames(img, cols, rows) {
    if (!img?.complete || !img.naturalWidth) return null;
    const key = (img.src || String(img)) + '|' + cols + 'x' + rows + '|lin-v2';
    let pack = texCache.get(key);
    if (pack) {
      setTexLinear(pack.source);
      return pack;
    }
    const P = PIXI();
    let source = null;
    try {
      const base = P.Texture.from(img);
      source = base.source;
    } catch (_) {
      source = null;
    }
    if (!source) {
      try {
        source = new P.ImageSource({ resource: img });
      } catch (e) {
        console.warn('[PixiCombat] texture source failed', e.message);
        return null;
      }
    }
    setTexLinear(source);
    const fw = img.naturalWidth / cols;
    const fh = img.naturalHeight / rows;
    const frames = new Map();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * fw);
        const y0 = Math.floor(r * fh);
        const x1 = Math.floor((c + 1) * fw);
        const y1 = Math.floor((r + 1) * fh);
        const frame = new P.Rectangle(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        const tex = new P.Texture({ source, frame });
        frames.set(r + ',' + c, tex);
      }
    }
    pack = { source, frames, fw, fh, ratio: fh / fw };
    texCache.set(key, pack);
    return pack;
  }

  function frameTex(img, cols, rows, col, row) {
    const pack = getImgFrames(img, cols, rows);
    if (!pack) return null;
    return pack.frames.get(row + ',' + (col % cols)) || null;
  }

  function acquire(pool, factory, parent) {
    let s = pool.find((x) => !x._used);
    if (!s) {
      s = factory();
      parent.addChild(s);
      pool.push(s);
    } else if (parent && s.parent !== parent) {
      parent.addChild(s);
    }
    s._used = true;
    s.visible = true;
    return s;
  }

  function releaseAll(pool) {
    for (const s of pool) {
      s._used = false;
      s.visible = false;
    }
  }

  function makeSprite() {
    const P = PIXI();
    const s = new P.Sprite(P.Texture.EMPTY);
    s.anchor.set(0.5, 0.5);
    s._used = false;
    s.visible = false;
    return s;
  }

  function cssColor(c) {
    if (typeof c === 'number' && Number.isFinite(c)) return c >>> 0;
    if (typeof c !== 'string' || !c) return 0xffffff;
    let h = c.trim();
    if (h[0] === '#') {
      if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
      const n = parseInt(h.slice(1, 7), 16);
      return Number.isFinite(n) ? n : 0xffffff;
    }
    return 0xffffff;
  }

  function makeDmgText() {
    const P = PIXI();
    const style = {
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 'bold',
      fill: 0xffffff,
      stroke: { color: 0x0f172a, width: 4 },
      align: 'center',
      dropShadow: {
        color: 0x000000,
        alpha: 0.55,
        blur: 2,
        distance: 0,
      },
    };
    let t;
    try {
      t = new P.Text({ text: ' ', style });
    } catch (_) {
      t = new P.Text(' ', style);
    }
    if (t.anchor?.set) t.anchor.set(0.5, 0.5);
    t._used = false;
    t.visible = false;
    return t;
  }

  function putDmgText(part) {
    if (!part?.txt || !layers.txt) return;
    const t = acquire(txtPool, makeDmgText, layers.txt);
    const crit = !!part.crit;
    const fill = cssColor(part.c || (crit ? '#fde047' : '#f8fafc'));
    try {
      t.style.fontSize = crit ? 22 : 16;
      t.style.fill = fill;
      t.style.stroke = { color: 0x0f172a, width: crit ? 5 : 4 };
      if (t.style.dropShadow && typeof t.style.dropShadow === 'object') {
        t.style.dropShadow.color = crit ? 0xfacc15 : 0x000000;
        t.style.dropShadow.blur = crit ? 6 : 2;
        t.style.dropShadow.alpha = crit ? 0.7 : 0.55;
      }
    } catch (_) {}
    t.text = String(part.txt);
    t.alpha = Math.max(0.2, Math.min(1, part.a == null ? 1 : part.a));
    t.position.set(part.x, part.y);
    t.zIndex = 50;
  }

  function makeEnemySpineSlot() {
    const s = makeSprite();
    const cell = window.SpineEnemies?.CELL || 192;
    s._spineCanvas = document.createElement('canvas');
    s._spineCanvas.width = cell;
    s._spineCanvas.height = cell;
    s._spineTex = null;
    return s;
  }

  function makeSkillSpineSlot() {
    const s = makeSprite();
    const cell = window.SpineSkillFx?.CELL || 256;
    s._spineCanvas = document.createElement('canvas');
    s._spineCanvas.width = cell;
    s._spineCanvas.height = cell;
    s._spineTex = null;
    return s;
  }

  /**
   * Atlas FX is baked into a SQUARE cell (letterboxed).
   * Always display with uniform scale — never set unequal w/h (that stretches/skews art).
   * Combat range drives the square side length; aspect lives inside the atlas frame.
   */
  function fxDisplaySide(host, spec, size, opts) {
    const nat = Math.max(spec?.w || 0, spec?.h || 0, 48);
    const o = opts || {};
    // Equal explicit sides
    if (o.w > 0 && o.h > 0 && Math.abs(o.w - o.h) < 2) return o.w;
    // Area / field: diameter from rad
    if (host?.rad > 0) return Math.max(host.size || 0, host.rad * 2, nat);
    // Caller asked for a single side
    if (o.side > 0) return o.side;
    const combat = Math.max(host?.size || 0, size || 0, o.size || 0);
    if (combat > 0) {
      // Grow toward combat size but don't explode tiny art into huge blurry squares
      return Math.max(nat * 0.85, Math.min(combat, nat * 2.6));
    }
    return nat;
  }

  /** Draw atlas FX; square by default. Beams may stretch via beamLen×beamThick. Returns true if drawn. */
  function putSpineFx(host, kind, x, y, size, rot, alpha, extra) {
    if (!USE_SPINE_SKILL_FX) return false;
    const SF = window.SpineSkillFx;
    if (!SF?.hasKind?.(kind) || !SF.renderFx || !host) return false;
    kind = SF.resolveKindAlias?.(kind) || kind;
    const opts = Object.assign({ kind, size }, extra || {});
    if (isScytheFx(kind) && opts.softEdge == null && !(opts.beamLen > 0)) opts.softEdge = true;
    const spec = SF.resolveSpec?.(kind, opts) || null;
    const side = fxDisplaySide(host, spec, size || 80, opts);
    const beamLen = opts.beamLen > 0 ? opts.beamLen : 0;
    const beamThick = opts.beamThick > 0 ? opts.beamThick : 0;
    const margin = (beamLen || side) + 80;
    if (!visible(x, y, margin)) return false;
    const P = PIXI();
    const spr = acquire(skillSpinePool, makeSkillSpineSlot, layers.skills);
    const cell = SF.CELL || 256;
    if (!spr._spineCanvas) {
      spr._spineCanvas = document.createElement('canvas');
      spr._spineCanvas.width = cell;
      spr._spineCanvas.height = cell;
    }
    const cv = SF.renderFx(host, skillFxDt, spr._spineCanvas, opts);
    if (!cv) {
      spr.visible = false;
      spr._used = false;
      return false;
    }
    if (!spr._spineTex) spr._spineTex = P.Texture.from(spr._spineCanvas);
    else if (spr._spineTex.source?.update) spr._spineTex.source.update();
    else if (spr._spineTex.baseTexture?.update) spr._spineTex.baseTexture.update();
    spr.texture = spr._spineTex;
    if (beamLen > 0) {
      // 射线：沿长度拉伸 atlas 激光帧（禁止手绘线段）
      spr.width = beamLen;
      spr.height = Math.max(22, beamThick || Math.min(64, beamLen * 0.12));
    } else {
      // 普通特效：正方形，避免非等比拉伸变形
      spr.width = side;
      spr.height = side;
    }
    spr.x = x;
    spr.y = y;
    const rotOff = (opts.rotOff != null ? opts.rotOff : null) ?? (host && host.rotOff != null ? host.rotOff : null) ?? (spec?.rotOff || 0);
    if (spec?.align || opts.forceRot || beamLen > 0) spr.rotation = (rot || 0) + rotOff;
    else spr.rotation = 0;
    // 风刃等需要水平镜像以匹配射向（在设置 width 之后再翻）
    const flip = !!(opts.flipX || host?.flipX);
    if (flip) spr.scale.x = -Math.abs(spr.scale.x);
    else if (spr.scale.x < 0) spr.scale.x = Math.abs(spr.scale.x);
    spr.alpha = alpha == null ? 1 : alpha;
    return true;
  }

  /** 两点之间的拉伸特效（灵束 / 雷链） */
  function putBeamSpine(host, kind, x1, y1, x2, y2, thick, alpha, extra) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const rot = Math.atan2(y2 - y1, x2 - x1);
    return putSpineFx(host, kind, mx, my, len, rot, alpha, Object.assign({
      beamLen: len,
      beamThick: thick,
      play: 'loop',
      loop: true,
      forceRot: true,
      role: kind === 'beam' || kind === 'holy' || kind === 'arcaneBeam' ? 'beam' : undefined
    }, extra || {}));
  }

  function isScytheFx(key) {
    return (
      key === 'scytheArc' ||
      key === 'deathWaltz' ||
      key === 'bloodScythe' ||
      key === 'bloodReap' ||
      key === 'wraithBlade' ||
      key === 'reaperChain' ||
      key === 'graveRift' ||
      key === 'soulReaper'
    );
  }

  /** 琦琦特效：寿命内保持高亮，避免淡到看不见 */
  function scytheAlpha(lifeA) {
    return Math.min(1, Math.max(0.85, 0.62 + (lifeA || 0) * 0.45));
  }

  /** 柔和范围光晕：不用描边多边形，避免棱角 */
  function drawSoftGlow(x, y, rad, color, alpha) {
    if (!fxGfx || !(rad > 8)) return;
    const a = alpha == null ? 0.22 : alpha;
    fxGfx.circle(x, y, rad);
    fxGfx.fill({ color: color || 0xc084fc, alpha: a * 0.35 });
    fxGfx.circle(x, y, rad * 0.72);
    fxGfx.fill({ color: color || 0xc084fc, alpha: a * 0.22 });
  }

  function parseCssColor(c) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c !== 'string') return 0xfb7185;
    const s = c.trim();
    if (s[0] === '#' && (s.length === 7 || s.length === 4)) {
      if (s.length === 4) {
        return (
          (parseInt(s[1] + s[1], 16) << 16) |
          (parseInt(s[2] + s[2], 16) << 8) |
          parseInt(s[3] + s[3], 16)
        );
      }
      return parseInt(s.slice(1), 16);
    }
    return 0xfb7185;
  }

  function enemyShotColor(s) {
    if (s?.freeze) return 0x67e8f9;
    const c = s?.attr?.color || s?.color;
    if (c) return parseCssColor(c);
    return 0xfb7185;
  }

  /** 小怪弹幕：光晕 + 彗星拖尾 + 闪点（低画质自动减层） */
  function drawEnemyShotFx(s, t, fr4) {
    if (!s) return;
    const q = window.fxQuality || 'medium';
    if (q === 'off') return;
    const rich = q !== 'low';
    const glow = enemyShotColor(s);
    const core = s.freeze ? 0xe0f2fe : 0xffffff;
    const pulse = 0.85 + 0.15 * Math.sin((t || 0) * 14 + (s.x || 0) * 0.02);
    const sz = s.freeze ? 38 : 34;
    const spd = Math.hypot(s.vx || 0, s.vy || 0) || 1;
    const bx = -(s.vx || 0) / spd;
    const by = -(s.vy || 0) / spd;
    const trailLen = rich ? 56 : 36;

    if (fxGfx) {
      // 外圈危险光晕
      fxGfx.circle(s.x, s.y, sz * 0.85 * pulse);
      fxGfx.fill({ color: glow, alpha: 0.2 });
      fxGfx.circle(s.x, s.y, sz * 0.5);
      fxGfx.fill({ color: glow, alpha: 0.34 });

      // 速度方向彗星拖尾（多层粗流光）
      const layersN = rich ? 4 : 2;
      for (let L = 0; L < layersN; L++) {
        const lw = [26, 16, 8, 3.5][L] || 4;
        const la = [0.12, 0.2, 0.42, 0.82][L] || 0.25;
        const col = L >= 3 ? core : glow;
        const segs = rich ? 7 : 4;
        for (let i = 0; i < segs; i++) {
          const u0 = i / segs;
          const u1 = (i + 1) / segs;
          const fade = (1 - u1) * (1 - u1);
          fxGfx.moveTo(s.x + bx * trailLen * u0, s.y + by * trailLen * u0);
          fxGfx.lineTo(s.x + bx * trailLen * u1, s.y + by * trailLen * u1);
          fxGfx.stroke({
            width: Math.max(2, lw * (0.45 + 0.55 * (1 - u1))),
            color: col,
            alpha: la * fade * pulse
          });
        }
      }

      // 短位姿丝带（更粗更柔）
      if (rich) {
        s.__trail = s.__trail || [];
        const tr = s.__trail;
        const last = tr[tr.length - 1];
        if (!last || Math.hypot(s.x - last.x, s.y - last.y) > 4) {
          tr.push({ x: s.x, y: s.y });
          while (tr.length > 10) tr.shift();
        } else {
          last.x = s.x;
          last.y = s.y;
        }
        for (let i = 1; i < tr.length; i++) {
          const fade = i / (tr.length - 1);
          fxGfx.moveTo(tr[i - 1].x, tr[i - 1].y);
          fxGfx.lineTo(tr[i].x, tr[i].y);
          fxGfx.stroke({
            width: 6.5 * fade,
            color: glow,
            alpha: 0.28 * fade
          });
        }
      }

      // 环绕闪点
      const sparks = rich ? 3 : 1;
      for (let i = 0; i < sparks; i++) {
        const ang = (t || 0) * (s.freeze ? 6 : 9) + i * 2.1 + (s.rot || 0);
        const rr = 10 + (i % 2) * 4;
        const sx = s.x + Math.cos(ang) * rr;
        const sy = s.y + Math.sin(ang) * rr;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin((t || 0) * 12 + i * 1.7));
        fxGfx.circle(sx, sy, 1.4 + tw * 1.6);
        fxGfx.fill({ color: core, alpha: 0.35 + 0.4 * tw });
        if (rich) {
          fxGfx.circle(sx, sy, 3.5 + tw);
          fxGfx.fill({ color: glow, alpha: 0.1 + 0.12 * tw });
        }
      }

      // 亮芯
      fxGfx.circle(s.x, s.y, 5.5 * pulse);
      fxGfx.fill({ color: core, alpha: 0.85 });
      fxGfx.circle(s.x, s.y, 2.4);
      fxGfx.fill({ color: 0xffffff, alpha: 0.95 });

      // 冰弹额外寒气环
      if (s.freeze && rich) {
        fxGfx.circle(s.x, s.y, 16 + Math.sin((t || 0) * 10) * 2);
        fxGfx.stroke({ width: 1.5, color: 0xa5f3fc, alpha: 0.35 });
      }
    }

    const img = window.imgs?.enemyOrb;
    if (img?.complete) {
      putSheetSpr(
        projPool,
        layers.fxFront,
        img,
        s.x,
        s.y,
        sz,
        sz,
        fr4,
        2,
        2,
        s.rot || 0,
        0.95
      );
    }
  }

  function putGunSheetFx(host, category) {
    const img = ensureSkillImg('gunslingerSkillFx') || ensureSkillImg('gunslingerFx');
    if (!img?.complete || !host) return false;
    const now = S?.time || 0;
    const fr = host.frame ?? host.frameIndex ?? Math.floor(now * 12) % 4;
    const a = host.life != null && host.max ? Math.max(0, Math.min(1, host.life / host.max)) : 1;
    const cols = 4;
    if (category === 'proj') {
      // 飞墨点锋：放大墨锋弹道
      const frame = host.frameIndex != null ? host.frameIndex : (fr % 4);
      const len = Math.max(108, host.size || 118);
      const thick = Math.max(64, len * 0.7);
      putSheetSpr(skillPool, layers.skills, img, host.x, host.y, len, thick, frame, cols, cols, host.rot || 0, 1);
      return true;
    }
    if (category === 'fall') {
      const side = host.size || 56;
      putSheetSpr(skillPool, layers.skills, img, host.x, host.y, side, side, host.frameIndex ?? (fr % 4), cols, cols, host.rot || 0, 0.95);
      return true;
    }
    if (category === 'slash') {
      const side = Math.min(240, Math.max(140, host.size || 200));
      putSheetSpr(skillPool, layers.skills, img, host.x, host.y, side, side, fr % 4, cols, cols, host.rot || 0, a);
      return true;
    }
    // 泼墨闪身：朝攻击方向的扇形泼墨（图集 f4，素材朝右）
    const isSplash = host.type === 'shotgunRoll' || host.i === 4 || host.frameIndex === 4;
    if (isSplash) {
      const rot = host.rot || 0;
      const side = Math.max(220, host.size || 260);
      // 锚点偏左：墨团从身前泼出，扇面朝右再按 rot 转向目标
      putSheetSpr(
        skillPool, layers.skills, img,
        host.x, host.y, side * 1.15, side * 0.95, 4, cols, cols, rot, Math.max(0.7, a),
        { anchorX: 0.28, anchorY: 0.5, additive: true }
      );
      return true;
    }
    // 游墨连环：两点间拉伸墨迹 + 落点墨珠（否则只有落点小图看不清）
    const isRico = host.type === 'ricochetBullet' || host.i === 2 || host.frameIndex === 2;
    if (host.fromX != null && isRico) {
      const dx = host.x - host.fromX;
      const dy = host.y - host.fromY;
      const len = Math.hypot(dx, dy) || 1;
      const rot = Math.atan2(dy, dx);
      const thick = Math.max(42, Math.min(88, (host.size || 156) * 0.48));
      putSheetSpr(
        skillPool, layers.skills, img,
        (host.fromX + host.x) / 2, (host.fromY + host.y) / 2,
        Math.max(len, 48), thick, 2, cols, cols, rot, Math.max(0.6, a)
      );
      const hit = Math.max(120, host.size || 156);
      putSheetSpr(skillPool, layers.skills, img, host.x, host.y, hit, hit, 2, cols, cols, rot, a);
      return true;
    }
    const side = host.size || 120;
    const frame = host.i != null ? host.i : fr % 4;
    putSheetSpr(skillPool, layers.skills, img, host.x, host.y, side, side, frame, cols, cols, host.rot || 0, a);
    return true;
  }

  /** 御剑：dzmm 用 cultivation 图集；Spine 技能特效默认关闭 */
  function putGunFx(host, category) {
    if (!USE_SPINE_SKILL_FX) return putGunSheetFx(host, category);
    const SF = window.SpineSkillFx;
    if (!SF?.hasKind || !host) return putGunSheetFx(host, category);
    const type = host.type || host.kind;
    const fxKind = host.fxKind || (SF.hasKind(host.kind) ? host.kind : 'gunslingerSkillFx');
    const key = SF.hasKind(fxKind) ? fxKind : SF.hasKind(type) ? type : SF.hasKind(host.kind) ? host.kind : null;
    if (!key) return false;

    const a = host.life != null && host.max ? Math.max(0, Math.min(1, host.life / host.max)) : 1;
    const extra = {
      type,
      i: host.i,
      frame: host.frame,
      frameIndex: host.frameIndex,
      life: host.life,
      max: host.max,
      burn: !!host.burn,
      size: host.size
    };

    if (category === 'proj') {
      extra.role = 'proj';
      extra.play = 'loop';
      extra.loop = true;
      // 飞行剑气：沿朝向拉长，像一道刺出的剑光
      const len = Math.max(96, host.size || 0, 120);
      const thick = 26;
      return putSpineFx(host, key, host.x, host.y, len, host.rot || 0, 0.95, Object.assign(extra, {
        beamLen: len,
        beamThick: thick,
        forceRot: true,
        side: len
      }));
    }

    if (category === 'fall') {
      extra.role = 'fall';
      extra.falling = true;
      extra.play = 'loop';
      extra.loop = true;
      // 燃心剑符坠落：火焰弹头，略大并朝向落点
      const side = host.kind === 'fireBomb' || host.fxKind === 'gunslingerSkillFx' ? 56 : 44;
      return putSpineFx(host, key, host.x, host.y, side, host.rot || 0, 0.95, Object.assign(extra, {
        side, forceRot: true, type: 'fireBomb'
      }));
    }

    if (category === 'slash') {
      extra.type = host.kind === 'shotgunRoll' ? 'shotgunRoll' : host.kind;
      const kind = SF.hasKind(host.kind) ? host.kind : 'shotgunRoll';
      const side = Math.min(240, Math.max(140, host.size || 200));
      return putSpineFx(host, kind, host.x, host.y, side, host.rot || 0, a, Object.assign(extra, {
        side, kind, scrub: true, play: 'scrub'
      }));
    }

    // artFx
    if (host.burn || host.burnSkill === 'fireBomb') extra.role = 'burn';
    else if ((host.i === 9 || host.frameIndex === 9) && (type === 'quickShot' || key === 'gunslingerSkillFx')) extra.role = 'hit';

    const spec = SF.resolveSpec(key, extra);

    // 剑气折返：两点间拉伸剑气，禁止手绘黄线
    if ((spec?.skill === 'ricochetBullet' || type === 'ricochetBullet' || host.i === 2) && host.fromX != null) {
      if (!host.__qiHost) host.__qiHost = {};
      if (!host.__hitHost) host.__hitHost = {};
      const thick = Math.max(22, Math.min(40, (host.size || 82) * 0.28));
      putBeamSpine(host.__qiHost, 'ricochetBullet', host.fromX, host.fromY, host.x, host.y, thick, a, {
        life: host.life,
        max: host.max,
        type: 'ricochetBullet',
        play: 'loop',
        loop: true
      });
      putSpineFx(host.__hitHost, 'quickShotHit', host.x, host.y, 72, 0, a, {
        type: 'quickShot',
        role: 'hit',
        life: host.life,
        max: host.max,
        scrub: true,
        side: 72
      });
      return true;
    }

    // 燃心剑符持续火场：地面火圈 + 升腾火焰双层 loop（寿命内保持可见）
    if (host.burn || extra.role === 'burn' || spec?.skill === 'fireBombBurn') {
      const br = host.burnRad || host.rad || (host.size || 120) / 2;
      const side = Math.max(host.size || 0, br * 2, 140);
      const alpha = Math.max(0.5, Math.min(1, a * 0.85 + 0.35));
      if (!host.__burnGround) host.__burnGround = {};
      if (!host.__burnFlame) host.__burnFlame = {};
      putSpineFx(host.__burnGround, 'fireBombBurn', host.x, host.y, side, 0, alpha, {
        type: 'fireBomb',
        role: 'burn',
        play: 'loop',
        loop: true,
        side,
        size: side
      });
      putSpineFx(host.__burnFlame, 'fireBombBurnFlame', host.x, host.y - side * 0.08, side * 0.78, 0, alpha * 0.9, {
        type: 'fireBomb',
        play: 'loop',
        loop: true,
        side: side * 0.78,
        size: side * 0.78
      });
      return true;
    }

    let side = fxDisplaySide(host, spec, host.size || 90, extra);
    if (spec?.skill === 'shotgunRoll' && !host.size) {
      side = 200;
    } else if (spec?.skill === 'fireBomb' || host.i === 6 || host.frameIndex === 6) {
      // 落地爆炸：按伤害半径铺满
      const br = host.rad || (host.size || 120) / 2;
      side = Math.max(side, br * 2, 130);
    } else if (extra.role === 'hit') {
      side = Math.max(side, 88);
    }

    const play = spec?.play === 'loop' ? 'loop' : (spec?.play || 'scrub');
    return putSpineFx(host, key, host.x, host.y, side, host.rot || 0, a, Object.assign(extra, {
      side,
      play,
      loop: play === 'loop',
      scrub: play === 'scrub',
      type: type === 'dragon' ? 'fireBomb' : type
    }));
  }

  function makeBar() {
    const P = PIXI();
    const g = new P.Graphics();
    g._used = false;
    g.visible = false;
    return g;
  }

  async function init(canvas) {
    if (ready) return true;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const P = PIXI();
      if (!P || !canvas) {
        console.warn('[PixiCombat] PIXI or canvas missing');
        return false;
      }
      try {
        app = new P.Application();
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), COMBAT_DPR_CAP);
        await app.init({
          canvas,
          width: Math.max(1, canvas.clientWidth || 800),
          height: Math.max(1, canvas.clientHeight || 600),
          background: '#080b1b',
          antialias: false,
          resolution: dpr,
          autoDensity: true,
          preference: 'webgl',
          powerPreference: 'high-performance',
          roundPixels: true,
          hello: false
        });
        app.ticker.stop();

        world = new P.Container();
        app.stage.addChild(world);
        layers.bg = new P.Container();
        layers.terrain = new P.Container();
        layers.fxBack = new P.Container();
        layers.enemies = new P.Container();
        layers.bars = new P.Container();
        layers.player = new P.Container();
        layers.fxFront = new P.Container();
        layers.skills = new P.Container();
        // 职业神器单独顶层，避免被技能图集挡住
        layers.relic = new P.Container();
        // 伤害数字顶层
        layers.txt = new P.Container();
        layers.txt.sortableChildren = true;
        world.addChild(
          layers.bg,
          layers.terrain,
          layers.fxBack,
          layers.enemies,
          layers.bars,
          layers.player,
          layers.skills,
          layers.fxFront,
          layers.relic,
          layers.txt
        );

        bgFill = new P.Graphics();
        layers.bg.addChild(bgFill);
        fxGfx = new P.Graphics();
        layers.fxFront.addChild(fxGfx);

        fxOverlaySpr = makeSprite();
        fxOverlaySpr.anchor.set(0, 0);
        fxOverlaySpr.visible = false;
        app.stage.addChild(fxOverlaySpr);

        playerSpr = makeSprite();
        layers.player.addChild(playerSpr);
        playerSpr.visible = true;
        playerSpr._used = true;

        for (let i = 0; i < 48; i++) {
          const s = makeEnemySpineSlot();
          layers.enemies.addChild(s);
          enemyPool.push(s);
          const b = makeBar();
          layers.bars.addChild(b);
          barPool.push(b);
        }
        for (let i = 0; i < 30; i++) {
          const s = makeSprite();
          layers.terrain.addChild(s);
          terrainPool.push(s);
        }
        for (let i = 0; i < 96; i++) {
          const s = makeSprite();
          layers.fxBack.addChild(s);
          gemPool.push(s);
          const p = makeSprite();
          layers.skills.addChild(p);
          skillPool.push(p);
          const q = makeSprite();
          layers.fxFront.addChild(q);
          projPool.push(q);
        }
        for (let i = 0; i < 56; i++) {
          const s = makeSkillSpineSlot();
          layers.skills.addChild(s);
          skillSpinePool.push(s);
        }
        for (let i = 0; i < 6; i++) {
          const s = makeSprite();
          layers.relic.addChild(s);
          relicPool.push(s);
        }

        ready = true;
        console.info('[PixiCombat] ready');
        try {
          window.SpineEnemies?.ensureShared?.();
          window.SpineEnemies?.preloadCommon?.();
          if (USE_SPINE_SKILL_FX) {
            window.SpineSkillFx?.ensureShared?.();
            window.SpineSkillFx?.preloadCommon?.();
          }
        } catch (_) {}
        if (typeof resize === 'function') resize();
        return true;
      } catch (e) {
        console.error('[PixiCombat] init failed', e);
        ready = false;
        initPromise = null;
        try {
          window.__pixiCombatFailed = true;
          if (typeof window.__restoreMainCanvas2D === 'function') window.__restoreMainCanvas2D();
        } catch (_) {}
        return false;
      }
    })();
    return initPromise;
  }

  function resize(cw, ch, dpr, scale) {
    if (!ready || !app) return;
    baseScale = scale || 1;
    ensureAppSize(cw || canvas.clientWidth, ch || canvas.clientHeight, dpr || DPR);
    // Logical size matches game W/H via stage scale
    app.stage.scale.set(baseScale);
  }

  
  function ensureSkillImg(key) {
    if (!key) return null;
    let img = window.imgs?.[key];
    if (img?.complete && img.naturalWidth) return img;
    const alias = window.RiftWebGLAssetAliases?.[key];
    const resolved =
      window.AS?.[key] ||
      window.RiftWebGLAssets?.[key] ||
      (alias && (window.AS?.[alias] || window.RiftWebGLAssets?.[alias])) ||
      null;
    if (!resolved) return img || null;
    window.imgs = window.imgs || {};
    img = window.imgs[key] || (window.imgs[key] = new Image());
    img.crossOrigin = 'anonymous';
    const base = String(resolved).split('?')[0].replace(/^\.\//, '');
    const cur = String(img.src || '');
    if (!cur || cur.indexOf(base) < 0) {
      try { img.src = resolved; } catch (_) {}
    }
    return img;
  }

  /** Match Canvas drawSheet / drawGrid atlas layouts. */
  function sheetLayout(key) {
    if (key === 'gunslingerSkillFx' || key === 'gunslingerFx') return { cols: 4, rows: 4 };
    // artifactFx / artifactIcons: 5×2（帧 = 神器索引 f.i），不是技能 2×2
    if (key === 'artifactFx' || key === 'artifactIcons') return { cols: 5, rows: 2 };
    if (key === 'classRelics') return { cols: 3, rows: 2 };
    return { cols: 2, rows: 2 };
  }

  function sheetCols(key) {
    return sheetLayout(key).cols;
  }

  /** 仅光环/环绕类允许自旋；其余技能不转（可保留飞行朝向）。 */
  function isAuraOrbitKind(kind) {
    const k = String(kind || '');
    return (
      k === 'aura' ||
      k === 'garlic' ||
      k === 'orbit' ||
      k === 'star' ||
      k === 'flameWheel'
    );
  }

  /** 道君弹道：固定帧；飞剑剑尖对准飞行方向。 */
  const MAGE_FIXED_FRAME = {}; // ice/soul/missile/fire 各自动画

  /** 符剑图集剑尖朝向（画布 y 向下）：f0 朝下，f1/f2 朝右上。 */
  const MISSILE_TIP = [Math.PI / 2, -Math.PI / 4, -Math.PI / 4];
  /** 斩魂刃图集尖朝向（y 向下）：飞行帧 tip≈140°/138° */
  const WRAITH_TIP = [2.443461,2.408554];


  function missileFlightFrame(m) {
    if (m.frame != null) return ((m.frame % 3) + 3) % 3;
    return Math.floor((m.age || 0) * 9) % 3;
  }

  function missileRot(m, fr) {
    const tip = MISSILE_TIP[fr] != null ? MISSILE_TIP[fr] : Math.PI / 2;
    return (m.rot || 0) - tip;
  }

  function drawMissileProj(m) {
    const fr = missileFlightFrame(m);
    const rot = missileRot(m, fr);
    const sz = Math.max(72, (m.size || 44) * 1.65);
    const trail = m.trail || [];
    for (let i = 0; i < trail.length; i += 2) {
      const r = trail[i];
      if (!r) continue;
      const ts = Math.max(22, sz * (0.42 + i * 0.05));
      drawSkillSheet('missile', r.x, r.y, ts, ts, fr, rot, (i + 1) * 0.12);
    }
    return drawSkillSheet('missile', m.x, m.y, sz, sz, fr, rot, 1);
  }

  function drawWraithBladeProj(m) {
    const pinned = !!m.pinned;
    const fr = m.frame != null ? m.frame : (pinned ? 2 : 0);
    const tip = WRAITH_TIP[fr];
    const rot = pinned || fr >= 2 || tip == null ? 0 : (m.rot || 0) - tip;
    const sz = pinned
      ? Math.min(220, (m.size || 150) * 0.82)
      : Math.max(96, (m.size || 150) * 0.55);
    const trail = m.trail || [];
    if (!pinned) {
      for (let i = 0; i < trail.length; i += 2) {
        const r = trail[i];
        if (!r) continue;
        const ts = Math.max(46, sz * (0.38 + i * 0.05));
        drawSkillSheet('wraithBlade', r.x, r.y, ts, ts, fr, rot, (i + 1) * 0.08);
      }
    }
    return drawSkillSheet('wraithBlade', m.x, m.y, sz, sz, fr, rot, 1);
  }

  function drawMageFixedProj(kind, m) {

    const img = ensureSkillImg(kind);
    const pack = img ? getImgFrames(img, 2, 2) : null;
    const ratio = pack?.ratio || 1.1;
    const fr = MAGE_FIXED_FRAME[kind] ?? 0;
    const sz = Math.max(64, (m.size || 36) * 1.35);
    const rot = 0;
    const trail = m.trail || [];
    for (let i = 0; i < trail.length; i += 2) {
      const r = trail[i];
      if (!r) continue;
      const ts = Math.max(18, sz * (0.5 + i * 0.05));
      drawSkillSheet(kind, r.x, r.y, ts, ts * ratio, fr, rot, (i + 1) * 0.1);
    }
    return drawSkillSheet(kind, m.x, m.y, sz, sz * ratio, fr, rot, 1);
  }

  /** Cultivation sheet FX through Pixi (2x2 / 4x4 / 5x2 atlases). */
  function drawSkillSheet(key, x, y, w, h, frame, rot, alpha, opt) {
    const img = ensureSkillImg(key);
    if (!img?.complete || !img.naturalWidth) return false;
    const layout = sheetLayout(key);
    const cols = (opt && opt.cols) || layout.cols;
    const rows = (opt && opt.rows) || layout.rows;
    const pack = getImgFrames(img, cols, rows);
    // 略放大采样，减少缩放过狠带来的糊/锯齿
    const boost = opt && opt.noBoost ? 1 : 1.12;
    const ww = w * boost;
    const hh = (h != null ? h : pack ? w * pack.ratio : w) * boost;
    putSheetSpr(
      skillPool,
      layers.skills,
      img,
      x,
      y,
      ww,
      hh,
      frame == null ? 0 : frame,
      cols,
      rows,
      rot || 0,
      alpha == null ? 1 : alpha,
      opt
    );
    return true;
  }

  function putSheetBeam(key, x1, y1, x2, y2, thick, frame, alpha) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const rot = Math.atan2(y2 - y1, x2 - x1);
    const cols = sheetCols(key);
    return drawSkillSheet(
      key,
      mx,
      my,
      len,
      Math.max(18, thick || 28),
      frame || 0,
      rot,
      alpha == null ? 0.9 : alpha,
      { cols, rows: cols }
    );
  }

function ensureGroundImg(key) {
    if (!key) return null;
    let img = window.imgs?.[key];
    const data = window.RiftWebGLAssets?.[key];
    if (data) {
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        window.imgs = window.imgs || {};
        window.imgs[key] = img;
      } else {
        img.crossOrigin = 'anonymous';
      }
      if (!img.complete || !img.naturalWidth) {
        if (img.src !== data) {
          img.onload = () => {
            lastBgKey = '';
          };
          img.src = data;
        }
      }
    }
    return img;
  }

  function syncBg() {
    if (!S || !ready) return;
    if (S.mapId === 'rift') {
      try {
        window.RiftWebGL?.warmupRiftTextures?.();
      } catch (_) {}
    }
    const rv = S.mapId === 'rift' && window.riftMapVisual ? window.riftMapVisual() : null;
    const key =
      rv?.ground ||
      (S.mapId === 'frost' ? 'groundFrost' : S.mapId === 'ruins' ? 'groundRuins' : 'groundChaos');
    const fill =
      rv?.fill || (S.mapId === 'frost' ? '#06111f' : S.mapId === 'ruins' ? '#15100b' : '#080b1b');
    const tint =
      rv?.tint ||
      (S.mapId === 'frost'
        ? 'rgba(3,12,24,.12)'
        : S.mapId === 'ruins'
          ? 'rgba(24,12,4,.1)'
          : 'rgba(5,8,20,.2)');
    const img = ensureGroundImg(key);
    const readyImg = !!(img?.complete && img.naturalWidth);
    const stamp =
      key +
      '|' +
      fill +
      '|' +
      tint +
      '|' +
      (readyImg ? img.src : 'pending') +
      '|' +
      WORLD_W +
      'x' +
      WORLD_H;
    if (stamp === lastBgKey) return;
    lastBgKey = stamp;

    bgFill.clear();
    bgFill.rect(0, 0, Math.max(1, WORLD_W), Math.max(1, WORLD_H));
    bgFill.fill(fill);

    for (const t of bgTiles) {
      try {
        t.destroy();
      } catch (_) {}
    }
    bgTiles = [];
    if (groundTile) {
      try {
        groundTile.destroy();
      } catch (_) {}
      groundTile = null;
    }

    if (readyImg) {
      const P = PIXI();
      let tex = null;
      try {
        tex = P.Texture.from(img);
      } catch (_) {
        tex = null;
      }
      if (tex) {
        if (P.TilingSprite) {
          groundTile = new P.TilingSprite({
            texture: tex,
            width: Math.max(1, WORLD_W),
            height: Math.max(1, WORLD_H)
          });
          groundTile.tileScale.set(
            512 / Math.max(1, img.naturalWidth),
            512 / Math.max(1, img.naturalHeight)
          );
          layers.bg.addChild(groundTile);
        } else {
          const tw = 512,
            th = 512;
          for (let x = 0; x < WORLD_W + tw; x += tw) {
            for (let y = 0; y < WORLD_H + th; y += th) {
              if (x > CAMX + W + tw || y > CAMY + H + th || x + tw < CAMX - tw || y + th < CAMY - tw)
                continue;
              const s = new P.Sprite(tex);
              s.x = x;
              s.y = y;
              s.width = tw;
              s.height = th;
              layers.bg.addChild(s);
              bgTiles.push(s);
            }
          }
        }
      }
    }

    // map tint overlay
    const tintG = new (PIXI().Graphics)();
    tintG.rect(0, 0, Math.max(1, WORLD_W), Math.max(1, WORLD_H));
    // Pixi fill with css rgba string
    try {
      tintG.fill(tint);
    } catch (_) {
      tintG.fill({ color: 0x050814, alpha: 0.2 });
    }
    layers.bg.addChild(tintG);
    bgTiles.push(tintG);
  }

  function terrainFrameLocal(type) {
    return (
      {
        rift: 0, rune: 1, obelisk: 2, vortex: 3, crack: 4, pillar: 5, wall: 6, altar: 7,
        snow: 8, icecrack: 9, crystal: 10, icefield: 15
      }[type] ?? 12
    );
  }
  function rift2FrameLocal(type) {
    return {
      bloodPool: 0, boneWall: 1, fleshPillar: 2, chapelAltar: 3, candleAltar: 3, lavaCrack: 4,
      mineCart: 5, obsidianPillar: 6, rail: 7, furnace: 7, poisonPuddle: 8, deadTree: 9,
      toxicMushroom: 10, giantMushroom: 10, roots: 11, voidTear: 12, voidRiftTerrain: 12,
      astralMonolith: 13, starCrystal: 14, runeRing: 15
    }[type];
  }

  function syncTerrain() {
    releaseAll(terrainPool);
    if (!S?.terrain) return;
    for (const t of S.terrain) {
      if (!visible(t.x, t.y, (t.r || 40) * 3)) continue;
      const r2 = rift2FrameLocal(t.type);
      const img = r2 === undefined ? window.imgs?.terrainAtlas : window.imgs?.terrainAtlasRift2;
      if (!img?.complete) continue;
      const idx = r2 === undefined ? terrainFrameLocal(t.type) : r2;
      const col = idx % 4, row = Math.floor(idx / 4);
      const tex = frameTex(img, 4, 4, col, row);
      if (!tex) continue;
      const spr = acquire(terrainPool, makeSprite, layers.terrain);
      spr.texture = tex;
      const wide = ['wall', 'icefield', 'boneWall', 'rail', 'roots', 'runeRing'].includes(t.type);
      const decal = ['bloodPool', 'lavaCrack', 'poisonPuddle', 'voidTear', 'voidRiftTerrain', 'rail', 'roots', 'runeRing'].includes(t.type);
      const w = t.r * (wide ? 2.8 : 2.15);
      const h = t.r * (t.type === 'wall' || t.type === 'boneWall' ? 1.05 : decal ? 1.55 : 2.15);
      spr.width = w;
      spr.height = h;
      if (t.flipX) spr.scale.x *= -1;
      if (t.flipY) spr.scale.y *= -1;
      spr.x = t.x;
      spr.y = t.y;
      spr.alpha = t.solid ? 0.98 : 0.75;
      spr.rotation = Number.isFinite(t.rotation) ? (t.rotation * Math.PI / 180) : (t.a || 0);
    }
  }

  function syncEnemies() {
    releaseAll(enemyPool);
    releaseAll(barPool);
    if (!S?.enemies) return;
    const SE = window.SpineEnemies;
    const P = PIXI();
    const dt = SE?.beginFrame ? SE.beginFrame(performance.now()) : 1 / 60;
    spineFrameTick = (spineFrameTick + 1) | 0;
    const cell = SE?.CELL || 192;
    const px = S.player?.x || 0;
    const py = S.player?.y || 0;

    // 先排序：Boss > 近玩家。Spine 有每帧上限时，优先画会咬人的近处怪，避免「看不见却挨打」
    const queue = [];
    for (const e of S.enemies) {
      const margin = e.boss ? 240 : 110;
      if (!visible(e.x, e.y, margin)) continue;
      const dx = e.x - px;
      const dy = e.y - py;
      queue.push({ e, d2: dx * dx + dy * dy, boss: !!e.boss });
    }
    queue.sort((a, b) => (b.boss - a.boss) || a.d2 - b.d2);

    for (let qi = 0; qi < queue.length; qi++) {
      const e = queue[qi].e;
      const d2 = queue[qi].d2;

      const spr = acquire(enemyPool, makeEnemySpineSlot, layers.enemies);
      let drew = false;
      if (SE?.renderEnemy) {
        // Canvas/tex 挂在怪物实体上：对象池每帧重绑，不能挂在 spr 上，否则半帧复用会串图
        if (!e.__spineCanvas) {
          e.__spineCanvas = document.createElement('canvas');
          e.__spineCanvas.width = cell;
          e.__spineCanvas.height = cell;
        }
        const hasTex = !!e.__spineTex;
        const uid = e.__spineUid || (qi + 1);
        const far = d2 > 280 * 280;
        const skipBlit =
          hasTex &&
          !e.boss &&
          !(e.hit > 0) &&
          (far
            ? (spineFrameTick + uid) % 3 !== 0
            : ((spineFrameTick + uid) & 1) === 1);
        const cv = SE.renderEnemy(e, dt, e.__spineCanvas, { skipBlit });
        if (cv) {
          if (!e.__spineTex) e.__spineTex = P.Texture.from(e.__spineCanvas);
          else if (e.__spineTex.source?.update) e.__spineTex.source.update();
          else if (e.__spineTex.baseTexture?.update) e.__spineTex.baseTexture.update();
          spr.texture = e.__spineTex;
          const sz = SE.displaySize(e);
          const face = S.player && e.x > S.player.x ? -1 : 1;
          spr.scale.set(face * (sz / cell), sz / cell);
          spr.x = e.x;
          spr.y = e.y;
          spr.tint = e.hit > 0 ? 0xffcccc : 0xffffff;
          spr.alpha = 1;
          spr.visible = true;
          drew = true;
        } else if (hasTex && skipBlit) {
          spr.texture = e.__spineTex;
          const sz = SE.displaySize(e);
          const face = S.player && e.x > S.player.x ? -1 : 1;
          spr.scale.set(face * (sz / cell), sz / cell);
          spr.x = e.x;
          spr.y = e.y;
          spr.tint = e.hit > 0 ? 0xffcccc : 0xffffff;
          spr.alpha = 1;
          spr.visible = true;
          drew = true;
        }
      }

      // Spine 未加载 / 超上限：用图集或色块兜底，绝不藏掉仍在战斗的怪
      if (!drew) {
        const key = e.img || (e.boss ? 'boss' : e.type === 'eye' || e.type === 'healer' ? 'eye' : e.type || 'imp');
        const img = window.imgs?.[key] || window.imgs?.imp || window.imgs?.skeleton;
        const fr = Math.floor(e.anim || 0) % 4;
        const tex = img?.complete ? frameTex(img, 2, 2, fr % 2, Math.floor(fr / 2) % 2) : null;
        const face = S.player && e.x > S.player.x ? -1 : 1;
        const sz = e.boss ? 150 : e.type === 'slime' ? (e.mini ? 34 : 58) : 48;
        if (tex) {
          spr.texture = tex;
          spr.scale.set(face * (sz / Math.max(1, tex.width)), sz / Math.max(1, tex.height));
          spr.x = e.x;
          spr.y = e.y + Math.sin((e.anim || 0) * 1.57) * 1.4;
          spr.tint = e.hit > 0 ? 0xffcccc : 0xffffff;
          spr.alpha = 1;
          spr.visible = true;
          drew = true;
        } else if (fxGfx) {
          // 最后手段：可见色点，保证玩家知道这里有怪
          spr.visible = false;
          spr._used = false;
          const col = e.boss ? 0xef4444 : e.elite ? 0xa855f7 : 0xc084fc;
          fxGfx.circle(e.x, e.y, Math.max(10, (e.r || 18) * 0.85));
          fxGfx.fill({ color: col, alpha: e.hit > 0 ? 0.95 : 0.75 });
          // still draw HP bar below
          const bar = acquire(barPool, makeBar, layers.bars);
          const bw = Math.max(28, (e.boss ? 70 : e.r) * 2);
          const bh = e.boss ? 6 : 4;
          const by = e.y - (e.boss ? 70 : e.r) - 10;
          const hp = Math.max(0, Math.min(1, e.hp / e.max));
          bar.clear();
          bar.rect(e.x - bw / 2, by, bw, bh);
          bar.fill({ color: 0x000000, alpha: 0.55 });
          bar.rect(e.x - bw / 2, by, bw * hp, bh);
          bar.fill(e.elite ? 0xa855f7 : 0xef4444);
          continue;
        } else {
          spr.visible = false;
          spr._used = false;
          continue;
        }
      }

      const bar = acquire(barPool, makeBar, layers.bars);
      const bw = Math.max(28, (e.boss ? 70 : e.r) * 2);
      const bh = e.boss ? 6 : 4;
      const by = e.y - (e.boss ? 70 : e.r) - 10;
      const hp = Math.max(0, Math.min(1, e.hp / e.max));
      bar.clear();
      bar.rect(e.x - bw / 2, by, bw, bh);
      bar.fill({ color: 0x000000, alpha: 0.55 });
      bar.rect(e.x - bw / 2, by, bw * hp, bh);
      bar.fill(e.elite ? 0xa855f7 : 0xef4444);
      if (e.shield > 0) {
        const sp = Math.min(1, e.shield / 3);
        bar.rect(e.x - bw / 2, by - 7, bw, bh);
        bar.fill({ color: 0x0f172a, alpha: 0.85 });
        bar.rect(e.x - bw / 2, by - 7, bw * sp, bh);
        bar.fill(0x60a5fa);
      }
    }
  }

  function syncPlayer() {
    const p = S?.player;
    if (!p || !playerSpr) {
      if (playerSpr) playerSpr.visible = false;
      return;
    }
    // Keep original CultivationSpine combat anims (idle/run/attack/skill/hurt).
    // Pixi only draws a foot shadow; body is overlaid after app.render().
    // 须与 spine-characters-config 的 groundOffset 对齐（脚在 y+offset，不是 y-6）
    playerSpr.visible = false;
    if (fxGfx && visible(p.x, p.y, 80)) {
      const go = window.CultivationSpineConfig?.classes?.[p.cls]?.groundOffset ?? 32;
      fxGfx.ellipse(p.x, p.y + go - 6, 22, 8);
      fxGfx.fill({ color: 0x000000, alpha: 0.28 });
    }
    if (p.hit > 0) p.hit = Math.max(0, p.hit - 1 / 60);
  }

  /** Class-relic strike FX: flies player → target (relicSkills artFx with fromX). */
  function isRelicStrikeFx(f) {
    if (!f || f.beam) return false;
    if (f.type && String(f.type).startsWith('set')) return false;
    if (f.relicFly) return true;
    const t = f.type;
    const k = f.kind;
    // mage prism / ranger talon
    if ((t === 'prism' || t === 'raven') && f.fromX != null) return true;
    // paladin cross burst (at player)
    if (t === 'sun' && f.i === 4) return true;
    // scythe relic
    if (k === 'soulReaper' && f.fromX != null) return true;
    // gunslinger relic
    if (t === 'quickShot' && k === 'gunslingerSkillFx' && f.fromX != null) return true;
    // 圣女法宝：问心图集第1帧
    if ((t === 'lustKissRelic' || (k === 'lustKiss' && f.frame === 0)) && f.fromX != null) return true;
    return false;
  }

  function findRelicStrike() {
    const list = S?.artFx;
    if (!list?.length) return null;
    let best = null;
    let bestLife = -1;
    for (const f of list) {
      if (!isRelicStrikeFx(f)) continue;
      const life = f.life || 0;
      if (life > bestLife) {
        bestLife = life;
        best = f;
      }
    }
    return best;
  }

  function smoothstep(u) {
    const t = Math.max(0, Math.min(1, u));
    return t * t * (3 - 2 * t);
  }

  function pushRelicTrail(fly, x, y) {
    if (!fly) return;
    fly.trail = fly.trail || [];
    const last = fly.trail[fly.trail.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 3.5) {
      fly.trail.push({ x, y });
      while (fly.trail.length > 22) fly.trail.shift();
    } else {
      last.x = x;
      last.y = y;
    }
  }

  /** 神器飞出流光拖尾：宽光带 + 亮芯 + 闪点 */
  function drawRelicFlowTrail(fly, glow, t) {
    if (!fxGfx || !fly) return;
    const pts = fly.trail;
    if (!pts || pts.length < 2) {
      // fallback：弧线采样
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = fly.fromX + (fly.x - fly.fromX) * u;
        const y = fly.fromY + (fly.y - fly.fromY) * u - Math.sin(Math.PI * u) * 18;
        if (i === 0) fxGfx.moveTo(x, y);
        else fxGfx.lineTo(x, y);
      }
      fxGfx.stroke({ width: 14, color: glow, alpha: 0.16 });
      return;
    }
    const n = pts.length;
    const layers = [
      { w: 32, a: 0.1, col: glow },
      { w: 20, a: 0.18, col: glow },
      { w: 10, a: 0.42, col: glow },
      { w: 4, a: 0.85, col: 0xffffff }
    ];
    for (const layer of layers) {
      for (let i = 1; i < n; i++) {
        const fade = Math.pow(i / (n - 1), 1.15);
        const pulse = 0.75 + 0.25 * Math.sin(t * 16 + i * 0.9);
        const w = layer.w * (0.45 + 0.55 * fade) * pulse;
        fxGfx.moveTo(pts[i - 1].x, pts[i - 1].y);
        fxGfx.lineTo(pts[i].x, pts[i].y);
        fxGfx.stroke({
          width: Math.max(2.5, w),
          color: layer.col,
          alpha: Math.min(0.95, layer.a * fade * (0.85 + 0.15 * pulse))
        });
      }
    }
    // 流光闪点
    for (let i = 2; i < n; i += 2) {
      const u = i / (n - 1);
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(t * 14 + i * 1.6));
      const r = 2 + 3.2 * u * twinkle;
      fxGfx.circle(pts[i].x, pts[i].y, r);
      fxGfx.fill({ color: 0xffffff, alpha: 0.22 + 0.45 * twinkle * u });
      fxGfx.circle(pts[i].x, pts[i].y, r * 2.2);
      fxGfx.fill({ color: glow, alpha: 0.1 + 0.16 * twinkle * u });
    }
    // 头端光晕
    fxGfx.circle(fly.x, fly.y, 14 + Math.sin(t * 20) * 2.5);
    fxGfx.fill({ color: glow, alpha: 0.28 });
    fxGfx.circle(fly.x, fly.y, 5.5);
    fxGfx.fill({ color: 0xffffff, alpha: 0.6 });
  }

  /** Keep flight state on FX so start/end don't jump each frame. */
  function ensureRelicFlight(strike, homeX, homeY) {
    const cur = S.__relicFly;
    // 新攻击 / 已收回 → 开新程；收回途中遇新攻击则从当前位置再飞出
    const startNew =
      !!strike && (!cur || cur.done || cur.strikeRef !== strike);
    if (startNew) {
      const t0 = S.time || 0;
      const fromX = cur && !cur.done && cur.x != null ? cur.x : homeX;
      const fromY = cur && !cur.done && cur.y != null ? cur.y : homeY;
      S.__relicFly = {
        strikeRef: strike,
        fromX,
        fromY,
        hitX: strike.x,
        hitY: strike.y,
        startT: t0,
        goDur: window.__RELIC_FLY_ARRIVE || 0.34,
        stayDur: 0.12,
        backDur: 0.78, // 慢速收回
        baseAng: Math.sin(t0 * 2) * 0.08, // 起飞姿态，全程锁定
        trail: [{ x: fromX, y: fromY }],
        done: false
      };
    }
    const fly = S.__relicFly;
    if (!fly || fly.done) return fly;
    if (strike) {
      fly.hitX += (strike.x - fly.hitX) * 0.14;
      fly.hitY += (strike.y - fly.hitY) * 0.14;
    }
    const e = Math.max(0, (S.time || 0) - fly.startT);
    const go = fly.goDur;
    const stay = fly.stayDur;
    const back = fly.backDur;
    if (e < go) {
      const u = smoothstep(e / go);
      const arc = Math.sin(Math.PI * u) * Math.min(48, Math.hypot(fly.hitX - fly.fromX, fly.hitY - fly.fromY) * 0.14);
      fly.x = fly.fromX + (fly.hitX - fly.fromX) * u;
      fly.y = fly.fromY + (fly.hitY - fly.fromY) * u - arc;
      fly.u = u * 0.45;
    } else if (e < go + stay) {
      fly.x = fly.hitX;
      fly.y = fly.hitY;
      fly.u = 0.45;
    } else {
      const u = smoothstep((e - go - stay) / back);
      fly.x = fly.hitX + (homeX - fly.hitX) * u;
      fly.y = fly.hitY + (homeY - fly.hitY) * u;
      fly.u = 0.45 + u * 0.55;
      if (u >= 1) fly.done = true;
    }
    // 原样飞出：不随飞行方向旋转
    fly.ang = fly.baseAng;
    pushRelicTrail(fly, fly.x, fly.y);
    return fly;
  }

  /** Original drawRelicBack + attack flight to strike point. */
  function syncClassRelic() {
    releaseAll(relicPool);
    const p = S?.player;
    if (!p) return;
    if (typeof fxOff === 'function' && fxOff()) return;
    const ri = { paladin: 0, mage: 1, ranger: 2, lewdSaintess: 3, scytheMaiden: 4, gunslinger: 5 }[p.cls];
    if (ri == null) return;
    const img = ensureSkillImg('classRelics') || window.imgs?.classRelics;
    if (!img?.complete || !img.naturalWidth) return;
    const t = S.time || 0;
    const pack = getImgFrames(img, 3, 2);
    const ratio = pack?.ratio || 1;
    const homeX = p.x - 40;
    const homeY = p.y - 36 + Math.sin(t * 4) * 4;
    const strike = findRelicStrike();
    const relicLayer = layers.relic || layers.fxFront;
    const glow = [0xfde68a, 0xf6d365, 0x67e8f9, 0xfb7185, 0xa78bfa, 0xf59e0b][ri] || 0xfde68a;

    const RELIC_IDLE = 56;
    const RELIC_FLY = 58;

    let fly = null;
    if (strike || (S.__relicFly && !S.__relicFly.done)) {
      if (strike) fly = ensureRelicFlight(strike, homeX, homeY);
      else fly = ensureRelicFlight(null, homeX, homeY);
    }
    if (fly && fly.done) S.__relicFly = null;

    if (fly && !fly.done) {
      const sz = RELIC_FLY;
      // 先画流光，再画神器本体
      if (fxGfx) drawRelicFlowTrail(fly, glow, t);
      if (fxGfx) {
        fxGfx.circle(fly.x, fly.y, sz * 0.38);
        fxGfx.fill({ color: glow, alpha: 0.18 });
      }
      putSheetSpr(relicPool, relicLayer, img, homeX, homeY, 36, 36 * ratio, ri, 3, 2, fly.baseAng, 0.12);
      // 各职业神器攻击：用本职技能图集中最合适的一帧
      const atkFx =
        (strike && strike.relicSkillKey && { key: strike.relicSkillKey, frame: strike.frame, cols: sheetLayout(strike.relicSkillKey).cols, rows: sheetLayout(strike.relicSkillKey).rows, size: strike.size }) ||
        (window.RELIC_SKILL_ATK_FX && window.RELIC_SKILL_ATK_FX[p.cls]);
      let drewAtk = false;
      if (atkFx && atkFx.key) {
        const fxImg = ensureSkillImg(atkFx.key) || window.imgs?.[atkFx.key];
        const cols = atkFx.cols || sheetLayout(atkFx.key).cols;
        const rows = atkFx.rows || sheetLayout(atkFx.key).rows;
        const fxSz = Math.max(88, (strike && strike.size) || atkFx.size || 110);
        if (fxImg?.complete) {
          putSheetSpr(relicPool, relicLayer, fxImg, fly.x, fly.y, fxSz, fxSz, atkFx.frame || 0, cols, rows, 0, 1);
          drewAtk = true;
        }
      }
      if (!drewAtk) {
        putSheetSpr(relicPool, relicLayer, img, fly.x, fly.y, sz, sz * ratio, ri, 3, 2, fly.ang, 1);
      }
    } else {
      // idle：略小于之前，清晰线性采样
      if (fxGfx) {
        fxGfx.circle(homeX, homeY, 26);
        fxGfx.fill({ color: glow, alpha: 0.16 });
      }
      putSheetSpr(relicPool, relicLayer, img, homeX + 2, homeY + 3, RELIC_IDLE * 0.9, RELIC_IDLE * 0.9 * ratio, ri, 3, 2, -0.1, 0.3);
      putSheetSpr(relicPool, relicLayer, img, homeX, homeY, RELIC_IDLE, RELIC_IDLE * ratio, ri, 3, 2, Math.sin(t * 2) * 0.08, 1);
    }

    // class resource rings (lust / reaper / gun heat) — soft glow under player
    if (!fxGfx) return;
    if (p.cls === 'lewdSaintess') {
      const v = (S.lust || 0) / Math.max(1, S.lustMax || 100);
      const r = 42 + 18 * v + Math.sin(t * 6) * 4;
      fxGfx.circle(p.x, p.y, r);
      fxGfx.fill({ color: 0xf472b6, alpha: 0.22 });
    } else if (p.cls === 'scytheMaiden') {
      const v = (S.reaperCharge || 0) / 100;
      const r = 42 + 20 * v + Math.sin(t * 6) * 3;
      fxGfx.circle(p.x, p.y, r);
      fxGfx.fill({ color: 0xc084fc, alpha: 0.2 });
      if (S.reaperGrace > 0) {
        const r2 = 64 + Math.sin(t * 8) * 6;
        fxGfx.circle(p.x, p.y, r2);
        fxGfx.fill({ color: 0x38bdf8, alpha: 0.16 });
      }
    } else if (p.cls === 'gunslinger') {
      const v = (S.gunHeat || 0) / 100;
      const r = 42 + 18 * v + Math.sin(t * 6) * 3;
      fxGfx.circle(p.x, p.y, r);
      fxGfx.fill({ color: 0xfacc15, alpha: 0.2 });
      if (S.gunStorm > 0) {
        const r2 = 64 + Math.sin(t * 8) * 6;
        fxGfx.circle(p.x, p.y, r2);
        fxGfx.fill({ color: 0xf97316, alpha: 0.16 });
      }
    }
  }

  /** Match Canvas2D combat: setTransform(DPR*scale) + translate(shake-CAM). */
  function makeCombatDrawContext() {
    const dpr = app?.renderer?.resolution || (typeof DPR === 'number' ? DPR : 1);
    const scale = baseScale || 1;
    const a = dpr * scale;
    const e = (-CAMX + shakeX) * a;
    const f = (-CAMY + shakeY) * a;
    return {
      canvas: canvas || document.getElementById('c'),
      getTransform() {
        return { a, b: 0, c: 0, d: a, e, f };
      }
    };
  }

  function overlayCultivationPlayer() {
    const p = S?.player;
    const spine = window.CultivationSpine;
    if (!p || !spine?.drawPlayer) return false;
    try {
      spine.load?.(p.cls);
      // 与城镇同级清晰度：Spine 叠加层 ≥2× CSS
      return !!spine.drawPlayer(makeCombatDrawContext(), p, { minDpr: 1.25 });
    } catch (_) {
      return false;
    }
  }

  function hideCombatSpineOverlay() {
    try {
      const g = window.CultivationSpineGPU;
      if (g?.canvas) g.canvas.style.display = 'none';
    } catch (_) {}
  }

  function putSheetSpr(pool, parent, img, x, y, w, h, frame, cols, rows, rot, alpha, opt) {
    if (!img?.complete || !visible(x, y, Math.max(Math.abs(w), Math.abs(h)) + 40)) return;
    const col = ((frame % cols) + cols) % cols;
    const row = Math.floor(frame / cols) % rows;
    const tex = frameTex(img, cols, rows, col, row);
    if (!tex) return;
    try {
      setTexLinear(tex.source);
    } catch (_) {}
    const spr = acquire(pool, makeSprite, parent);
    spr.texture = tex;
    spr.anchor.set(
      opt && opt.anchorX != null ? opt.anchorX : 0.5,
      opt && opt.anchorY != null ? opt.anchorY : 0.5
    );
    spr.width = Math.abs(w);
    spr.height = Math.abs(h);
    if (w < 0) spr.scale.x = -Math.abs(spr.scale.x);
    spr.x = x;
    spr.y = y;
    spr.rotation = rot || 0;
    spr.alpha = alpha == null ? 1 : alpha;
    spr.tint = 0xffffff;
    try {
      spr.roundPixels = false;
    } catch (_) {}
    try {
      const P = PIXI();
      const add = !!(opt && opt.additive);
      spr.blendMode = add ? P.BLEND_MODES?.ADD ?? 'add' : P.BLEND_MODES?.NORMAL ?? 'normal';
    } catch (_) {}
  }

  function syncWebglFxOverlay() {
    // Disabled: blitting RiftWebGL → 2D canvas often paints opaque black and hides the map.
    if (fxOverlaySpr) fxOverlaySpr.visible = false;
    return false;
  }

  function syncSkillFxNative() {
    releaseAll(skillPool);
    releaseAll(skillSpinePool);
    releaseAll(projPool);
    releaseAll(gemPool);
    releaseAll(txtPool);
    fxGfx.clear();
    if (!S) return;
    const t = S.time || 0;
    const fr4 = Math.floor(t * 12) % 4;
    const SF = USE_SPINE_SKILL_FX ? window.SpineSkillFx : null;
    skillFxDt = SF?.beginFrame ? SF.beginFrame(performance.now()) : 1 / 60;

    // gems / drops
    for (const g of S.gems || []) {
      if (!visible(g.x, g.y, 40)) continue;
      fxGfx.circle(g.x, g.y, 5 + Math.sin(t * 8) * 1.2);
      fxGfx.fill(0x38bdf8);
    }
    for (const d of S.equipGround || []) {
      if (!visible(d.x, d.y, 60)) continue;
      fxGfx.circle(d.x, d.y + Math.sin(t * 5) * 4, 10);
      fxGfx.fill({ color: 0xfacc15, alpha: 0.7 });
    }

    // projectiles
    for (const m of S.proj || []) {
      if (!visible(m.x, m.y, (m.size || 40) + 80)) continue;
      const key = m.fxKind || m.kind;
      const fr = m.frame ?? m.frameIndex ?? fr4;
      // 御剑弹道
      if (m.kind === 'quickShot' || m.kind === 'ricochetBullet' || key === 'gunslingerSkillFx' || key === 'gunslingerFx') {
        if (putGunFx(m, 'proj')) continue;
      }
      const spineKey = SF?.hasKind?.(key) ? key : SF?.hasKind?.(m.kind) ? m.kind : null;
      // 符剑/真火等不走 Spine 自旋；用下方固定帧图集
      if (spineKey && MAGE_FIXED_FRAME[m.kind] == null) {
        // 投射类：循环播 atlas 帧 + 朝向飞行方向（游戏位移负责轨迹）
        const hitD = m.hitRadius > 0 ? m.hitRadius * 2 : 0;
        const side = m.size || hitD || 56;
        const isBlade = !!(m.blade || m.kind === 'wind' || m.kind === 'moonSlash' || m.kind === 'wraithBlade');
        // 幽魂刃：拉长拖尾，像飞出的镰刃光带
        if (m.kind === 'wraithBlade' || spineKey === 'wraithBlade') {
          if (!drawWraithBladeProj(m)) {
            fxGfx.circle(m.x, m.y, 10);
            fxGfx.fill(0xa78bfa);
          }
          continue;
        }
        // 月弧剑意：月牙沿飞行方向切开
        if (m.kind === 'moonSlash' || spineKey === 'moonSlash') {
          const len = Math.max(150, side * 1.2);
          putSpineFx(m, spineKey, m.x, m.y, len, m.rot || 0, 0.98, {
            role: 'proj',
            play: 'loop',
            loop: true,
            size: len,
            forceRot: true,
            rotOff: m.rotOff != null ? m.rotOff : -Math.PI / 2
          });
          continue;
        }
        // 风裂剑气：沿射向疾射，镜像尖朝前
        if (m.kind === 'wind' || spineKey === 'wind') {
          const len = Math.max(120, side * 1.15);
          putSpineFx(m, spineKey, m.x, m.y, len, m.rot || 0, 0.94, {
            role: 'proj',
            play: 'loop',
            loop: true,
            size: len,
            forceRot: true,
            flipX: true
          });
          continue;
        }
        putSpineFx(m, spineKey, m.x, m.y, side, m.rot || 0, 0.95, {
          role: 'proj',
          play: 'loop',
          loop: true,
          size: side,
          forceRot: isBlade || spineKey === 'holy' || spineKey === 'dagger',
          flipX: !!m.flipX,
          rotOff: m.rotOff
        });
        continue;
      }
      const sk = key || m.kind;
      // 符剑 / 三昧真火 / 玄冰 / 魂火：固定帧、不自旋
      if (m.kind === 'missile') {
        if (!drawMissileProj(m)) {
          fxGfx.circle(m.x, m.y, 8);
          fxGfx.fill(0xfbbf24);
        }
        continue;
      }
      if (m.kind === 'ice') {
        const fr = m.frame != null ? ((m.frame % 3) + 3) % 3 : Math.floor((m.age || 0) * 8) % 3;
        const sz = Math.max(58, (m.size || 46) * 1.35);
        const trail = m.trail || [];
        for (let i = 0; i < trail.length; i += 2) {
          const r = trail[i];
          if (!r) continue;
          const ts = Math.max(18, sz * (0.45 + i * 0.05));
          drawSkillSheet('ice', r.x, r.y, ts, ts, fr, 0, (i + 1) * 0.1);
        }
        if (!drawSkillSheet('ice', m.x, m.y, sz, sz, fr, 0, 1)) {
          fxGfx.circle(m.x, m.y, 10);
          fxGfx.fill({ color: 0x67e8f9, alpha: 0.85 });
        }
        continue;
      }
      if (m.kind === 'soul') {
        const fr = m.frame != null ? m.frame : (m.impacting ? 2 : 3);
        const hit = !!(m.impacting || fr === 2);
        const sz = hit
          ? Math.max(78, (m.size || 48) * 1.65)
          : Math.max(58, (m.size || 48) * 1.35);
        const trail = m.trail || [];
        for (let i = 0; i < trail.length; i += 2) {
          const r = trail[i];
          if (!r) continue;
          const ts = Math.max(18, sz * (0.42 + i * 0.05));
          drawSkillSheet('soul', r.x, r.y, ts, ts, fr, 0, (i + 1) * 0.1);
        }
        if (!drawSkillSheet('soul', m.x, m.y, sz, sz, fr, 0, 1)) {
          fxGfx.circle(m.x, m.y, hit ? 14 : 9);
          fxGfx.fill(0xa78bfa);
        }
        continue;
      }
      if (m.kind === 'fire') {
        const fr = m.frame != null ? m.frame : (m.impacting ? 3 : 1);
        const fly = fr === 1 && !m.impacting;
        const sz = fly
          ? Math.max(88, (m.size || 78) * 1.35)
          : Math.max(110, (m.size || 78) * 1.6);
        if (!drawSkillSheet('fire', m.x, m.y, sz, sz, fr, 0, 1)) {
          fxGfx.circle(m.x, m.y, fly ? 10 : 16);
          fxGfx.fill(0xfb923c);
        }
        continue;
      }
      if (MAGE_FIXED_FRAME[m.kind] != null) {
        if (!drawMageFixedProj(m.kind, m)) {
          fxGfx.circle(m.x, m.y, 8);
          fxGfx.fill(0xc084fc);
        }
        continue;
      }
      if (m.kind === 'holy') {
        if (!drawSkillSheet('holy', m.x, m.y, 68, 22, fr, m.rot || 0, 1)) {
          fxGfx.circle(m.x, m.y, 5); fxGfx.fill(0xfde68a);
        }
      } else if (m.kind === 'wind') {
        const sz = m.size || 86;
        if (!drawSkillSheet('wind', m.x, m.y, sz * 1.35, sz * 0.72, fr, m.rot || 0, 1)) {
          fxGfx.circle(m.x, m.y, 5); fxGfx.fill(0xfde68a);
        }
      } else if (m.kind === 'wraithBlade') {
        if (!drawWraithBladeProj(m)) {
          fxGfx.circle(m.x, m.y, 10);
          fxGfx.fill(0xa78bfa);
        }
      } else if (m.kind === 'moonSlash') {
        const sz = m.size || 96;
        drawSkillSheet(m.kind, m.x, m.y, sz, sz * 0.85, fr, m.rot || 0, 1);
      } else if (m.kind === 'lustKiss') {
        const kissFr = m.frame != null ? m.frame : (m.impacting ? 2 : 1);
        // 飞行第2帧略小；命中第3帧稍大
        const sz = kissFr === 2 || m.impacting
          ? Math.max(88, (m.size || 58) * 1.45)
          : Math.max(52, m.size || 58);
        const kissRot = m.impacting || kissFr === 2 ? 0 : (m.rot || 0) + Math.PI;
        if (!drawSkillSheet('lustKiss', m.x, m.y, sz, sz, kissFr, kissRot, 1)) {
          fxGfx.circle(m.x, m.y, 10); fxGfx.fill(0xf472b6);
        }
      } else if (sk && drawSkillSheet(sk, m.x, m.y, m.size || 48, (m.size || 48) * 0.72, fr % 4, m.rot || 0, 1)) {
        // ok
      } else {
        const img = ensureSkillImg(sk) || window.imgs?.enemyOrb;
        if (img?.complete) {
          putSheetSpr(projPool, layers.fxFront, img, m.x, m.y, m.size || 48, (m.size || 48) * 0.55, fr % 4, 2, 2, m.rot || 0, 1);
        } else {
          fxGfx.circle(m.x, m.y, 5);
          fxGfx.fill(0xfde68a);
        }
      }
    }

    // axes / enemy shots — 飞斧只保留飞行朝向，不额外时间自旋
    for (const a of S.axes || []) {
      if (SF?.hasKind?.('axe')) {
        const ball = a.size || 72;
        putSpineFx(a, 'axe', a.x, a.y, ball, a.rot || 0, 1, {
          side: ball, size: ball, play: 'loop', loop: true, forceRot: true, role: 'proj'
        });
        continue;
      }
      drawSkillSheet('axe', a.x, a.y, a.size || 64, a.size || 64, Math.floor(t * 24) % 4, a.rot || 0, 1);
    }
    for (const s of S.enemyShots || []) {
      if (!visible(s.x, s.y, 90)) continue;
      drawEnemyShotFx(s, t, fr4);
    }

    // falls / slashes / artFx
    for (const f of S.falls || []) {
      const key = f.fxKind || f.kind;
      const a = Math.max(0, Math.min(1, (f.life || 0) / (f.max || 1)));
      const sz = (f.size || 90) * (1.05 - a * 0.25);
      const isMeteorFall = !!(
        f.meteorRain ||
        f.kind === 'meteor' ||
        /^meteorRainFx/i.test(String(f.kind || ''))
      );
      if (f.kind === 'fireBomb' || key === 'gunslingerSkillFx') {
        if (putGunFx(f, 'fall')) continue;
      }
      // 天火：坠落阶段火球帧1→2，范围圈等落地 artFx
      if (isMeteorFall) {
        const tip =
          f.tipSize ||
          Math.max(58, Math.min(92, (f.rad || (f.size || 90) * 0.5) * 0.85));
        const fallRot =
          f.rot != null
            ? f.rot
            : Math.atan2((f.ty || f.y) - (f.sy || f.y), (f.tx || f.x) - (f.sx || f.x) || 0.01);
        const ballFr = f.ballFrame != null ? f.ballFrame : f.frameIndex != null ? f.frameIndex : 0;
        if (SF?.hasKind?.('meteor') || SF?.hasKind?.(key) || SF?.hasKind?.(f.kind)) {
          const k = SF.hasKind('meteor') ? 'meteor' : SF.hasKind(key) ? key : f.kind;
          putSpineFx(f, k, f.x, f.y, tip, fallRot, 0.95, {
            frame: ballFr,
            life: f.life,
            max: f.max,
            scrub: false,
            falling: true,
            role: 'fall',
            side: tip,
            size: tip,
            forceRot: true
          });
        } else if (visible(f.x, f.y, tip + 80)) {
          drawSkillSheet('meteor', f.x, f.y, tip, tip, ballFr, fallRot, 1);
        }
        continue;
      }
      if (SF?.hasKind?.(key) || SF?.hasKind?.(f.kind)) {
        const k = SF.hasKind(key) ? key : f.kind;
        const falling = !!(
          f.falling ||
          f.daggerRain ||
          ['dagger', 'fireBomb'].includes(f.kind) ||
          /^daggerRainFx/i.test(String(f.kind || ''))
        );
        const tip = falling
          ? (f.tipSize || Math.max(64, Math.min(96, (f.size || 90) * 0.42)))
          : Math.max(f.size || 90, f.rad > 0 ? f.rad * 2 : 0);
        const fallRot = falling
          ? (f.rot != null ? f.rot : (f.daggerRain || /^daggerRainFx/i.test(String(f.kind || '')) ? Math.PI / 2 : 0))
          : 0;
        putSpineFx(f, k, f.x, f.y, tip, fallRot, 0.92, {
          frame: f.frameIndex ?? Math.floor((1 - a) * 4) % 4,
          life: f.life,
          max: f.max,
          scrub: !falling,
          falling,
          role: falling ? 'fall' : 'burst',
          type: f.type || f.kind,
          side: tip,
          size: tip,
          // 坠落只对齐落向，不持续自旋
          forceRot: !!falling && fallRot !== 0
        });
        continue;
      }
      if (!visible(f.x, f.y, (f.size || 90) + 80)) continue;
      const fallFr =
        f.frameIndex != null
          ? f.frameIndex
          : Math.floor((1 - a) * 4) % 4;
      const fallRot = f.rot || 0;
      const fallKey = key || f.kind;
      drawSkillSheet(fallKey, f.x, f.y, sz, sz, fallFr, fallRot, 1);
    }
    for (const s of S.slashes || []) {
      const a = Math.max(0, Math.min(1, (s.life || 0) / (s.max || 1)));
      if (s.kind === 'shotgunRoll') {
        if (putGunFx(s, 'slash')) continue;
      }
      if (SF?.hasKind?.(s.kind)) {
        const side = Math.min(200, Math.max(100, s.size || 140));
        putSpineFx(s, s.kind, s.x, s.y, side, s.rot || 0, a, {
          life: s.life, max: s.max, scrub: true, type: s.kind, side, size: side
        });
        continue;
      }
      if (!visible(s.x, s.y, (s.size || 120) + 80)) continue;
      const side = s.size || 140;
      const scythe = isScytheFx(s.kind);
      drawSkillSheet(s.kind, s.x, s.y, side, side, fr4, s.rot || 0, a, {
        anchorY: scythe ? 1 : 0.5
      });
    }
    for (const f of S.artFx || []) {
      if (f.target && !f.target.dead) {
        f.x = f.target.x;
        f.y = f.target.y;
      }
      if (f.setPlayer && S.player) {
        f.x = S.player.x;
        f.y = S.player.y;
      }
      const key = f.kind || f.type;
      const a = Math.max(0, Math.min(1, (f.life || 0) / (f.max || 1)));
      const sz = (f.size || 100) * (1.1 - a * 0.15);

      // Boss 预警圈 / 框 / 扇形 / 斩线（强制红色）
      if (f.warn || f.type === 'bossWarn' || f.kind === 'bossWarn') {
        if (fxGfx && visible(f.x || f.fromX || 0, f.y || f.fromY || 0, Math.max(f.rad || 0, f.w || 0, f.h || 0, f.size || 120) + 80)) {
          const pulse = 0.28 + (1 - a) * 0.55;
          const col = 0xef4444; // 预警统一鲜红
          const edge = 0xfca5a5;
          const shape = f.shape || 'circle';
          const t = S.time || 0;
          if (shape === 'rect') {
            const w = f.w || 80;
            const h = f.h || 80;
            const rot = f.rot || 0;
            const c = Math.cos(rot);
            const s = Math.sin(rot);
            const hx = w / 2;
            const hy = h / 2;
            const pts = [];
            for (const [lx, ly] of [
              [-hx, -hy],
              [hx, -hy],
              [hx, hy],
              [-hx, hy]
            ]) {
              pts.push(f.x + lx * c - ly * s, f.y + lx * s + ly * c);
            }
            fxGfx.poly(pts, true);
            fxGfx.fill({ color: col, alpha: pulse * 0.34 });
            fxGfx.poly(pts, true);
            fxGfx.stroke({ width: 3.5, color: col, alpha: Math.min(1, pulse + 0.35) });
            fxGfx.poly(pts, true);
            fxGfx.stroke({ width: 1.4, color: edge, alpha: pulse * 0.7 });
          } else if (shape === 'cone') {
            const rad = f.rad || 140;
            const rot = f.rot || 0;
            const arc = f.arc || 1.2;
            const steps = 16;
            const pts = [f.x, f.y];
            for (let i = 0; i <= steps; i++) {
              const tt = -arc / 2 + (arc * i) / steps;
              pts.push(f.x + Math.cos(rot + tt) * rad, f.y + Math.sin(rot + tt) * rad);
            }
            fxGfx.poly(pts, true);
            fxGfx.fill({ color: col, alpha: pulse * 0.32 });
            fxGfx.poly(pts, true);
            fxGfx.stroke({ width: 3.4, color: col, alpha: Math.min(1, pulse + 0.38) });
            fxGfx.poly(pts, true);
            fxGfx.stroke({ width: 1.3, color: edge, alpha: pulse * 0.65 });
          } else if (shape === 'line' && f.fromX != null) {
            const half = f.half || 30;
            fxGfx.moveTo(f.fromX, f.fromY);
            fxGfx.lineTo(f.x, f.y);
            fxGfx.stroke({ width: half * 1.85, color: col, alpha: pulse * 0.28 });
            fxGfx.moveTo(f.fromX, f.fromY);
            fxGfx.lineTo(f.x, f.y);
            fxGfx.stroke({ width: 4.2, color: col, alpha: Math.min(1, pulse + 0.4) });
            fxGfx.moveTo(f.fromX, f.fromY);
            fxGfx.lineTo(f.x, f.y);
            fxGfx.stroke({ width: 1.6, color: edge, alpha: pulse * 0.75 });
            fxGfx.circle(f.x, f.y, half * 1.05);
            fxGfx.stroke({ width: 2.4, color: col, alpha: pulse + 0.25 });
          } else {
            const rad = f.rad || (f.size || 120) * 0.5;
            fxGfx.circle(f.x, f.y, rad);
            fxGfx.fill({ color: col, alpha: pulse * 0.3 });
            fxGfx.circle(f.x, f.y, rad);
            fxGfx.stroke({ width: 3.6, color: col, alpha: Math.min(1, pulse + 0.38) });
            fxGfx.circle(f.x, f.y, rad * (0.7 + (1 - a) * 0.26));
            fxGfx.stroke({ width: 2, color: edge, alpha: pulse * 0.55 });
            // 收缩提示环
            fxGfx.circle(f.x, f.y, rad * (0.35 + a * 0.55));
            fxGfx.stroke({ width: 1.5, color: 0xffffff, alpha: pulse * 0.4 });
          }
          // 角点闪烁，增强可读性
          if (shape === 'circle' || !f.shape) {
            const rad = f.rad || (f.size || 120) * 0.5;
            for (let i = 0; i < 4; i++) {
              const ang = t * 3 + (i * Math.PI) / 2;
              fxGfx.circle(f.x + Math.cos(ang) * rad * 0.92, f.y + Math.sin(ang) * rad * 0.92, 2.2);
              fxGfx.fill({ color: 0xffffff, alpha: 0.35 + 0.35 * Math.abs(Math.sin(t * 8 + i)) });
            }
          }
        }
        continue;
      }
      if (f.type === 'bossMelee' || f.kind === 'bossMelee') {
        if (fxGfx && visible(f.x, f.y, (f.size || 100) + 80)) {
          const col = parseCssColor(f.color) || 0xef4444;
          const white = 0xffffff;
          const t = S.time || 0;
          const shape = f.shape || 'circle';
          const expand = 0.85 + (1 - a) * 0.55;
          if (shape === 'rect' && f.w && f.h) {
            const rot = f.rot || 0;
            const c = Math.cos(rot);
            const s = Math.sin(rot);
            const hx = (f.w / 2) * expand;
            const hy = (f.h / 2) * expand;
            const pts = [];
            for (const [lx, ly] of [
              [-hx, -hy],
              [hx, -hy],
              [hx, hy],
              [-hx, hy]
            ]) {
              pts.push(f.x + lx * c - ly * s, f.y + lx * s + ly * c);
            }
            fxGfx.poly(pts, true);
            fxGfx.fill({ color: col, alpha: a * 0.32 });
            fxGfx.poly(pts, true);
            fxGfx.stroke({ width: 4, color: col, alpha: a * 0.9 });
            fxGfx.poly(pts, true);
            fxGfx.stroke({ width: 1.5, color: white, alpha: a * 0.55 });
          } else if (shape === 'cone' && f.rad) {
            const rot = f.rot || 0;
            const arc = f.arc || 1.2;
            const rad = f.rad * expand;
            const pts = [f.x, f.y];
            for (let i = 0; i <= 16; i++) {
              const tt = -arc / 2 + (arc * i) / 16;
              pts.push(f.x + Math.cos(rot + tt) * rad, f.y + Math.sin(rot + tt) * rad);
            }
            fxGfx.poly(pts, true);
            fxGfx.fill({ color: col, alpha: a * 0.3 });
            fxGfx.poly(pts, true);
            fxGfx.stroke({ width: 3.5, color: col, alpha: a * 0.88 });
          } else if (shape === 'line' && f.fromX != null) {
            fxGfx.moveTo(f.fromX, f.fromY);
            fxGfx.lineTo(f.x, f.y);
            fxGfx.stroke({ width: (f.size || 60) * 0.55 * expand, color: col, alpha: a * 0.28 });
            fxGfx.moveTo(f.fromX, f.fromY);
            fxGfx.lineTo(f.x, f.y);
            fxGfx.stroke({ width: 5, color: col, alpha: a * 0.85 });
            fxGfx.moveTo(f.fromX, f.fromY);
            fxGfx.lineTo(f.x, f.y);
            fxGfx.stroke({ width: 1.8, color: white, alpha: a * 0.7 });
          } else {
            const rad = (f.rad || (f.size || 100) * 0.48) * expand;
            fxGfx.circle(f.x, f.y, rad);
            fxGfx.fill({ color: col, alpha: a * 0.34 });
            fxGfx.circle(f.x, f.y, rad * 0.72);
            fxGfx.fill({ color: col, alpha: a * 0.18 });
            fxGfx.circle(f.x, f.y, rad);
            fxGfx.stroke({ width: 4, color: col, alpha: a * 0.9 });
            fxGfx.circle(f.x, f.y, rad * 0.55);
            fxGfx.stroke({ width: 2, color: white, alpha: a * 0.55 });
            // 冲击波纹
            fxGfx.circle(f.x, f.y, rad * (1.15 + (1 - a) * 0.35));
            fxGfx.stroke({ width: 2.2, color: col, alpha: a * 0.4 });
            for (let i = 0; i < 6; i++) {
              const ang = t * 10 + (i * Math.PI) / 3;
              const rr = rad * (0.55 + (1 - a) * 0.5);
              fxGfx.circle(f.x + Math.cos(ang) * rr, f.y + Math.sin(ang) * rr, 2.5 + (1 - a) * 2);
              fxGfx.fill({ color: white, alpha: a * 0.65 });
            }
          }
        }
        continue;
      }

      // 天火落地范围圈：落地持续帧3，消失帧4；坠落阶段不画圈
      const isMeteorImpact = !!(
        f.meteorImpact ||
        f.type === 'meteorRain' ||
        f.type === 'meteorImpact' ||
        f.type === 'meteor' ||
        ((f.kind === 'meteor' || /^meteorRainFx/i.test(String(f.kind || ''))) && !f.meteorRain && !f.falling)
      );
      if (isMeteorImpact) {
        const side = Math.max(f.size || 0, (f.rad || 0) * 2, 120);
        // 落地帧3 持续，消失时切帧4
        const hold = f.impactHold != null ? f.impactHold : 0.32;
        const impactFr =
          a > hold
            ? (f.impactFrame != null ? f.impactFrame : 2)
            : (f.impactFrame != null ? f.impactFrame : 2) + 1;
        if (SF?.hasKind?.('meteor') || SF?.hasKind?.(key)) {
          const k = SF.hasKind('meteor') ? 'meteor' : key;
          putSpineFx(f, k, f.x, f.y, side, 0, a, {
            frame: impactFr,
            life: f.life,
            max: f.max,
            scrub: true,
            role: 'burst',
            side,
            size: side,
            forceRot: false
          });
        } else if (visible(f.x, f.y, side + 80)) {
          drawSkillSheet('meteor', f.x, f.y, side, side, impactFr, 0, a);
          if (fxGfx && f.rad > 0) {
            fxGfx.circle(f.x, f.y, f.rad);
            fxGfx.stroke({ width: 2, color: 0xfb923c, alpha: a * 0.35 });
          }
        }
        continue;
      }
      const isGun =
        key === 'gunslingerSkillFx' ||
        key === 'gunslingerFx' ||
        f.type === 'quickShot' ||
        f.type === 'ricochetBullet' ||
        f.type === 'shotgunRoll' ||
        f.type === 'fireBomb' ||
        f.burnSkill === 'fireBomb';
      if (isGun) {
        if (putGunFx(f, 'artFx')) continue;
      }
      if (SF?.hasKind?.(key) || (f.beam && SF?.hasKind?.('beam'))) {
        if (f.beam && f.fromX != null) {
          const ex = f.endX != null ? f.endX : f.x;
          const ey = f.endY != null ? f.endY : f.y;
          const thick = Math.max(28, Math.min(72, (f.beamWidth || 18) * 2.4));
          // 玄机灵束等：只用 jiguang atlas 拉伸动画，不画 Graphics 线段
          const beamKind = SF.hasKind(key) && (key === 'beam' || key === 'arcaneBeam' || key === 'holy')
            ? (key === 'holy' ? 'beam' : key)
            : 'beam';
          putBeamSpine(f, beamKind, f.fromX, f.fromY, ex, ey, thick, a, {
            life: f.life,
            max: f.max,
            type: f.type,
            play: 'loop',
            loop: true
          });
          continue;
        }
        // 扇形斩（残月镰舞等）：加大、提亮，并描扇形范围
        if (f.fan || (f.arc != null && (key === 'scytheArc' || key === 'deathWaltz' || key === 'bloodScythe'))) {
          // size 已是扇形射程边长（中心在半程），勿再当半径×2
          const side = Math.max(f.size || 0, f.width || 0, 140);
          const aa = scytheAlpha(a);
          putSpineFx(f, key, f.x, f.y, side, f.rot || 0, aa, {
            frame: f.i ?? Math.floor((1 - a) * 4) % 4,
            i: f.i,
            life: f.life,
            max: f.max,
            scrub: true,
            play: 'scrub',
            type: f.type,
            side,
            size: side,
            forceRot: true
          });
          // 双层叠加强化可见度
          if (!f.__scytheGlow) f.__scytheGlow = {};
          putSpineFx(f.__scytheGlow, key, f.x, f.y, side * 0.92, f.rot || 0, aa * 0.55, {
            life: f.life,
            max: f.max,
            scrub: true,
            play: 'scrub',
            side: side * 0.92,
            forceRot: true
          });
          drawSoftGlow(f.x, f.y, side * 0.55, key === 'bloodScythe' ? 0xfb7185 : 0xe879f9, aa * 0.55);
          continue;
        }
        // 血镰回旋：铺满伤害半径 + 范围圈
        if (key === 'bloodReap' || key === 'soulReaper') {
          const rad = f.rad > 0 ? f.rad : Math.max(70, (f.size || 160) * 0.5);
          const side = Math.max(f.size || 0, rad * 2.15, 160);
          const aa = scytheAlpha(a);
          putSpineFx(f, key, f.x, f.y, side, 0, aa, {
            life: f.life,
            max: f.max,
            scrub: true,
            play: 'scrub',
            side,
            size: side
          });
          if (!f.__bloodGlow) f.__bloodGlow = {};
          putSpineFx(f.__bloodGlow, key, f.x, f.y, side * 0.88, 0, aa * 0.5, {
            life: f.life,
            max: f.max,
            scrub: true,
            side: side * 0.88
          });
          drawSoftGlow(f.x, f.y, rad, key === 'soulReaper' ? 0xa78bfa : 0xfb7185, aa * 0.5);
          continue;
        }
        // 追魂镰链：更粗链带 + 外圈范围
        if (key === 'reaperChain') {
          const rad = f.rad > 0 ? f.rad : Math.max(90, (f.size || 160) * 0.45);
          const n = 4;
          const aa = scytheAlpha(a);
          if (!f.__chainHosts) f.__chainHosts = [];
          while (f.__chainHosts.length < n) f.__chainHosts.push({});
          const spin = (typeof S.time === 'number' ? S.time : 0) * 5.6;
          for (let i = 0; i < n; i++) {
            const ang = spin + (i * Math.PI * 2) / n;
            const ex = f.x + Math.cos(ang) * rad;
            const ey = f.y + Math.sin(ang) * rad;
            putBeamSpine(f.__chainHosts[i], 'reaperChain', f.x, f.y, ex, ey, 42, aa, {
              life: f.life,
              max: f.max,
              play: 'loop',
              loop: true
            });
          }
          drawSoftGlow(f.x, f.y, rad, 0x38bdf8, aa * 0.4);
          continue;
        }
        // 墓月裂隙：放大气旋 + 清晰吸附圈
        if (key === 'graveRift') {
          const rad = f.rad > 0 ? f.rad : Math.max(90, (f.size || 160) * 0.45);
          const side = Math.max(f.size || 0, rad * 2.25, 180);
          const aa = scytheAlpha(a);
          putSpineFx(f, key, f.x, f.y, side, 0, aa, {
            life: f.life,
            max: f.max,
            play: 'loop',
            loop: true,
            side,
            size: side
          });
          if (!f.__riftGlow) f.__riftGlow = {};
          putSpineFx(f.__riftGlow, key, f.x, f.y, side * 0.75, (S.time || 0) * 1.2, aa * 0.45, {
            life: f.life,
            max: f.max,
            play: 'loop',
            loop: true,
            side: side * 0.75,
            forceRot: true
          });
          drawSoftGlow(f.x, f.y, rad, 0xa78bfa, aa * 0.5);
          drawSoftGlow(f.x, f.y, rad * 0.55, 0xc084fc, aa * 0.35);
          continue;
        }
        // Area FX: diameter from rad；圆形特效不旋转
        // 毒域/流沙等持续场：loop 播放，避免 scrub 一次就「僵死」
        const areaSide = isScytheFx(key)
          ? Math.max(f.size || 0, (f.rad || 0) * 2.1, 140)
          : Math.max(f.size || 100, (f.rad || 0) * 2);
        const linger = !!(f.loop || f.poison || f.sandField || (f.pull && (key === 'sand' || f.kind === 'sand')));
        const areaA = linger ? Math.min(1, 0.55 + a * 0.45) : (isScytheFx(key) ? scytheAlpha(a) : a);
        putSpineFx(f, key, f.x, f.y, areaSide, 0, areaA, {
          frame: f.i ?? Math.floor((1 - a) * 4) % 4,
          i: f.i,
          life: f.life,
          max: f.max,
          scrub: !linger && !f.loop,
          play: linger ? 'loop' : undefined,
          loop: linger,
          forceRot: false,
          type: f.type,
          size: areaSide,
          side: areaSide
        });
        continue;
      }
      // Align with Canvas drawFx: kind 有图用 2×2 动画；否则 artifactFx 用 5×2 + f.i
      const p = 1 - a;
      const kindImg = f.kind ? ensureSkillImg(f.kind) : null;
      const hasKind = !!(kindImg?.complete && kindImg.naturalWidth);
      const isSet = !!(f.type && String(f.type).startsWith('set'));
      const sheetKey = hasKind ? f.kind : 'artifactFx';
      // 扇形斩：size 已是射程边长；圆形场才用 rad*2
      const baseSize = (f.fan || f.type === 'scytheArc' || (f.arc != null && !f.rad))
        ? Math.max(f.size || 0, f.width || 0, 40) * (1.08 - a * 0.1)
        : Math.max(f.size || 0, (f.rad || 0) * 2, 40) * (1.12 - a * 0.14);

      if (f.beam && f.fromX != null) {
        const ex = f.endX != null ? f.endX : f.x;
        const ey = f.endY != null ? f.endY : f.y;
        const thick = Math.max(f.size || 28, Math.min(72, (f.beamWidth || 18) * 2.4));
        const beamKey = hasKind
          ? f.kind
          : ensureSkillImg('beam')?.complete
            ? 'beam'
            : 'holy';
        // Canvas beams on artifactFx use 2×2 animated frames
        const beamFr = Math.floor((S.time || 0) * 3 * 12) % 4;
        const len = Math.hypot(ex - f.fromX, ey - f.fromY) || 1;
        if (sheetKey === 'artifactFx' && !hasKind) {
          if (
            !drawSkillSheet(
              'artifactFx',
              (f.fromX + ex) / 2,
              (f.fromY + ey) / 2,
              len,
              f.size || 28,
              beamFr,
              f.rot || Math.atan2(ey - f.fromY, ex - f.fromX),
              a,
              { cols: 2, rows: 2 }
            )
          ) {
            fxGfx.moveTo(f.fromX, f.fromY);
            fxGfx.lineTo(ex, ey);
            fxGfx.stroke({ width: thick * 0.35, color: 0xc084fc, alpha: a * 0.85 });
          }
        } else if (!putSheetBeam(beamKey, f.fromX, f.fromY, ex, ey, thick, beamFr, a)) {
          fxGfx.moveTo(f.fromX, f.fromY);
          fxGfx.lineTo(ex, ey);
          fxGfx.stroke({ width: thick * 0.35, color: 0xc084fc, alpha: a * 0.85 });
        }
        continue;
      }

      if (!visible(f.x, f.y, baseSize + 80)) continue;

      if (isSet) {
        const setFr = Math.floor((1 - a) * 4) % 4;
        if (f.fromX != null) {
          const dx = f.x - f.fromX;
          const dy = f.y - f.fromY;
          const len = Math.hypot(dx, dy) || 1;
          const ang = f.rot || Math.atan2(dy, dx);
          const w = Math.max(len * 0.95, (f.size || 100) * 1.35);
          const h = f.type === 'setRoseReflect' ? f.size || 100 : (f.size || 100) * 0.72;
          drawSkillSheet(sheetKey, (f.fromX + f.x) / 2, (f.fromY + f.y) / 2, w, h, setFr, ang, a, { cols: 2, rows: 2, additive: true });
        } else {
          const spin =
            f.type === 'setAureateBlackhole' ? -(S.time || 0) * 1.8 : f.rot || 0;
          const setSz =
            f.type === 'setVenomBreak'
              ? (f.size || 100) * (0.82 + p * 0.28)
              : (f.size || 100) * (0.9 + p * 0.22);
          const setA = f.type === 'setAureateBlackhole' ? a * 0.72 : a;
          drawSkillSheet(sheetKey, f.x, f.y, setSz, setSz, setFr, spin, setA, { cols: 2, rows: 2, additive: true });
        }
        continue;
      }

      if (!hasKind) {
        // Canvas: drawGrid(artifactFx, x, y, size, f.i, 5, 2, a, S.time*2)
        const artImg = ensureSkillImg('artifactFx');
        const pack = artImg ? getImgFrames(artImg, 5, 2) : null;
        const w = baseSize;
        const h = w * (pack?.ratio || 1);
        const fr = f.i != null ? f.i : 0;
        if (
          !drawSkillSheet('artifactFx', f.x, f.y, w, h, fr, 0, a, {
            cols: 5,
            rows: 2
          })
        ) {
          fxGfx.circle(f.x, f.y, Math.max(8, w * 0.35));
          fxGfx.stroke({ width: 2, color: 0xfacc15, alpha: a * 0.8 });
        }
        continue;
      }

      // Dedicated skill sheet：非光环不自旋；镰刀扇形保留朝向
      const still = ['bloodReap', 'graveRift', 'lustPrayer', 'crystal'].includes(f.kind);
      const arc = f.type === 'scytheArc';
      const chainWhip = f.type === 'reaperChain';
      const fr = arc
        ? Math.floor((S.time || 0) * 13) % 4
        : still || chainWhip
          ? Math.floor((1 - a) * 12) % 4
          : Math.floor((1 - a) * 4) % 4;
      const rot =
        isAuraOrbitKind(f.kind)
          ? (S.time || 0) * 2
          : f.kind === 'lustSplash' || still || chainWhip
            ? 0
            : arc
              ? f.rot || 0
              : f.rot || 0;
      if (f.type === 'fireImpact' || (f.kind === 'fire' && f.frame === 3)) {
        const isz = f.size || 110;
        drawSkillSheet('fire', f.x, f.y, isz, isz, 3, 0, Math.max(0, (f.life || 0) / (f.max || 0.24)));
        continue;
      }
      if (f.type === 'lustKissImpact' || (f.kind === 'lustKiss' && f.frame === 2)) {
        const isz = f.size || 96;
        drawSkillSheet('lustKiss', f.x, f.y, isz, isz, 2, 0, Math.max(0, (f.life || 0) / (f.max || 0.2)));
        continue;
      }
      if (f.relicFly && (f.relicSkillKey || f.type === 'lustKissRelic')) continue; // 飞行由 syncClassRelic 画技能帧
      if (f.type === 'lustKissRelic' || (f.kind === 'lustKiss' && f.frame === 0)) {
        const isz = f.size || 118;
        drawSkillSheet('lustKiss', f.x, f.y, isz, isz, 0, 0, Math.max(0, (f.life || 0) / (f.max || 0.28)));
        continue;
      }
      const scythe = isScytheFx(f.kind);
      let dw = baseSize;
      let dh = baseSize;
      if ((f.kind === 'lustPrayer' || f.kind === 'crystal') && kindImg) {
        const pack = getImgFrames(kindImg, 2, 2);
        const ratio = pack?.ratio || 1;
        dh = dw * ratio;
      }
      const layout = sheetLayout(f.kind);
      if (
        !drawSkillSheet(f.kind, f.x, f.y, dw, dh, fr, rot, a, {
          // 幽冥月斩：居中锚点，中心在扇形半程，边长≈射程
          anchorX: 0.5,
          anchorY: scythe && (f.fan || f.arc != null) && !arc ? 1 : 0.5,
          cols: layout.cols,
          rows: layout.rows
        })
      ) {
        if (f.fromX != null) {
          fxGfx.moveTo(f.fromX, f.fromY);
          fxGfx.lineTo(f.x, f.y);
          fxGfx.stroke({ width: 3, color: 0xfacc15, alpha: a * 0.85 });
        } else {
          fxGfx.circle(f.x, f.y, Math.max(8, dw * 0.35));
          fxGfx.stroke({ width: 2, color: 0xfacc15, alpha: a * 0.8 });
        }
      }
    }

    // bolts — 紫霄雷链(3帧) / 九霄雷诀复用同图集(1-4帧顺序播)
    for (const b of S.bolts || []) {
      if (!visible(b.x, b.y, 160)) continue;
      const fromX = b.chain ? b.x2 : b.x - 8;
      const fromY = b.chain ? b.y2 : Math.max(0, b.y - 140);
      const lifeMax = b.max || (b.chain ? 0.66 : b.sky ? 0.52 : 0.16);
      const a = Math.max(0, Math.min(1, (b.life || 0) / lifeMax));
      const elapsed = Math.max(0, lifeMax - (b.life || 0));
      const hitN = b.hitFrames || (b.chain ? 3 : 4);
      const hitFr = Math.min(hitN - 1, Math.floor((elapsed / Math.max(0.001, lifeMax)) * hitN));
      // 雷链与九霄雷都走紫霄雷链图集
      const lineOk = putSheetBeam('chain', fromX, fromY, b.x, b.y, b.chain ? 36 : 42, hitFr, a * 0.92);
      if (!lineOk) {
        fxGfx.moveTo(fromX, fromY);
        fxGfx.lineTo(b.x, b.y);
        fxGfx.stroke({ width: 3, color: 0xa78bfa, alpha: a });
      }
      const burstSz = (b.chain ? 92 : 108) + (1 - a) * 28;
      if (!drawSkillSheet('chain', b.x, b.y, burstSz, burstSz, hitFr, 0, Math.min(1, a * 1.05))) {
        fxGfx.circle(b.x, b.y, 18);
        fxGfx.fill({ color: 0xc084fc, alpha: a * 0.55 });
      }
    }

    // class auras (garlic / orbit / flameWheel) — cultivation sheets via Pixi
    const p = S.player;
    if (p && S.skills?.garlic) {
      const lv = typeof skillLv === 'function' ? skillLv('garlic') : 1;
      const cp = typeof comboPower === 'function' ? comboPower('garlic') : 0;
      const holySet = typeof hasSet === 'function' && hasSet('aureate-guardian');
      const rad =
        50 +
        lv * 10 +
        cp * 4 +
        (typeof skillMod === 'function' ? skillMod('garlic', 'radius') : 0) +
        (holySet ? 34 : 0);
      const sz = Math.max(120, rad * 2.15);
      const fr = Math.floor(t * 8) % 4;
      if (!drawSkillSheet('aura', p.x, p.y, sz, sz, fr, 0, 0.82)) {
        drawSoftGlow(p.x, p.y, rad, 0xfde68a, 0.35);
      }
    }
    if (p && S.skills?.orbit) {
      const lv = typeof skillLv === 'function' ? skillLv('orbit') : 1;
      const cp = typeof comboPower === 'function' ? comboPower('orbit') : 0;
      const countBonusN = typeof countBonus === 'function' ? countBonus(cp) : 0;
      const n = Math.min(10, 1 + Math.floor(lv / 2) + countBonusN);
      const rad = 54 + lv * 8 + cp * 2;
      const orbitSp = typeof orbitSpeed === 'function' ? orbitSpeed('orbit', 2.4, lv, cp) : 2.4;
      const ball = 44;
      for (let i = 0; i < n; i++) {
        const ang = t * orbitSp + (i * Math.PI * 2) / n;
        const ox = p.x + Math.cos(ang) * rad;
        const oy = p.y + Math.sin(ang) * rad;
        const spin = t * 7.5 + i * 1.1;
        drawSkillSheet('star', ox, oy, ball, ball, fr4, spin, 1);
      }
    }
    if (p && S.skills?.flameWheel) {
      const lv = typeof skillLv === 'function' ? skillLv('flameWheel') : 1;
      const cp = typeof comboPower === 'function' ? comboPower('flameWheel') : 0;
      const countBonusN = typeof countBonus === 'function' ? countBonus(cp) : 0;
      const count = Math.min(8, 1 + Math.floor(lv / 2) + countBonusN);
      const orbitSp = typeof orbitSpeed === 'function' ? orbitSpeed('flameWheel', 2.1, lv, cp) : 2.1;
      const rad = (64 + lv * 7 + cp * 2) * (S.artifacts?.includes?.('dragon') ? 1.15 : 1);
      for (let i = 0; i < count; i++) {
        const ang = -t * orbitSp + (i * Math.PI * 2) / count;
        const fx = p.x + Math.cos(ang) * rad;
        const fy = p.y + Math.sin(ang) * rad;
        const ball = 40;
        const spin = t * 8 + i;
        drawSkillSheet('flameWheel', fx, fy, ball, ball, fr4, spin, 1);
      }
    }

    // damage numbers
    let txtN = 0;
    for (const part of S.parts || []) {
      if (!part.txt || txtN >= 36 || !visible(part.x, part.y, 80)) continue;
      putDmgText(part);
      txtN++;
    }
  }

  function syncPickupsAndProj() {
    // Prefer existing WebGL effect pass (full skill sprites), else native Pixi sprites.
    if (syncWebglFxOverlay()) {
      releaseAll(skillPool);
      releaseAll(skillSpinePool);
      releaseAll(projPool);
      releaseAll(gemPool);
      releaseAll(txtPool);
      fxGfx.clear();
      return;
    }
    if (fxOverlaySpr) fxOverlaySpr.visible = false;
    syncSkillFxNative();
  }

  function renderFrame() {
    if (!ready || !app || !S?.run) return false;
    try {
      shakeX = S.shake > 0 ? (Math.random() * 4 - 2) : 0;
      shakeY = S.shake > 0 ? (Math.random() * 4 - 2) : 0;
      world.position.set(-CAMX + shakeX, -CAMY + shakeY);
      syncBg();
      syncTerrain();
      syncEnemies();
      syncPickupsAndProj();
      syncClassRelic();
      syncPlayer();
      app.render();
      // Original dzmm CultivationSpine combat animations on top of Pixi
      if (!overlayCultivationPlayer()) hideCombatSpineOverlay();
      return true;
    } catch (e) {
      if (!window.__pixiCombatRenderErrorLogged) {
        window.__pixiCombatRenderErrorLogged = true;
        console.warn('[PixiCombat] renderFrame failed', e.name, e.message, e.stack);
      }
      return false;
    }
  }

  function isReady() {
    return ready;
  }

  function clearFrame() {
    if (!ready || !app) return false;
    try {
      if (world) world.position.set(0, 0);
      releaseAll(enemyPool);
      releaseAll(barPool);
      releaseAll(terrainPool);
      releaseAll(gemPool);
      releaseAll(projPool);
      releaseAll(skillPool);
      releaseAll(skillSpinePool);
      if (playerSpr) playerSpr.visible = false;
      if (fxOverlaySpr) fxOverlaySpr.visible = false;
      if (fxGfx) fxGfx.clear();
      releaseAll(relicPool);
      hideCombatSpineOverlay();
      app.renderer.background.color = 0x080b1b;
      app.render();
      return true;
    } catch (_) {
      return false;
    }
  }

  window.PixiCombat = { init, resize, renderFrame, clearFrame, isReady };
})();
