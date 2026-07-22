window.GameModules = window.GameModules || {};
window.GameModules.season = (() => {
  const CURRENT = 1;
  const KEY = 'arcane-season-state-v2';
  const CONFIG = {
    1: {
      name: '第一纪元',
      theme: '太虚裂界',
      levelCap: 20,
      introTitle: '第一纪元：太虚裂界',
      promo: './assets/generated/cultivation-cover-landscape.c17ae7e5.webp',
      story: [
        '千年前，太虚天门崩裂，九州灵脉从此昼夜震荡。',
        '近日北斗倒悬，妖雾自古战场涌出，被遗忘的魔尊开始借尸还魂。',
        '各大仙门开启山门，体修、符修、剑修、灵修、魂修与天工弟子同时下山应劫。',
        '你将从炼气起步，夺灵器、悟功法、炼法宝，在天劫降临前踏出自己的长生大道。'
      ],
      intro: [
        '太虚裂界开启，九州妖潮正式入侵。',
        '本纪元修为上限为 20，所有道途从炼气初境开始。',
        '纪元灵器阁、穿戴与战斗轮回录从新的仙缘起点展开。',
        '击败首领可获得魔染灵器，在淬炼祭坛洗去魔气。',
        '提升纪元修为后，可驾驭更高品阶的灵器与法宝。'
      ]
    }
  };
  let state = null, ready = false;
  async function kvGet(k){return await StorageSync.get(k)}
  async function kvPut(k,v){await StorageSync.put(k,v,'赛季')}
  async function callServer(method,args={}){return await dzmm.fn.invoke('progression',{method,args})}
  async function applyServerState(r){if(r?.season){state=normalize(r.season);await kvPut(KEY,state)}if(r?.meta)await StorageSync.put('arcane-meta-v3',r.meta,'永久强化');if(r?.rift)await StorageSync.put('arcane-rift-v1',r.rift,'秘境数据');return r}
  function normalize(v){let s=v&&typeof v==='object'?v:{};s.currentSeason=CURRENT;s.started=s.started&&typeof s.started==='object'?s.started:{};s.seasons=s.seasons&&typeof s.seasons==='object'?s.seasons:{};return s}
  async function init(){if(ready)return state;state=normalize(await kvGet(KEY));ready=true;return state}
  async function reload(){ready=false;state=null;return await init()}
  function cfg(){return CONFIG[CURRENT]}
  function started(){return !!state?.started?.[CURRENT]}
  function season(){return state?.seasons?.[CURRENT]||{level:1,xp:0,totalXp:0}}
  function level(){return Math.min(cfg().levelCap,Math.max(1,Math.floor(season().level||1)))}
  function xp(){return Math.max(0,Math.floor(season().xp||0))}
  function cap(){return cfg().levelCap}
  function need(lv=level()){return lv>=cap()?0:Math.round(80+lv*lv*22+lv*38)}
  function key(base){return `${base}-season-${CURRENT}`}
  async function start(){await init();state.started[CURRENT]=true;let cur=state.seasons[CURRENT];if(cur&&typeof cur==='object'){cur.level=Math.min(cfg().levelCap,Math.max(1,Math.floor(Number(cur.level)||1)));cur.xp=Math.max(0,Math.floor(Number(cur.xp)||0));cur.totalXp=Math.max(0,Math.floor(Number(cur.totalXp)||0));cur.startedAt=cur.startedAt||Date.now()}else cur={level:1,xp:0,totalXp:0,startedAt:Date.now()};state.seasons[CURRENT]=cur;await kvPut(KEY,state);return cur}
  async function save(){await kvPut(KEY,state)}
  async function addRunXp(run){await init();if(!started())return null;let old=level();await applyServerState(await callServer('runXp',run));let cur=season();return {gain:Math.max(0,cur.lastGain||0),level:cur.level,xp:cur.xp,next:need(cur.level),ups:Math.max(0,cur.lastUps??cur.level-old)}}
  async function grantLevel(target){await init();console.warn('客户端赛季等级直升已禁用');return{level:level(),ups:0}}
  function introHtml(){let c=cfg(),story=(c.story||[]).map((x,i)=>`<p class="seasonStoryLine" style="--i:${i}">${x}</p>`).join(''),rules=(c.intro||[]).map(x=>`<p>${x}</p>`).join(''),bg=c.promo?` style="--season-bg:url('${c.promo}')"`:'';return `<div class="seasonBg"${bg}></div><div class="seasonIntroHead"><h1 class="title">${c.introTitle}</h1><p class="sub">主题：${c.theme}</p></div><div class="seasonStoryBox"><b>纪元背景</b>${story}</div><div class="seasonRules">${rules}</div><div class="seasonStartBar"><button id="seasonStartBtn" class="startBtn" type="button">开启${c.name}</button></div>`}
  return { CURRENT, CONFIG, init, reload, started, start, cfg, season, level, xp, cap, need, key, addRunXp, grantLevel, introHtml };
})();
window.Season = window.GameModules.season;
