(() => {
  'use strict';

  const config = window.CultivationSpineConfig;
  const spine = window.spine;
  if (!config?.classes || !spine?.canvas) {
    console.warn('Spine角色运行时不可用，继续使用原角色素材');
    return;
  }

  const actors = new Map(), pending = new Map();
  let forcedAction = null;
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`图片加载失败: ${src}`));
      image.src = src;
    });
  }

  async function fetchAsset(src, type) {
    const response = await fetch(src, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${src}`);
    return type === 'text' ? response.text() : response.arrayBuffer();
  }
  async function createActor(id) {
    const def = config.classes[id];
    if (!def) return null;
    const [atlasText, binaryData, image] = await Promise.all([
      fetchAsset(def.atlas, 'text'),
      fetchAsset(def.skeleton, 'binary'),
      loadImage(def.texture),
    ]);
    const texture = new spine.canvas.CanvasTexture(image);
    const atlas = new spine.TextureAtlas(atlasText, () => texture);
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const binary = new spine.SkeletonBinary(loader);
    const data = binary.readSkeletonData(new Uint8Array(binaryData));
    const skeleton = new spine.Skeleton(data);
    skeleton.scaleY = -1;
    const stateData = new spine.AnimationStateData(data);
    stateData.defaultMix = 0.08;
    const state = new spine.AnimationState(stateData);
    const renderer = new spine.canvas.SkeletonRenderer(window.ctx);
    renderer.triangleRendering = true;
    state.setAnimation(0, def.animations.idle, true);
    state.apply(skeleton);
    skeleton.updateWorldTransform();
    const offset = new spine.Vector2();
    const size = new spine.Vector2();
    skeleton.getBounds(offset, size, []);
    return {
      id, def, data, skeleton, state, renderer,
      bounds: { offset, size },
      action: 'idle',
      lockUntil: 0,
      lastTime: performance.now(),
    };
  }
  function load(id) {
    if (actors.has(id)) return Promise.resolve(actors.get(id));
    if (pending.has(id)) return pending.get(id);
    const task = createActor(id).then(actor => {
      pending.delete(id);
      if (actor) actors.set(id, actor);
      return actor;
    }).catch(error => {
      pending.delete(id);
      console.error('Spine角色加载失败:', id, error.message, error.stack);
      return null;
    });
    pending.set(id, task);
    return task;
  }
  function clipDuration(actor, action) {
    const name = actor.def.animations[action];
    return actor.data.findAnimation(name)?.duration || 0.5;
  }
  function play(actor, action, now) {
    if (actor.action === action) return;
    const name = actor.def.animations[action] || actor.def.animations.idle;
    const loop = action === 'idle' || action === 'run';
    const entry = actor.state.setAnimation(0, name, loop);
    entry.timeScale = config.speeds[action] || 1;
    actor.action = action;
    actor.lockUntil = loop ? 0 : now + Math.min(
      action === 'skill' ? 1050 : 720,
      clipDuration(actor, action) / entry.timeScale * 920,
    );
  }

  function desiredAction(actor, player, row, now) {
    if (forcedAction && forcedAction.until > now) return forcedAction.action;
    if (actor.action === 'skill' && actor.lockUntil > now) return 'skill';
    if ((player.cast || 0) > 0 || row === 2) return 'attack';
    if (row === 3) return 'hurt';
    if (actor.lockUntil > now) return actor.action;
    return player.moving || row === 1 ? 'run' : 'idle';
  }

  function drawActor(actor, x, y, row, alpha, face) {
    const player = window.S.player;
    const now = performance.now();
    play(actor, desiredAction(actor, player, row, now), now);
    const delta = Math.min(0.05, Math.max(0, (now - actor.lastTime) / 1000));
    actor.lastTime = now;
    actor.state.update(delta);
    actor.state.apply(actor.skeleton);
    actor.skeleton.updateWorldTransform();
    actor.skeleton.color.a = Number.isFinite(alpha) ? alpha : 1;
    const bounds = actor.bounds;
    const scale = actor.def.height / Math.max(1, bounds.size.y);
    const centerX = bounds.offset.x + bounds.size.x / 2;
    const bottom = bounds.offset.y + bounds.size.y;
    window.ctx.save();
    window.ctx.translate(x, y + actor.def.groundOffset);
    window.ctx.scale((face || 1) * actor.def.facing * scale, scale);
    window.ctx.translate(-centerX, -bottom);
    actor.renderer.draw(actor.skeleton);
    window.ctx.restore();
  }

  function installDrawPatch() {
    const fallback = window.drawAction;
    if (typeof fallback !== 'function' || fallback.__cultivationSpine) return;
    const wrapped = function (image, x, y, size, row, frame, alpha = 1, face = 1) {
      const player = window.S?.player;
      const isPlayer = player && image === window.imgs?.[player.cls]
        && Math.abs(x - player.x) < 3 && Math.abs(y - player.y) < 7;
      if (!isPlayer || !config.classes[player.cls]) {
        return fallback.apply(this, arguments);
      }
      const actor = actors.get(player.cls);
      if (!actor) {
        load(player.cls);
        return fallback.apply(this, arguments);
      }
      drawActor(actor, x, y, row, alpha, face);
    };
    wrapped.__cultivationSpine = true;
    window.drawAction = wrapped;
  }

  function trigger(action = 'skill', duration = 420) {
    forcedAction = { action, until: performance.now() + duration };
    const id = window.S?.player?.cls;
    if (id) load(id);
  }

  function wrapSkillFunction(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__cultivationSpine) return;
    const wrapped = function () {
      trigger('skill');
      return original.apply(this, arguments);
    };
    wrapped.__cultivationSpine = true;
    window[name] = wrapped;
  }

  function installIntegrations() {
    installDrawPatch();
    ['burstAt', 'lightBurstAt', 'areaOnTarget', 'fallingAttack',
      'prayerField', 'castFlail', 'castShield'].forEach(wrapSkillFunction);
    const cosmetics = window.Cosmetics;
    if (cosmetics?.drawSelected && !cosmetics.drawSelected.__cultivationSpine) {
      const original = cosmetics.drawSelected;
      const wrapped = function (player) {
        if (player === window.S?.player && config.classes[player.cls]) return false;
        return original.apply(this, arguments);
      };
      wrapped.__cultivationSpine = true;
      cosmetics.drawSelected = wrapped;
    }
    const rift = window.RiftWebGL;
    if (rift?.renderFrame && !rift.renderFrame.__cultivationSpine) {
      const original = rift.renderFrame;
      const wrapped = function () {
        if (config.classes[window.S?.player?.cls]) return false;
        return original.apply(this, arguments);
      };
      wrapped.__cultivationSpine = true;
      rift.renderFrame = wrapped;
    }
  }

  Object.entries(config.classes).forEach(([id, def]) => {
    const card = window.CLASSES?.[id]?.card;
    if (card && window.AS) window.AS[card] = def.preview;
  });
  document.addEventListener('pointerover', event => {
    const id = event.target.closest?.('[data-c]')?.dataset.c;
    if (id && config.classes[id]) load(id);
  }, { passive: true });
  installIntegrations();
  window.CultivationSpine = { load, playSkill: () => trigger('skill', 560), actors };
})();
