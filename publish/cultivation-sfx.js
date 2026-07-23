(() => {
  'use strict';

  // 分职业技能音色 + 打击 / 怪物受击（Web Audio 合成，离线可用）
  const CLASS_TONE = {
    paladin: { mul: 1.0, typeBias: 'triangle', noise: 1.0, bright: 1.08, id: 'paladin' },
    mage: { mul: 1.12, typeBias: 'sine', noise: .82, bright: 1.18, id: 'mage' },
    ranger: { mul: 1.2, typeBias: 'triangle', noise: 1.15, bright: 1.22, id: 'ranger' },
    gunslinger: { mul: .92, typeBias: 'square', noise: 1.35, bright: .95, id: 'gunslinger' },
    scytheMaiden: { mul: .78, typeBias: 'sawtooth', noise: 1.1, bright: .82, id: 'scytheMaiden' },
    lewdSaintess: { mul: 1.05, typeBias: 'sine', noise: .7, bright: 1.1, id: 'lewdSaintess' },
  };

  function clsTone() {
    const id = (typeof musicClass === 'function' ? musicClass() : null)
      || window.S?.player?.cls
      || window.pendingClass
      || 'paladin';
    return CLASS_TONE[id] || CLASS_TONE.paladin;
  }

  function canPlay(key, gap) {
    if (!audio) return false;
    const now = audio.ctx.currentTime;
    if (audio.last[key] && now - audio.last[key] < gap) return false;
    audio.last[key] = now;
    return true;
  }

  function castSfx(family) {
    if (!audio || typeof tone !== 'function') return;
    const t = clsTone();
    const m = t.mul;
    const n = t.noise;
    const b = t.bright;
    const soft = t.typeBias;
    if (family === 'lance') {
      tone(520 * m, .12, soft, .08, 'fx', 0, 980 * b);
      tone(1040 * m, .18, 'sine', .05, 'fx', .03);
      noise(.08 * n, .045, .02, 'highpass', 1800 * b);
      if (t.id === 'paladin') tone(392 * m, .22, 'triangle', .04, 'fx', .05, 784 * b);
    } else if (family === 'holy') {
      arp([392, 587, 784, 1174].map(x => x * m), .18, soft, .055, .035);
      tone(196 * m, .28, 'sine', .045, 'fx', 0, 294 * b);
      if (t.id === 'lewdSaintess') tone(660 * m, .2, 'sine', .035, 'fx', .06);
    } else if (family === 'magic') {
      arp([520, 660, 880].map(x => x * m), .12, soft, .055);
      tone(260 * m, .22, 'sine', .045, 'fx', 0, 390 * b);
      if (t.id === 'mage') tone(1320 * m, .16, 'sine', .03, 'fx', .08);
    } else if (family === 'fire') {
      noise(.22 * n, .12, 0, 'lowpass', 1400);
      tone(120 * m, .18, 'sawtooth', .09, 'fx', 0, 70);
      tone(520 * m, .16, soft, .045, 'fx', .03, 760 * b);
    } else if (family === 'ice') {
      arp([740, 988, 1318].map(x => x * m), .16, 'sine', .045, .03);
      noise(.12 * n, .045, .02, 'highpass', 2600 * b);
    } else if (family === 'slash') {
      noise(.12 * n, .075, 0, 'highpass', 2100 * b);
      tone(900 * m, .1, soft, .07, 'fx', 0, 520);
      if (t.id === 'scytheMaiden') tone(140 * m, .2, 'sawtooth', .05, 'fx', .02, 70);
      if (t.id === 'ranger') tone(1480 * m, .08, 'triangle', .04, 'fx', .04);
    } else if (family === 'throw' || family === 'gun') {
      noise(.1 * n, .09, 0, 'bandpass', 1200 * b);
      tone(190 * m, .12, t.id === 'gunslinger' ? 'square' : 'sawtooth', .055, 'fx', 0, 130);
      if (t.id === 'gunslinger') {
        noise(.05 * n, .07, .02, 'highpass', 2800);
        tone(880 * m, .05, 'square', .04, 'fx', .01);
      }
    } else if (family === 'beam') {
      tone(220 * m, .28, 'sawtooth', .055, 'fx', 0, 330 * b);
      tone(880 * m, .26, soft, .045, 'fx', 0, 660 * b);
      noise(.18 * n, .045, .04, 'bandpass', 1700);
    } else if (family === 'boom') {
      noise(.28 * n, .18, 0, 'lowpass', 900);
      tone(82 * m, .26, 'sine', .13, 'fx', 0, 48);
      tone(164 * m, .18, soft, .055, 'fx', .04, 96);
    } else if (family === 'chain') {
      for (let i = 0; i < 4; i++) {
        tone((900 + Math.random() * 500) * m, .045, 'square', .055, 'fx', i * .035, (500 + Math.random() * 400) * b);
      }
      noise(.08 * n, .05, 0, 'highpass', 3000 * b);
    } else if (family === 'rift') {
      tone(140 * m, .34, 'sawtooth', .07, 'fx', 0, 55);
      tone(70 * m, .38, 'sine', .09, 'fx', .04, 42);
      noise(.28 * n, .06, .04, 'lowpass', 500);
    } else if (family === 'poison') {
      noise(.22 * n, .07, 0, 'bandpass', 520);
      tone(180 * m, .25, 'sawtooth', .045, 'fx', 0, 120);
    } else if (family === 'fall') {
      tone(360 * m, .22, 'sawtooth', .07, 'fx', 0, 80);
      noise(.18 * n, .085, .06, 'lowpass', 700);
    } else if (family === 'lust') {
      arp([392, 523, 659].map(x => x * m), .14, 'sine', .045, .04);
      tone(220 * m, .28, 'sine', .04, 'fx', 0, 330 * b);
      noise(.1 * n, .03, .05, 'bandpass', 900);
    } else {
      tone(420 * m, .07, soft, .07, 'fx', 0, 720 * b);
      tone(980 * m, .09, 'sine', .04, 'fx', .025);
      noise(.055 * n, .03, 0, 'highpass', 2200);
    }
  }

  function mobHitSfx(crit) {
    if (!canPlay(crit ? 'critHit' : 'mobHit', crit ? .045 : .055)) return;
    const t = clsTone();
    const m = t.mul;
    if (crit) {
      tone(880 * m, .07, 'triangle', .06, 'fx', 0, 1320 * t.bright);
      tone(1320 * m, .09, 'sine', .04, 'fx', .02);
      noise(.05 * t.noise, .05, 0, 'highpass', 2400);
    } else {
      noise(.06 * t.noise, .055, 0, 'bandpass', 900 + Math.random() * 700);
      tone(180 * m + Math.random() * 40, .07, 'triangle', .045, 'fx', 0, 90);
    }
  }

  function hurtSfx() {
    if (!canPlay('hurt', .09)) return;
    noise(.12, .08, 0, 'lowpass', 700);
    tone(160, .14, 'sawtooth', .06, 'fx', 0, 70);
    tone(90, .18, 'sine', .05, 'fx', .03, 50);
  }

  // —— 走路 / 跑步脚步（全职业共用）——
  const FOOTSTEP_URL = './sfx/footstep-xiandao-r1.wav?v=foot-r1-20260724';
  let stepBuf = null;
  let stepLoad = null;
  let stepPhase = 0;

  function ensureStepBuf() {
    if (stepBuf || !audio?.ctx) return stepLoad;
    if (stepLoad) return stepLoad;
    stepLoad = fetch(FOOTSTEP_URL, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('footstep missing'))))
      .then((ab) => audio.ctx.decodeAudioData(ab.slice(0)))
      .then((buf) => { stepBuf = buf; return buf; })
      .catch((e) => {
        console.warn('[sfx] footstep wav fallback', e?.message || e);
        stepLoad = null;
        return null;
      });
    return stepLoad;
  }

  function footstepSynth() {
    if (!audio || typeof noise !== 'function' || typeof tone !== 'function') return;
    const f = 70 + Math.random() * 36;
    noise(.05, .048 + Math.random() * .02, 0, 'lowpass', 320 + Math.random() * 220);
    tone(f, .065, 'sine', .035, 'fx', 0, f * .62);
    noise(.018, .022, .008, 'highpass', 1600 + Math.random() * 800);
  }

  function playFootstep() {
    if (!audio?.ctx) return;
    try { typeof initAudio === 'function' && initAudio(); } catch (_) {}
    audio.ctx.resume?.();
    ensureStepBuf();
    if (stepBuf) {
      const src = audio.ctx.createBufferSource();
      const g = audio.ctx.createGain();
      src.buffer = stepBuf;
      src.playbackRate.value = .86 + Math.random() * .32;
      const vol = .11 + Math.random() * .05;
      const t0 = audio.ctx.currentTime;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(.001, t0 + .14);
      src.connect(g);
      g.connect(audio.fx);
      src.start(t0);
      return;
    }
    footstepSynth();
  }

  /** 走 / 跑时按间隔踩点；run=true 间隔更短 */
  function tickFootsteps(moving, dt = 1 / 60, run = true) {
    if (!moving) {
      stepPhase = 0;
      return;
    }
    if (!audio) {
      try { typeof initAudio === 'function' && initAudio(); } catch (_) {}
      if (!audio) return;
    }
    const gap = run ? .28 : .36;
    stepPhase += Math.max(0, Number(dt) || 0);
    let guard = 0;
    while (stepPhase >= gap && guard++ < 3) {
      stepPhase -= gap;
      playFootstep();
    }
  }

  function sfxClassAware(k) {
    if (!audio) return;
    if (k === 'mobHit') return mobHitSfx(false);
    if (k === 'critHit') return mobHitSfx(true);
    if (k === 'hurt') return hurtSfx();
    if (k === 'step' || k === 'footstep') return playFootstep();
    if (!canPlay(k, .08)) return;
    if (k === 'click') {
      tone(784, .09, 'sine', .05, 'fx', 0, 1175);
      tone(1175, .12, 'sine', .035, 'fx', .03);
      noise(.04, .02, 0, 'highpass', 2800);
      return;
    }
    castSfx(k);
  }

  window.sfx = sfxClassAware;
  window.CultivationSfx = { tickFootsteps, playFootstep, ensureStepBuf };
  try { sfx = sfxClassAware; } catch (_) {}

  function wrapDamage() {
    if (typeof dealDamage !== 'function' || dealDamage.__classSfx) return;
    const prev = dealDamage;
    function wrapped(e, d, steal, id) {
      const before = e?.hp;
      const out = prev(e, d, steal, id);
      if (e && before != null && e.hp < before) {
        if (e._nextCrit) sfxClassAware('critHit');
        else sfxClassAware('mobHit');
      }
      return out;
    }
    wrapped.__classSfx = true;
    dealDamage = wrapped;
    try { window.dealDamage = wrapped; } catch (_) {}
  }

  function wrapHurt() {
    if (typeof takePlayerDamage !== 'function' || takePlayerDamage.__classSfx) return;
    const prev = takePlayerDamage;
    function wrapped(amount, source, attr) {
      const before = window.S?.player?.hp;
      const out = prev(amount, source, attr);
      const after = window.S?.player?.hp;
      if (before != null && after != null && after < before) sfxClassAware('hurt');
      return out;
    }
    wrapped.__classSfx = true;
    takePlayerDamage = wrapped;
    try { window.takePlayerDamage = wrapped; } catch (_) {}
  }

  function install() {
    wrapDamage();
    wrapHurt();
  }
  install();
  setTimeout(install, 0);
  setTimeout(install, 400);

  // 预热脚步采样（有 AudioContext 后）
  try {
    document.addEventListener('pointerdown', () => {
      try { typeof initAudio === 'function' && initAudio(); } catch (_) {}
      ensureStepBuf();
    }, { once: true });
  } catch (_) {}

  console.info('职业音效已启用：分角色技能音色、打击音、怪物受击音、走路音');
})();
