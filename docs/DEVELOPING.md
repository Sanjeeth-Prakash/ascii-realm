# ASCII Realm: developer notes

A 3D action RPG rendered entirely in ASCII characters. Two layers make each
frame:

- **The glyph grid.** Stone, trees, water, fire and characters are real 3D
  objects. A shader turns every small block of the screen into one coloured
  character, picked by brightness and material (leaves `o 0 8 @`, stone
  `: = # %`, fire `* x #`...).
- **Glyph art.** Grass is drawn as thousands of free-floating character
  strokes (`| l ! i ; j f`) at full resolution, each bending with the wind and
  parting around you. Cobwebs are thin line art, and fireflies and embers are
  glowing motes. These are hidden correctly behind characters and walls.

A final pass adds torch glows, rain and the colour scheme (full colour or
retro 1-bit and phosphor monitor looks).

**Current version (v0.7):** souls-style combat and sound. You play the Knight
(light combo, heavy attack, dodge roll with i-frames, lock-on, stamina,
Crimson Flasks). Skeletons lie in the grass, rise when you come near and fight
with telegraphed swings. Kill them for runes and Bone Shards. Die and you drop
your runes where you fell ("YOU DIED"), waking at the shrine; go back and
retrieve them. Rest at the shrine altar to heal and refill flasks, which also
raises the dead again. Original music (title theme + world track), rain,
thunder, wind, crickets, birds, fires, footsteps and combat sounds, each with
its own volume. Also: title screen, options, saves, and cobwebs
that burn away when you carry your torch through them (or tear if you don't). Wind-swept grass that
parts around you, swaying broadleaf and pine trees, moonlight shadows with
dappled gaps under the leaves, drifting cloud shadows, mist pooling over the
lake, fireflies, foxes that wander and bolt when you get close, storks circling
the lake, a shrine with braziers, a ruined keep, rain with lightning, and four
times of day.

## Play it

**Windows:** unzip `ASCII-Realm-Installer.zip` and run `Install ASCII Realm.bat`.
The first install downloads the game runtime once (about 110 MB, from the
official Electron releases, checksum-verified) and adds Desktop and Start Menu
shortcuts. Later versions only replace the game files. Saves and settings live
in `%APPDATA%\ASCII Realm`, so they survive updates.

**Updates:** you never need to uninstall or reinstall. Updates come as a small
`ASCII-Realm-Update-x.y.z.zip`. Leave it in Downloads (or on the Desktop) and
start the game; the title screen shows **Install update**, which patches the
game and restarts it. Dragging the zip onto the game window works too.
(Making one: `node build/release.mjs update <installed version>`.)

**Automatic updates over the internet (free, via GitHub Releases):** put
`update-feed.json` (`{ "github": "owner/repo" }`) next to the game files and
publish each version as a GitHub release of that (public) repository:

```
node build/release.mjs release <previous version>   # makes dist/release-<v>/
gh release create v<v> dist/release-<v>/* --repo owner/repo --title "v<v>" --notes "what's new"
```

Each release carries a small `ASCII-Realm-Update-<v>-from-<prev>.zip` and a
full `ASCII-Realm-Game-<v>.zip`. Every installed game checks the releases on
the title screen, shows **Update to v…**, downloads only the small updates it
needs (or the full zip if it skipped too many) and restarts.

**From source (any OS, needs Node.js 18+):** `start.bat` / `start.command` /
`./start.sh` opens it in your browser at `http://127.0.0.1:5173`.

## Menus

The game opens on a title screen with a live in-engine cinematic.
**Continue** loads your save, **New Game** asks for your character's name,
**Options** has Graphics (display mode: borderless fullscreen or windowed with
window size, colour scheme, glyph size, detail, grass, shadows, FPS counter),
Audio (master, music, effects, ambience, mute), World (time of day, weather)
and Controls (every key can be rebound, including mouse buttons).
**Credits** lists every asset and where it came from. **Esc** in-game opens the pause menu.
The game autosaves every 30 seconds and whenever you pause or quit.

## Default controls

| Action | Key |
| --- | --- |
| Move | W A S D (or arrows) |
| Sprint | Left Shift |
| Look around | Mouse (cursor is captured while playing) |
| Zoom | Mouse wheel |
| Torch | F |
| Inventory | I or Tab |
| Pause menu / free the cursor | Esc |
| Rotate camera without mouse | Z / X |
| Light attack: 4-hit chain (sprint + click = running slash, click right after a roll = rolling slash, after a backstep = counter thrust) | Left mouse |
| Heavy attack: 2-hit chain, hold to charge (up to +50% damage, more stagger) | Right mouse |
| Dodge roll | Space |
| Lock on / off (flick the mouse to switch target) | Q or middle mouse |
| Drink Crimson Flask | R |
| Interact: rest at shrine, retrieve runes | E |
| Spells, steed | C, V (coming later) |

Mouse capture can be turned off in Options → Controls.

## Levelling (like Elden Ring)

Rest at the shrine (E) to open its menu. **Level Up** spends runes on Vigor
(HP), Mind (FP), Endurance (stamina), Strength and Dexterity (attack power),
with Elden Ring's stat curves and rune costs (673 runes for level 2). **Flasks**
uses Golden Seeds (+1 charge, up to 10) and Sacred Tears (+5% healing per sip).
Glowing items around the world: Golden Seeds, Sacred Tears, Amber Moss (heals
30% over 12 s; click it in the bag) and Golden Runes (+400 runes).

## HUD

HP, FP and stamina bars sit top-left beside your level, like Elden Ring; strong foes (Skeleton Warriors) get a big bar at the bottom centre. Bottom-left is the
equipment cross (spell on top, left and right hand, quick item below) with the
key for each. Bottom-right shows your runes and the menu bar (Bag, Skills,
Map, Quests, Menu).

## Building the Windows version

`build/package-win.sh electron-v33.2.1-win32-x64.zip out/` assembles the game
folder from the official Electron Windows runtime (from the Electron GitHub
releases) plus this project.

## How it's built

```
desktop.mjs               desktop app window (Electron), forces the dedicated GPU
server.js                 tiny local web server (no dependencies)
index.html                page + HUD
lib/three.module.min.js   Three.js r169 (MIT, bundled so nothing to install)
src/main.js               game loop, states (title / playing / paused), camera
src/game/cinematic.js     title-screen camera shots
src/ui/menu.js, menu.css  title screen, pause menu, options, dialogs
src/core/settings.js      settings + key bindings (saved locally)
src/core/save.js          save slot
src/render/
  AsciiRenderer.js        scene → glyphs; torch halos and rain drawn on top
  lighting.js             shared lights, wind, fog, mist, clouds; model materials
  shadows.js              moon/sun shadow map that follows the player
src/world/
  terrainMath.js          terrain height, path, lake (same math in JS and GLSL)
  terrain.js  grass.js  trees.js  ruins.js  water.js
  torches.js              flames, embers, point lights, halos
  fireflies.js            night fireflies
  cobwebs.js              burnable / tearable cobwebs that regrow
  weather.js              time of day, wind, rain, lightning
src/entities/player.js    the Knight: locomotion, attacks, dodge, flask, rest, death
src/entities/enemies.js   skeletons: dormant, rising, chase, telegraphed attacks, stagger
src/game/combat.js        hit detection, lock-on, hitstop, shake, enemy health bars
src/game/items.js         items, rarity, inventory helpers
src/game/credits.js       the in-game credits list
src/core/audio.js         music, ambience loops, positional effects, volume buses
build/audio/compose.py    composes / synthesises every sound file in assets/audio
src/entities/wildlife.js  foxes and storks
src/core/assets.js  src/core/input.js  src/ui/hud.js
assets/kaykit/            KayKit Adventurers + Skeletons (CC0)
assets/models/            fox.glb, stork.glb
assets/audio/             music/, amb/, sfx/ (.ogg)
```

**Slow computer?** Options → Graphics: raise glyph size, set Detail to Low,
grass to Low, and turn off moon shadows.

Models live in `assets/kaykit/` and `assets/models/`; see `CREDITS.md` for where each came from.

## Roadmap

1. ~~World, glyph-art grass, colour schemes~~ ✓
2. ~~Combat: roll, light/heavy attacks, lock-on, stamina, flasks~~ ✓ (dash and slide still to come)
3. ~~Skeleton enemies, runes, death and shrines~~ ✓ (elements and weaknesses next)
4. Loot: rarity tiers, random stats, monster materials
5. Skill trees (classless; Berserker first)
6. Modular hero with visible gear and transmog
7. Horse, then the dragon boss
8. Crafting, smithing, item sets, dungeons
9. Multiplayer: co-op, trading, cosmetics, PvP arenas
10. Celestial raid boss
