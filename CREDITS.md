# Credits

ASCII Realm is built from the work of these people and projects. Thank you.
The same list is in the game under **Title → Credits**.

## Characters & enemies

| Asset | Used for | Author / source | License |
| --- | --- | --- | --- |
| `hero.glb` ("Soldier") | The hero, with Idle / Walk / Run animations. His sword swings, roll, flask, sitting and death are procedural poses made for this game | Mixamo (mixamo.com), via the three.js examples | Mixamo terms: free to use in projects |
| KayKit Adventurers (`assets/kaykit/adventurers/`) | Not used in the current build (kept for later) | Kay Lousberg, https://kaylousberg.itch.io/kaykit-adventurers (github.com/KayKit-Game-Assets) | CC0 1.0 (`assets/kaykit/adventurers/LICENSE.txt`) |
| KayKit Skeletons (`assets/kaykit/skeletons/`) | Skeleton Minion and Skeleton Warrior, their blades and axes, rise / attack / death animations | Kay Lousberg, https://kaylousberg.itch.io/kaykit-skeletons | CC0 1.0 (`assets/kaykit/skeletons/LICENSE.txt`) |
| `fox.glb` ("Fox") | Wandering foxes | Model: PixelMannen (CC0). Rigging & animation: @tomkranis (CC BY 4.0). glTF conversion: @AsoboStudio & @scurest (CC BY 4.0). From the Khronos glTF Sample Assets, https://github.com/KhronosGroup/glTF-Sample-Assets | CC0 / CC BY 4.0 |
| `stork.glb` ("Stork") | Birds circling the lake | mirada, from the ro.me project ("3 Dreams of Black"), via the three.js examples | Shared for non-commercial use |

## Engine & tools

| What | Author / source | License |
| --- | --- | --- |
| Three.js r169: 3D engine, glTF loader, skeleton utilities | three.js authors, https://threejs.org | MIT (`lib/THREE_LICENSE.txt`) |
| Electron 33 (with Chromium): the desktop app runtime, downloaded by the installer | OpenJS Foundation, https://www.electronjs.org | MIT |
| DejaVu Sans Mono (or your system's monospace font) for the glyphs | DejaVu fonts, https://dejavu-fonts.github.io | Bitstream Vera license / public domain |
| NumPy, SciPy, FFmpeg + libvorbis: used to render the sound files | numpy.org, scipy.org, ffmpeg.org | BSD / LGPL |

## Music & sound

All music and sound effects are original, made for ASCII Realm and released
as CC0. They are composed and synthesised in code by `build/audio/compose.py`
(no samples from anywhere else):

- Title theme ("Ashen Vigil", D minor) and the world track ("The Long Dark Road")
- Ambience: rain, wind, night crickets, day birds, fire crackle
- Effects: footsteps on grass and stone, sword swings, bone hits, armour clang,
  dodge roll, skeleton rattle / rising / death, flask, rest, YOU DIED, runes,
  thunder near and far, torch, burning and tearing cobwebs, menu sounds

## Inspiration (no assets used)

- The ASCII-art game devlogs that started this project: a 3D world drawn as glyphs.
- Colour schemes: the 1-bit monitor palettes of *Return of the Obra Dinn*
  (Lucas Pope), via https://lospec.com/palette-list. The values here are
  approximations.
- Combat, shrines, runes and "YOU DIED": *Dark Souls* and *Elden Ring* (FromSoftware).
- Feature ideas from community comments: loot rarity, skill trees, Berserker,
  item sets, transmog, celestial raid boss.

Everything else (terrain, grass, trees, ruins, water, fire, weather, the ASCII
renderer, cobwebs, UI) is generated in code.

If you ever sell this game, replace the stork with a model whose license allows
commercial use.
