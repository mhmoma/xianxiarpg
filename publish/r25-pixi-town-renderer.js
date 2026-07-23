/**
 * PixiJS town hub renderer — owns #townCanvas WebGL.
 */
(function () {
  'use strict';

  let app = null;
  let world = null;
  let layers = {};
  let ready = false;
  let initPromise = null;
  let canvas = null;
  let texCache = new Map();
  let sprPool = [];
  let charPool = [];
  let labelPool = [];
  let bgFill = null;
  let groundTile = null;
  let groundKey = '';
  let pathGfx = null;
  let pathDrawn = false;
  let ringGfx = null;
  let gfx = null;
  let lastWorldW = 0;
  let lastWorldH = 0;

  function PIXI() {
    return window.PIXI;
  }

  function makeSprite() {
    const P = PIXI();
    const s = new P.Sprite(P.Texture.EMPTY);
    s.anchor.set(0.5, 1);
    s._used = false;
    s.visible = false;
    return s;
  }

  function makeCharSlot() {
    const s = makeSprite();
    s._tex = null;
    return s;
  }

  function makeLabel() {
    const P = PIXI();
    const t = new P.Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: 14,
        fill: 0xdbeafe,
        align: 'center',
        stroke: { color: 0x000000, width: 3 }
      }
    });
    t.anchor.set(0.5, 0);
    t._used = false;
    t.visible = false;
    return t;
  }

  function acquire(pool, factory, parent) {
    let s = pool.find((x) => !x._used);
    if (!s) {
      s = factory();
      parent.addChild(s);
      pool.push(s);
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

  function texFromImg(img) {
    if (!img) return null;
    const isCanvas = (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement)
      || (!!img.width && !!img.height && img.tagName === 'CANVAS');
    if (!isCanvas && (!img.complete || !img.naturalWidth)) return null;
    if (isCanvas && !(img.width > 0 && img.height > 0)) return null;
    const key = img.src || (isCanvas ? `canvas:${img.width}x${img.height}:${img._atlasKey || ''}` : String(img));
    let tex = texCache.get(key);
    if (tex) return tex;
    try {
      tex = PIXI().Texture.from(img);
      // 平滑缩放，避免 preview / 地面贴图放大后锯齿
      const src = tex.source || tex.baseTexture;
      if (src) {
        if (src.scaleMode != null) src.scaleMode = 'linear';
        if (typeof src.style?.set === 'function') {
          try {
            src.style.scaleMode = 'linear';
          } catch (_) {}
        }
      }
      texCache.set(key, tex);
      return tex;
    } catch (_) {
      return null;
    }
  }

  function texFromCanvas(cv, cacheKey, spr) {
    if (!cv) return null;
    const P = PIXI();
    if (!spr._tex) spr._tex = P.Texture.from(cv);
    else if (spr._tex.source?.update) spr._tex.source.update();
    else if (spr._tex.baseTexture?.update) spr._tex.baseTexture.update();
    return spr._tex;
  }

  /** Same transform as original Canvas2D town draw: setTransform(dpr) → scale(zoom) → translate(-cam). */
  function makeTownDrawContext(town) {
    const dpr = app?.renderer?.resolution || town.dpr || 1;
    const zoom = town.zoom || 1;
    const a = dpr * zoom;
    const e = -town.camX * a;
    const f = -town.camY * a;
    return {
      canvas,
      getTransform() {
        return { a, b: 0, c: 0, d: a, e, f };
      }
    };
  }

  /** High-res Spine overlay for player + class NPCs (no soft preview.png). */
  function overlayTownSpines(state) {
    const town = state.town;
    const gpu = window.CultivationSpineGPU;
    const townSpine = window.CultivationSpineTown;
    if (!gpu?.beginOverlay || !townSpine?.draw || !canvas) return false;
    try {
      const ctx = makeTownDrawContext(town);
      if (!gpu.beginOverlay(ctx, { minDpr: 2 })) return false;

      // 统一体感身高：按职业补偿（幽冥镰刀撑大 bounds，同 height 会显得特别矮）
      const TOWN_CHAR_H = {
        paladin: 82,
        mage: 82,
        ranger: 80,
        gunslinger: 86,
        lewdSaintess: 84,
        scytheMaiden: 122
      };
      const charH = (cls) => TOWN_CHAR_H[cls] || 82;

      // Y-sort like world objects
      const actors = [];
      for (const o of state.objects || []) {
        if (o.kind === 'class' && o.cls) {
          actors.push({
            cls: o.cls,
            key: 'town-npc-' + (o.id || o.cls),
            x: o.x,
            y: o.y,
            z: o.z || 0,
            moving: false,
            face: 1,
            height: charH(o.cls)
          });
        } else if (o.kind === 'costume') {
          actors.push({
            cls: town.cls,
            key: 'town-costume',
            x: o.x,
            y: o.y,
            moving: false,
            face: 1,
            height: charH(town.cls)
          });
        } else if (o.kind === 'player') {
          const cls = o.cls || town.cls;
          actors.push({
            cls,
            key: 'town-player',
            x: town.x,
            y: town.y,
            moving: !!town.moving,
            face: town.faceX || 1,
            height: charH(cls),
            speed: town.moving ? 1.35 : 1
          });
        }
      }
      actors.sort((a, b) => ((a.z || 0) - (b.z || 0)) || (a.y - b.y));

      let any = false;
      for (const a of actors) {
        window.CultivationSpine?.load?.(a.cls);
        const ok = townSpine.draw(ctx, a.cls, a.key, a.x, a.y, {
          moving: a.moving,
          face: a.face,
          height: a.height,
          speed: a.speed,
          clear: false,
          minDpr: 2
        });
        if (ok) any = true;
      }
      return any;
    } catch (_) {
      return false;
    }
  }

  function hideSpineOverlay() {
    try {
      const g = window.CultivationSpineGPU;
      if (g?.canvas) g.canvas.style.display = 'none';
    } catch (_) {}
  }

  async function init(cv) {
    if (ready && canvas === cv && app) return true;
    canvas = cv;
    initPromise = (async () => {
      const P = PIXI();
      if (!P || !cv) {
        console.warn('[PixiTown] PIXI or canvas missing');
        return false;
      }
      try {
        if (app) {
          try {
            app.destroy(true);
          } catch (_) {}
          app = null;
          ready = false;
        }
        sprPool = [];
        charPool = [];
        labelPool = [];
        texCache.clear();
        groundTile = null;
        groundKey = '';
        pathDrawn = false;

        app = new P.Application();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        await app.init({
          canvas: cv,
          width: Math.max(1, cv.clientWidth || 800),
          height: Math.max(1, cv.clientHeight || 600),
          background: '#050914',
          antialias: true,
          resolution: dpr,
          autoDensity: true,
          preference: 'webgl',
          powerPreference: 'high-performance',
          roundPixels: false
        });
        app.ticker.stop();

        world = new P.Container();
        app.stage.addChild(world);
        layers.bg = new P.Container();
        layers.paths = new P.Container();
        layers.props = new P.Container();
        layers.chars = new P.Container();
        layers.ui = new P.Container();
        world.addChild(layers.bg, layers.paths, layers.props, layers.chars, layers.ui);

        bgFill = new P.Graphics();
        layers.bg.addChild(bgFill);
        pathGfx = new P.Graphics();
        layers.paths.addChild(pathGfx);
        gfx = new P.Graphics();
        layers.props.addChild(gfx);
        ringGfx = new P.Graphics();
        layers.ui.addChild(ringGfx);

        for (let i = 0; i < 24; i++) {
          const s = makeSprite();
          layers.props.addChild(s);
          sprPool.push(s);
        }
        for (let i = 0; i < 14; i++) {
          const c = makeCharSlot();
          layers.chars.addChild(c);
          charPool.push(c);
          const lab = makeLabel();
          layers.ui.addChild(lab);
          labelPool.push(lab);
        }

        ready = true;
        console.info('[PixiTown] ready');
        return true;
      } catch (e) {
        console.error('[PixiTown] init failed', e);
        ready = false;
        return false;
      }
    })();
    return initPromise;
  }

  function resize(vw, vh, dpr) {
    if (!ready || !app?.renderer) return;
    const res = Math.min(dpr || window.devicePixelRatio || 1, 2);
    app.renderer.resolution = res;
    app.renderer.resize(Math.max(1, vw), Math.max(1, vh));
  }

  function syncGround(town, groundImg) {
    const key =
      (groundImg?.src || '') +
      '|' +
      town.worldW +
      'x' +
      town.worldH;
    if (groundKey === key && groundTile) return;
    groundKey = key;

    bgFill.clear();
    bgFill.rect(0, 0, town.worldW, town.worldH);
    bgFill.fill(0x07111b);

    if (groundTile) {
      try {
        layers.bg.removeChild(groundTile);
        groundTile.destroy();
      } catch (_) {}
      groundTile = null;
    }

    const tex = texFromImg(groundImg);
    const P = PIXI();
    if (tex && P.TilingSprite) {
      groundTile = new P.TilingSprite({
        texture: tex,
        width: town.worldW,
        height: town.worldH
      });
      groundTile.tileScale.set(
        512 / Math.max(1, groundImg.naturalWidth || 512),
        512 / Math.max(1, groundImg.naturalHeight || 512)
      );
      layers.bg.addChild(groundTile);
    }
    pathDrawn = false;
  }

  function drawPaths(town) {
    if (pathDrawn && lastWorldW === town.worldW && lastWorldH === town.worldH) return;
    pathDrawn = true;
    lastWorldW = town.worldW;
    lastWorldH = town.worldH;
    pathGfx.clear();
    const c = { x: 1200, y: 710 };
    // Match 修仙/原版青绿石路，低透明度，避免棕色大块遮挡地面
    pathGfx.setStrokeStyle({ width: 88, color: 0x6e9682, alpha: 0.22, cap: 'round', join: 'round' });
    pathGfx.moveTo(town.worldW / 2, town.worldH);
    pathGfx.lineTo(town.worldW / 2, c.y + 20);
    pathGfx.lineTo(1440, 590);
    pathGfx.moveTo(c.x, c.y + 40);
    pathGfx.lineTo(1515, 845);
    pathGfx.stroke();
    pathGfx.setStrokeStyle({ width: 46, color: 0xd4af6a, alpha: 0.1, cap: 'round' });
    pathGfx.moveTo(town.worldW / 2, town.worldH);
    pathGfx.lineTo(town.worldW / 2, c.y + 20);
    pathGfx.lineTo(1440, 590);
    pathGfx.moveTo(c.x, c.y + 40);
    pathGfx.lineTo(1515, 845);
    pathGfx.stroke();
    pathGfx.setStrokeStyle({ width: 28, color: 0x5a8c96, alpha: 0.28 });
    pathGfx.rect(40, 40, town.worldW - 80, town.worldH - 80);
    pathGfx.stroke();
  }

  function putShadow(x, y, rx, ry) {
    gfx.ellipse(x, y - 8, rx || 26, ry || 9);
    gfx.fill({ color: 0x000000, alpha: 0.28 });
  }


  const _atlasTexCache = new Map();
  function atlasTexFromImg(img, atlas) {
    if (!img || !atlas) return texFromImg(img);
    const key = `${img.src || ''}#${atlas.cols}x${atlas.rows}:${atlas.index}`;
    if (_atlasTexCache.has(key)) return _atlasTexCache.get(key);
    if (!img.complete || !img.naturalWidth) return null;
    const cols = atlas.cols || 4, rows = atlas.rows || 4;
    const fw = img.naturalWidth / cols, fh = img.naturalHeight / rows;
    const ix = (atlas.index || 0) % cols, iy = Math.floor((atlas.index || 0) / cols);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(fw));
    c.height = Math.max(1, Math.round(fh));
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(img, ix * fw, iy * fh, fw, fh, 0, 0, c.width, c.height);
    // 注意：不能走 texFromImg(canvas)——canvas 没有 complete/naturalWidth，会恒为 null
    let tex = null;
    try {
      tex = PIXI().Texture.from(c);
      const src = tex.source || tex.baseTexture;
      if (src) {
        if (src.scaleMode != null) src.scaleMode = 'linear';
        if (typeof src.style?.set === 'function') {
          try { src.style.scaleMode = 'linear'; } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[PixiTown] atlas frame failed', e?.message || e);
      return null;
    }
    if (tex) _atlasTexCache.set(key, tex);
    return tex;
  }
  function toGameSrc(src) {
    if (!src) return src;
    return String(src).replace(/^\/publish\//, './').replace(/^\.\.\/publish\//, './').replace(/^\.\/publish\//, './').replace(/^publish\//, './');
  }

  const remoteImgCache = new Map();
  function loadRemoteImg(src) {
    if (!src) return null;
    const key = String(src);
    if (remoteImgCache.has(key)) return remoteImgCache.get(key);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.src = key;
    remoteImgCache.set(key, im);
    return im;
  }

  function putProp(img, x, y, w, h, glowColor, xf) {
    const tex = (xf && xf.atlas) ? atlasTexFromImg(img, xf.atlas) : texFromImg(img);
    if (!tex) return;
    putShadow(x, y - h * 0.15, w * 0.34, 7);
    const spr = acquire(sprPool, makeSprite, layers.props);
    spr.texture = tex;
    spr.anchor.set(0.5, 1);
    spr.width = w;
    spr.height = h;
    spr.scale.x = Math.abs(spr.scale.x) * ((xf && xf.flipX) ? -1 : 1);
    spr.scale.y = Math.abs(spr.scale.y) * ((xf && xf.flipY) ? -1 : 1);
    spr.rotation = ((xf && xf.rotation) || 0) * Math.PI / 180;
    spr.x = x;
    spr.y = y;
    spr.alpha = 1;
    spr.tint = 0xffffff;
    try {
      spr.blendMode = PIXI().BLEND_MODES?.NORMAL ?? 'normal';
    } catch (_) {}
    if (glowColor != null) {
      gfx.circle(x, y - h * 0.45, Math.max(18, w * 0.28));
      gfx.fill({ color: glowColor, alpha: 0.18 });
    }
  }

  function putLabel(text, x, y, hi) {
    const lab = acquire(labelPool, makeLabel, layers.ui);
    lab.text = text || '';
    lab.style.fill = hi ? 0xfff2a8 : 0xdbeafe;
    lab.x = x;
    lab.y = y;
  }

  /**
   * Shadow + label only — body is high-res Spine overlay (player + class NPCs).
   */
  function drawChar(state, cls, x, y, hi, isPlayer) {
    putShadow(x, y, 28, 10);
    putLabel(state.className(cls), x, y + 18, !!(hi || isPlayer));
    return { needsSpine: true, cls, x, y };
  }

  function drawPlayerPreviewFallback(state, cls, x, y) {
    const spr = acquire(charPool, makeCharSlot, layers.chars);
    const src = state.heroSrc(cls);
    const img = state.getImg(src);
    const tex = texFromImg(img);
    if (!tex) {
      spr._used = false;
      spr.visible = false;
      return;
    }
    spr.texture = tex;
    spr.anchor.set(0.5, 1);
    const dh = 118;
    const dw = Math.min(110, dh * (img.naturalWidth / Math.max(1, img.naturalHeight)));
    spr.width = dw;
    spr.height = dh;
    spr.x = x;
    spr.y = y;
    spr.tint = 0xfff2a8;
    spr.alpha = 1;
  }

  function renderFrame(state) {
    if (!ready || !app || !state?.town) return false;
    try {
      const town = state.town;
      const zoom = town.zoom || 1;
      world.scale.set(zoom);
      world.position.set(-town.camX * zoom, -town.camY * zoom);

      syncGround(town, state.groundImg);
      drawPaths(town);

      releaseAll(sprPool);
      releaseAll(charPool);
      releaseAll(labelPool);
      gfx.clear();
      ringGfx.clear();

      let playerDraw = null;
      const objs = (state.objects || []).slice().sort((a, b) => ((a.z || 0) - (b.z || 0)) || (a.y - b.y));
      for (const o of objs) {
        if (o.kind === 'player') {
          playerDraw = drawChar(state, o.cls || town.cls, o.x, o.y, true, true);
        } else if (o.kind === 'class') {
          drawChar(state, o.cls, o.x, o.y, town.near?.id === o.id, false);
        } else if (o.kind === 'costume') {
          drawChar(state, town.cls, o.x, o.y, town.near?.id === 'costume', false);
          gfx.circle(o.x + 30, o.y - 72, 16);
          gfx.fill({ color: 0xec4899, alpha: 0.92 });
          gfx.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.72 });
          gfx.circle(o.x + 30, o.y - 72, 16);
          gfx.stroke();
          putLabel('服', o.x + 30, o.y - 67, true);
        } else if (o.kind === 'portal') putProp(state.getImg(state.PORTAL), o.x, o.y, o.w || 132, o.h || 154, 0x67e8f9, o);
        else if (o.kind === 'chest') putProp(state.getImg(state.CHEST), o.x, o.y, o.w || 82, o.h || 76, 0xfacc15, o);
        else if (o.kind === 'fire') {
          const fw = o.w || 92, fh = o.h || 88;
          putProp(state.getImg(state.FIRE), o.x, o.y, fw, fh, 0x67e8f9, o);
          gfx.circle(o.x, o.y - fh * 0.48, Math.max(10, fw * 0.2));
          gfx.fill({ color: 0xa5f3fc, alpha: 0.28 + Math.sin(performance.now() / 120) * 0.1 });
        } else if (o.kind === 'crates') putProp(state.getImg(state.CRATES), o.x, o.y, o.w || 58, o.h || 54, null, o);
        else if (o.src || o.atlas || String(o.kind || '').startsWith('decor-') || String(o.kind || '').startsWith('house-') || String(o.kind || '').startsWith('terrain-')) {
          let src = toGameSrc(o.src);
          if (!src && String(o.kind || '').startsWith('terrain-')) {
            src = './assets/generated/terrain-atlas.d35ccacd-cb20260722x-alpha.webp';
          }
          let img = (state.getImg && src) ? state.getImg(src) : null;
          if (!img || !(img.complete && img.naturalWidth)) img = loadRemoteImg(src);
          if (img && img.complete && img.naturalWidth) {
            putProp(img, o.x, o.y, o.w || 96, o.h || 96, null, o);
          } else if (String(o.kind || '').startsWith('terrain-')) {
            // 图未就绪时先画占位，避免“完全看不见”
            gfx.circle(o.x, o.y - 24, 18);
            gfx.fill({ color: 0x34d399, alpha: 0.55 });
          }
        }
      }

      if (town.near) {
        ringGfx.setStrokeStyle({ width: 3, color: 0xfacc15, alpha: 0.95 });
        ringGfx.circle(town.near.x, town.near.y, town.near.r);
        ringGfx.stroke();
      }

      app.render();

      // High-res Spine for player + class NPCs
      const ok = overlayTownSpines(state);
      if (!ok) {
        for (const o of objs) {
          if (o.kind === 'player') {
            drawPlayerPreviewFallback(state, o.cls || town.cls, town.x, town.y);
          } else if (o.kind === 'class' && o.cls) {
            drawPlayerPreviewFallback(state, o.cls, o.x, o.y);
          }
        }
        app.render();
        hideSpineOverlay();
      }

      return true;
    } catch (e) {
      console.warn('[PixiTown] render failed', e.message);
      return false;
    }
  }

  function isReady() {
    return ready;
  }

  function destroy() {
    ready = false;
    initPromise = null;
    hideSpineOverlay();
    try {
      app?.destroy?.(true);
    } catch (_) {}
    app = null;
    world = null;
    canvas = null;
    groundTile = null;
    groundKey = '';
    pathDrawn = false;
    texCache.clear();
    sprPool = [];
    charPool = [];
    labelPool = [];
  }

  window.PixiTown = { init, resize, renderFrame, isReady, destroy };
})();
