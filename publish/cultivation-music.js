(() => {
  'use strict';

  const PATHS = {
    paladin: {
      menuBpm: 64, battleBpm: 104, root: 55,
      menu: [0, 2, 3, 2, 1, 0, 4, 2], battle: [0, 2, 4, 3, 2, 4, 5, 3],
      lead: 'bell', accent: 'drum', bass: [0, 0, 3, 2],
    },
    mage: {
      menuBpm: 76, battleBpm: 124, root: 65.41,
      menu: [0, 1, 3, 4, 3, 1, 2, 0], battle: [0, 3, 1, 4, 2, 5, 3, 1],
      lead: 'pluck', accent: 'bell', bass: [0, 3, 2, 4],
    },
    ranger: {
      menuBpm: 82, battleBpm: 142, root: 73.42,
      menu: [0, 2, 4, 5, 4, 2, 1, 3], battle: [0, 2, 4, 6, 5, 3, 7, 4],
      lead: 'pluck', accent: 'wind', bass: [0, 4, 3, 2],
    },
    lewdSaintess: {
      menuBpm: 68, battleBpm: 112, root: 65.41,
      menu: [0, 3, 2, 4, 3, 1, 2, 0], battle: [0, 3, 5, 4, 2, 4, 6, 3],
      lead: 'wind', accent: 'bell', bass: [0, 2, 3, 1],
    },
    scytheMaiden: {
      menuBpm: 58, battleBpm: 118, root: 49,
      menu: [0, 1, 3, 2, 0, -1, 1, 3], battle: [0, 3, 2, 5, 1, 4, 3, 6],
      lead: 'wind', accent: 'drum', bass: [0, -1, 2, 1],
    },
    gunslinger: {
      menuBpm: 84, battleBpm: 148, root: 61.74,
      menu: [0, 2, 1, 4, 3, 2, 5, 4], battle: [0, 2, 4, 1, 5, 3, 6, 2],
      lead: 'wood', accent: 'bell', bass: [0, 3, 1, 4],
    },
  };
  const SCALE = [0, 2, 5, 7, 9];
  const BGM_SRC = './bgm/mystic-theme.mp3?v=cultivation-audio-r2';

  function create({ ctx, destination }) {
    let timer = 0;
    let token = 0;
    let state = null;
    let volume = 1;
    let bgm = null;
    let playWarningShown = false;
    const active = new Set();

    function ensureBgm() {
      if (bgm) return bgm;
      bgm = new Audio(BGM_SRC);
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.playsInline = true;
      bgm.addEventListener('error', () => {
        console.warn('仙乐底轨加载失败，继续使用职业旋律');
      }, { once: true });
      return bgm;
    }
    function syncBgmVolume() {
      if (!bgm) return;
      const mix = state?.mode === 'battle' ? .5 : .62;
      bgm.volume = Math.max(0, Math.min(1, volume * mix));
    }
    function resumeBgm() {
      if (!state || volume <= 0) return;
      const media = ensureBgm();
      syncBgmVolume();
      if (media.paused === false) return;
      const pending = media.play();
      pending?.catch?.(error => {
        if (playWarningShown) return;
        playWarningShown = true;
        console.warn('仙乐等待玩家再次点击解锁:', error.message);
      });
    }
    function frequency(path, degree, octave = 0) {
      const index = ((degree % 5) + 5) % 5;
      const span = Math.floor(degree / 5);
      return path.root * (2 ** ((SCALE[index] + 12 * (span + octave)) / 12));
    }
    function track(node) {
      active.add(node);
      node.addEventListener('ended', () => active.delete(node), { once: true });
      return node;
    }
    function voice(freq, at, dur, type, volume, attack = .012, filter = 0) {
      const osc = track(ctx.createOscillator());
      const gain = ctx.createGain();
      let output = gain;
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(25, freq), at);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), at + attack);
      gain.gain.exponentialRampToValueAtTime(.0001, at + dur);
      if (filter) {
        const biquad = ctx.createBiquadFilter();
        biquad.type = 'lowpass';
        biquad.frequency.setValueAtTime(filter, at);
        biquad.frequency.exponentialRampToValueAtTime(Math.max(280, filter * .42), at + dur);
        osc.connect(biquad);
        biquad.connect(gain);
      } else osc.connect(gain);
      output.connect(destination);
      osc.start(at);
      osc.stop(at + dur + .03);
    }
    function pluck(freq, at, volume = .12) {
      voice(freq, at, .42, 'triangle', volume, .006, 2600);
      voice(freq * 2, at, .19, 'sine', volume * .28, .004);
    }
    function bell(freq, at, volume = .1) {
      voice(freq, at, 1.15, 'sine', volume, .008);
      voice(freq * 2.01, at, .72, 'sine', volume * .38, .006);
      voice(freq * 3.98, at, .38, 'sine', volume * .16, .004);
    }
    function wind(freq, at, volume = .09) {
      voice(freq, at, .82, 'sine', volume, .08);
      voice(freq * 2, at + .025, .56, 'triangle', volume * .2, .06, 1800);
    }
    function drum(freq, at, volume = .14) {
      const osc = track(ctx.createOscillator());
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 2.4, at);
      osc.frequency.exponentialRampToValueAtTime(freq, at + .18);
      gain.gain.setValueAtTime(volume, at);
      gain.gain.exponentialRampToValueAtTime(.0001, at + .34);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(at);
      osc.stop(at + .38);
    }
    function wood(freq, at, volume = .09) {
      voice(freq, at, .11, 'square', volume, .002, 1700);
      voice(freq * .5, at, .16, 'triangle', volume * .42, .002);
    }
    function instrument(kind, freq, at, volume) {
      ({ pluck, bell, wind, drum, wood }[kind] || pluck)(freq, at, volume);
    }
    function scheduleBar(mode, classId, barIndex) {
      const path = PATHS[classId] || PATHS.paladin;
      const bpm = mode === 'battle' ? path.battleBpm : path.menuBpm;
      const beat = 60 / bpm;
      const start = ctx.currentTime + .045;
      const motif = mode === 'battle' ? path.battle : path.menu;
      const density = mode === 'battle' ? 8 : 4;
      const step = beat * (mode === 'battle' ? .5 : 1);
      voice(frequency(path, path.bass[barIndex % 4], -1), start, beat * 3.8, 'sine', .085, .08, 520);
      for (let i = 0; i < density; i += 1) {
        const degree = motif[(barIndex * density + i) % motif.length];
        const at = start + i * step;
        instrument(path.lead, frequency(path, degree, 1), at, mode === 'battle' ? .12 : .095);
        if (mode === 'battle' && i % 2 === 0) drum(frequency(path, path.bass[(i / 2) % 4], -2), at, .14);
      }
      for (let i = 0; i < 4; i += 1) {
        const at = start + i * beat;
        if (mode === 'menu' && i % 2 === 0) instrument(path.accent, frequency(path, motif[i], 1), at + beat * .48, .065);
        if (mode === 'battle' && i % 2 === 1) instrument(path.accent, frequency(path, motif[i * 2], 1), at + beat * .72, .06);
      }
      return beat * 4;
    }
    function stop() {
      token += 1;
      clearTimeout(timer);
      timer = 0;
      state = null;
      const now = ctx.currentTime;
      active.forEach(node => { try { node.stop(now + .06); } catch (_) {} });
      active.clear();
      try { bgm?.pause(); } catch (_) {}
    }
    function start(mode, classId = 'paladin') {
      if (state?.mode === mode && state?.classId === classId && timer) {
        resumeBgm();
        return;
      }
      stop();
      state = { mode, classId, bar: 0 };
      resumeBgm();
      const runToken = token;
      const loop = () => {
        if (!state || runToken !== token) return;
        const seconds = scheduleBar(state.mode, state.classId, state.bar++);
        timer = setTimeout(loop, Math.max(250, seconds * 1000 - 35));
      };
      loop();
    }
    function setVolume(next) {
      volume = Math.max(0, Math.min(1, Number(next) || 0));
      syncBgmVolume();
      if (volume > 0) resumeBgm();
      else try { bgm?.pause(); } catch (_) {}
    }
    return { start, stop, resume: resumeBgm, setVolume };
  }

  window.CultivationMusic = { create, paths: Object.keys(PATHS) };
})();
