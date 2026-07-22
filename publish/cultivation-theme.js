(() => {
  'use strict';

  const data = window.CultivationThemeData;
  const { classes, skills, evolutions, relicNames, artifactNames, replacements } = data;

  function rewrite(value) {
    let text = String(value);
    for (const [from, to] of replacements) text = text.split(from).join(to);
    return text;
  }
  function walk(value) {
    if (Array.isArray(value)) value.forEach((item, index) => {
      if (typeof item === 'string') value[index] = rewrite(item);
      else if (item && typeof item === 'object') walk(item);
    });
    else if (value && typeof value === 'object') Object.keys(value).forEach(key => {
      if (typeof value[key] === 'string') value[key] = rewrite(value[key]);
      else if (value[key] && typeof value[key] === 'object') walk(value[key]);
    });
    return value;
  }
  function applyData() {
    Object.entries(classes).forEach(([id, data]) => {
      if (!window.CLASSES?.[id]) return;
      CLASSES[id].cn = data[0];
      CLASSES[id].desc = data[1];
    });
    if (window.MAPS) {
      const maps = {
        chaos: ['太虚荒原', '初阶', '混沌', '灵气紊乱却最适合初次历练，击败魔尊可夺取洞天宝匣。'],
        ruins: ['上古剑冢', '精英', '金煞', '残剑与石傀守护古宗遗藏，灵石收益更高。'],
        frost: ['北冥雪境', '玄冰', '寒魄', '北冥寒潮压制身法，妖后会释放玄冰剑雨。'],
        rift: ['太虚洞天', '层级', '劫煞', '逐层深入太虚洞天，镇压守关妖尊并淬炼高阶灵器。'],
      };
      MAPS.forEach(map => {
        const data = maps[map.id];
        if (data) [map.name, map.state, map.element, map.desc] = data;
      });
    }
    Object.entries(skills).forEach(([id, data]) => {
      if (window.INFO?.[id]) INFO[id] = [data[0], `${data[1]} 参悟可提升威力、范围或运转速度。`];
      if (window.ATTACK_NAME?.[id]) ATTACK_NAME[id] = data[0];
      if (window.TAGS?.[id]) TAGS[id] = rewrite(TAGS[id]);
      if (window.SKILL_DETAILS?.[id]) walk(SKILL_DETAILS[id]);
    });
    Object.entries(evolutions).forEach(([id, name]) => {
      if (window.EVOLUTIONS?.[id]) {
        EVOLUTIONS[id].name = name;
        EVOLUTIONS[id].desc = rewrite(EVOLUTIONS[id].desc);
      }
    });
    window.ARTIFACTS?.forEach((item, index) => {
      if (artifactNames[index]) item[1] = artifactNames[index];
      item[2] = rewrite(item[2]);
    });
    window.RELIC_TREE && Object.values(RELIC_TREE).flat().forEach(node => {
      node[1] = relicNames[node[0]] || rewrite(node[1]);
      node[2] = rewrite(node[2]);
    });
    walk(window.BUILDS); walk(window.BUILD_GUIDE); walk(window.RIFT_EXTRA_BUILDS);
    const season = window.Season?.CONFIG?.[1];
    if (season) Object.assign(season, {
      name: '第一纪元', theme: '太虚裂界', introTitle: '第一纪元：太虚裂界',
      promo: './assets/generated/cultivation-cover.9b2f3725.webp',
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
      ],
    });
    const equipData = window.GameModules?.equipData;
    if (equipData) walk(equipData);
    if (window.Equipment) {
      walk(Equipment.all);
      walk(Equipment.CLS_CN);
      walk(Equipment.RES_CN);
      const special = {
        'sacrifice-laoyang-5090': ['太虚古镜', '镜中封存一缕上古器灵，可将临身恐惧转入镜海，再借斩妖与御敌恢复镜中灵息。', '照见太虚：以镜海承担部分致命冲击，并震慑周围妖邪。'],
        'sacrifice-hard-drive': ['无字天书', '天书不着一字，却能映照已穿戴灵器的道韵，使残缺套装提前显化完整传承。', '万法残响：降低所有已穿戴套装的完整传承需求。'],
        'unique-saint-nail': ['暗金·降魔杵'], 'unique-thunder-bow': ['暗金·雷霄剑匣'],
        'unique-star-tome': ['暗金·周天星册'], 'unique-plague-bell': ['暗金·万蛊摄魂铃'],
        'unique-blaze-core': ['暗金·太阳真火种'], 'unique-void-lantern': ['暗金·归墟引魂灯'],
        'unique-dragon-heart': ['暗金·烛龙心鳞'], 'unique-elite-boots': ['暗金·踏云履'],
        'unique-moon-crown': ['暗金·广寒冠'], 'unique-blood-plate': ['暗金·血河法袍'],
        'unique-clock-gloves': ['暗金·逆时轮'], 'unique-rose-mirror': ['暗金·红尘照心镜'],
        'unique-abyss-mask': ['暗金·太虚无相面'], 'unique-golem-soul': ['暗金·山河镇岳印'],
        'unique-demon-horn': ['暗金·天魔断角'], 'unique-pale-ring': ['暗金·太阴轮戒'],
        'unique-faith-boots': ['暗金·朝圣云履'], 'unique-hunt-quiver': ['暗金·万剑匣'],
      };
      Equipment.all.forEach(item => {
        const themed = special[item.baseId];
        if (!themed) return;
        [item.name, item.lore, item.aspect] = [themed[0], themed[1] || item.lore, themed[2] || item.aspect];
      });
    }
  }
  function renderClasses() {
    const order = ['paladin', 'mage', 'ranger', 'gunslinger', 'lewdSaintess', 'scytheMaiden'];
    const portraits = window.CultivationSpineConfig?.classes || {};
    const root = document.getElementById('classCards');
    if (!root || !window.Progression) return;
    root.innerHTML = order.filter(id => CLASSES[id]).map(id => {
      const cls = CLASSES[id], boosted = Progression.applyClass(id, cls);
      const locked = cls.dlc && !ownsDlc(id);
      const portrait = portraits[id]?.preview || data.roster;
      return `<button class="card classCard ${id} ${locked ? 'locked' : ''}" data-c="${id}">
        <div class="portrait cultivationPortrait" style="background-image:url('${portrait}');background-position:center;background-size:contain"></div>
        <h2>${locked ? '秘传 · ' : ''}${cls.cn}</h2>
        <p><b>道基</b> 气血 ${boosted.hp} / 身法 ${Math.round(boosted.spd)} / 道威 ${boosted.dmg.toFixed(2)}</p>
        <p><b>本命功法</b> ${INFO[cls.skill][0]}${boosted.startXp ? ` / 初始灵气 +${boosted.startXp}` : ''}</p>
        <p>${cls.desc}</p>${locked ? '<p class="rewardHint">未得传承：消耗 200 道种永久解锁</p>' : ''}</button>`;
    }).join('');
  }
  function translateDom(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (node.parentElement?.closest('script,style')) return;
      const next = rewrite(node.data);
      if (next !== node.data) node.data = next;
    });
    root.querySelectorAll?.('[placeholder],[title],[aria-label]').forEach(el => {
      ['placeholder', 'title', 'aria-label'].forEach(attr => {
        if (el.hasAttribute(attr)) el.setAttribute(attr, rewrite(el.getAttribute(attr)));
      });
    });
  }
  function install() {
    applyData();
    window.renderClassCards = renderClasses;
    document.title = '太虚仙途';
    const originalNotice = window.showNotice;
    if (originalNotice && !originalNotice.__cultivation) {
      const wrapped = message => originalNotice(rewrite(message));
      wrapped.__cultivation = true;
      window.showNotice = wrapped;
    }
    translateDom();
    let busy = false;
    new MutationObserver(records => {
      if (busy) return;
      busy = true;
      records.forEach(record => {
        if (record.type === 'characterData') translateDom(record.target.parentElement);
        record.addedNodes.forEach(node => node.nodeType === 1 ? translateDom(node) : null);
      });
      busy = false;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  install();
  window.CultivationTheme = { rewrite, applyData, renderClasses };
})();
