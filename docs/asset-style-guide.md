# Asset Style Guide

## Purpose

This document defines the visual direction for in-game characters, enemies, and lobby avatars.

The project should use the Dead Town reference only as a quality and readability reference. Do not copy its exact characters, sprites, or world setting. The final assets must stay aligned with the office survival theme.

## Required Viewpoint

All playable characters and enemies must be designed in a bird's-eye / top-down view.

Required:
- Head, shoulders, body mass, limbs, weapons, and shadows must read as viewed from above.
- Lobby avatars and in-game sprites must use the same top-down asset language.
- Face-front portrait styling is not allowed for gameplay characters.
- Large eyes, front-facing mouths, portrait-like noses, and mascot-style frontal bodies should be avoided.
- Character identity should come from hair/cap silhouette, color accent, equipment shape, and body outline.
- Enemy identity should come from silhouette, mass, posture, movement implication, and color grouping.

## Player Avatar Rules

Player avatars are cosmetic skins, not roles or classes.

Allowed differences:
- Hair or headwear shape
- Accent color
- Small equipment silhouette
- Body outline and stance
- Mood and taste

Not allowed:
- Role labels such as medic, guard, engineer, tank, dealer, healer
- Visuals that imply different combat power
- Front-facing portrait designs
- Character designs that look like selection-card mascots but fail at in-game scale

## Enemy Rules

Enemies may have stronger functional silhouettes than players.

Normal:
- Balanced mass
- Clear head/body read
- Baseline threat

Runner:
- Narrow or angled silhouette
- Forward-leaning posture
- Strong speed read

Tanker:
- Wider body mass
- Heavier outline
- Slower but more durable read

## Atlas Production Rules

Runtime atlases should be generated or edited as image assets, not rebuilt from procedural drawing scripts.

Required atlases:
- `office-player-avatars.png`: 1024x1024, 2x2 lobby avatar atlas.
- `office-survival-sprites.png`: 1024x1024, 4 columns x 4 rows gameplay walk atlas.
- `office-props-atlas.png`: 1024x1024, 4x4 office resource, facility, and decor atlas.

Gameplay sprite atlas rows:
- Row 0: player survivor walk loop.
- Row 1: normal zombie walk loop.
- Row 2: runner zombie walk loop.
- Row 3: tanker zombie walk loop.

Gameplay sprite atlas columns:
- Four loopable walk frames per row.
- Each frame must keep the same shadow-center pivot.
- Scale and padding must stay consistent inside every 256x256 cell.

Animation requirements:
- Movement should read from silhouette rhythm, body lean, and shadow shift rather than detailed limb articulation.
- Player skins must remain cosmetic and should not imply roles, classes, or power differences.
- Zombies may use stronger silhouettes, but must stay simple enough for low-frame animation.

After changing runtime atlases, run:

```bash
npm run typecheck
npm run build
```
