// Everything this game is built from. Shown on the Credits screen and kept in
// sync with CREDITS.md.

export const CREDITS = [
  {
    group: 'Characters & enemies',
    items: [
      { what: 'The hero ("Soldier"), idle / walk / run', who: 'Mixamo (mixamo.com), via the three.js examples. Sword, roll and other moves are procedural, made for this game', license: 'Mixamo terms: free to use in projects', url: 'https://www.mixamo.com' },
      { what: 'Skeleton Minion & Warrior, their blades and axes', who: 'KayKit Skeletons by Kay Lousberg', license: 'CC0 1.0', url: 'https://kaylousberg.itch.io/kaykit-skeletons' },
      { what: 'Fox', who: 'Model: PixelMannen (CC0). Rigging & animation: @tomkranis (CC BY 4.0). glTF: @AsoboStudio & @scurest (CC BY 4.0). Khronos glTF Sample Assets', license: 'CC0 / CC BY 4.0', url: 'https://github.com/KhronosGroup/glTF-Sample-Assets' },
      { what: 'Stork', who: 'mirada, from the ro.me project "3 Dreams of Black", via the three.js examples', license: 'non-commercial use', url: 'https://threejs.org/examples/' },
    ],
  },
  {
    group: 'Engine & tools',
    items: [
      { what: '3D engine, glTF loader, skeleton utilities', who: 'Three.js r169, by the three.js authors', license: 'MIT', url: 'https://threejs.org' },
      { what: 'Desktop app runtime', who: 'Electron 33 (with Chromium)', license: 'MIT', url: 'https://www.electronjs.org' },
      { what: 'Monospace glyphs', who: 'DejaVu Sans Mono / your system font', license: 'Bitstream Vera / public domain', url: 'https://dejavu-fonts.github.io' },
      { what: 'Audio rendering', who: 'NumPy, SciPy and FFmpeg (libvorbis), used to build the sound files', license: 'BSD / LGPL', url: 'https://ffmpeg.org' },
    ],
  },
  {
    group: 'Music & sound',
    items: [
      { what: 'Title theme "Ashen Vigil" and world track "The Long Dark Road"', who: 'Original, composed in code for ASCII Realm (build/audio/compose.py)', license: 'CC0', url: '' },
      { what: 'Rain, wind, crickets, birds, fire, thunder, footsteps, swords, bones, UI', who: 'Original, synthesised for ASCII Realm', license: 'CC0', url: '' },
    ],
  },
  {
    group: 'Inspiration',
    items: [
      { what: 'The look: a 3D world drawn as hand-placed glyphs', who: 'The ASCII-art game devlogs that started this project', license: 'inspiration only', url: '' },
      { what: 'Colour schemes', who: 'The 1-bit monitor palettes of Return of the Obra Dinn (Lucas Pope), via lospec.com', license: 'inspiration only', url: 'https://lospec.com/palette-list' },
      { what: 'Combat, bonfires, runes, YOU DIED', who: 'Dark Souls and Elden Ring (FromSoftware)', license: 'inspiration only', url: '' },
      { what: 'Feature ideas', who: 'The community comments: loot, skill trees, Berserker, celestial raid boss', license: 'thank you', url: '' },
    ],
  },
];
