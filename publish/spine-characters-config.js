(() => {
  'use strict';

  const root = './assets/spine';
  const make = (dir, file, height, skill = 'skill', facing = 1) => ({
    atlas: `${root}/${dir}/${file}.atlas`,
    skeleton: `${root}/${dir}/${file}.skel`,
    texture: `${root}/${dir}/${file}.png`,
    preview: `${root}/${dir}/preview.png`,
    height,
    groundOffset: 32,
    facing,
    animations: {
      idle: 'stand',
      run: 'run',
      attack: 'attack',
      skill,
      hurt: 'hurt',
    },
  });

  window.CultivationSpineConfig = {
    classes: {
      paladin: make('paladin', 'cha_6075', 84),
      mage: make('mage', 'cha_2134', 84),
      ranger: make('ranger', 'cha_2073', 81),
      gunslinger: make('gunslinger', 'cha_4245', 92, 'skill_ex'),
      lewdSaintess: make('lewd-saintess', 'cha_60501', 86),
      scytheMaiden: make('scythe-maiden', 'cha_5106', 90, 'skill_ex'),
    },
    speeds: {
      idle: 1,
      run: 1.15,
      attack: 3.3,
      skill: 2.7,
      hurt: 1.45,
    },
  };
})();
