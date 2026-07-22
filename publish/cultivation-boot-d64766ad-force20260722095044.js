(() => {
  'use strict';

  const text = {
    '#loading h1': '太虚仙途',
    '#loadingText': '正在引灵入体，稳固周天...',
    '#bossWarn': '魔尊劫将至',
    '#start .title': '太虚仙途',
    '#start .sub': '太虚裂界将开，择一道途，逆劫登仙。',
    '#newBtn': '踏上仙途',
    '#loadBtn': '读取轮回录',
    '#boardBtn': '查看天榜',
    '#evoGuideBtn': '功法蜕变图鉴',
    '#equipMenuBtn': '纪元灵器',
    '#saveTransferBtn': '轮回录导入/导出',
    '#classSelect .title': '选择道途',
    '#classSelect .classTitleBoostR15': '功法参悟',
    '#classSelect .sub': '每条道途拥有独立本命功法、法宝与成长传承。',
    '#progressionModal .title': '功法参悟',
    '#mapSelect .title': '选择洞天',
    '#mapSub': '左右浏览试炼洞天，确认后入世历练。',
    '#mapStart': '进入洞天',
    '#levelup .title': '悟道抉择',
    '#levelup .sub': '从天地灵机中参悟一门造化。',
    '#relicTree .title': '本命法宝',
    '#skillPanel .title': '本局功法',
    '#inventory .title': '乾坤宝匣',
    '#equipmentPanel .title': '纪元灵器',
    '#altarPanel .title': '淬炼祭坛',
    '#leaderboard .title': '问道天榜',
    '#evoGuide .title': '功法蜕变图鉴',
    '#artifactChoice .title': '法宝机缘',
    '#dlcModal .title': '秘传 · 红尘灵修',
    '#restart': '返回仙门',
    '#endlessBtn': '继续渡劫',
  };
  Object.entries(text).forEach(([selector, value]) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  });

  const hud = [
    ['#hudJob', '道途：'], ['#hudLv', '修为：'], ['#hudGold', '灵石：'],
  ];
  hud.forEach(([selector, label]) => {
    const node = document.querySelector(selector);
    const value = node?.querySelector('b');
    if (!node || !value) return;
    node.firstChild.textContent = label;
  });
  const bossLabel = document.querySelector('#hudBoss label span:first-child');
  if (bossLabel) bossLabel.textContent = '下次魔尊劫';
  document.title = '太虚仙途';
})();
