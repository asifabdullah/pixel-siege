# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Game

```bash
open shooter.html          # macOS — opens in default browser
```

No build step, no dependencies, no package manager. Edit the JS, refresh the browser.

## Git Workflow

The repo is at `https://github.com/asifabdullah/pixel-siege`. **After every meaningful unit of work — a new feature, a bug fix, a refactor — commit and push immediately.** Never leave work uncommitted. This ensures there is always a clean, named revert point on GitHub.

Commit rules:
- Stage only the files changed for that task (`git add <file>` not `git add .`)
- Write a concise, descriptive commit message (imperative mood: "Add X", "Fix Y", "Refactor Z")
- Always push after committing: `git push`
- Include the co-author trailer on every commit:
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## Architecture

Two files, zero dependencies — everything rendered via the HTML5 Canvas 2D API.

- **`shooter.html`** — canvas shell only. Links `shooter.js`. No logic here.
- **`shooter.js`** — entire game: state machine, game loop, input, audio, rendering, persistence.

### State machine

```
MENU → PLAYING → LEVEL_COMPLETE → PLAYING (next level)
                               → GAME_OVER → MENU
```

`gameState` is the single source of truth. `update()` and `render()` both branch on it.

### Game loop

`requestAnimationFrame` drives everything. Delta-time (`dt` in ms, capped at 50ms) is passed to every `update*` function so movement is framerate-independent. The loop never stops — state changes control what updates/renders.

### Entity model

All entities are plain objects created by factory functions:
- `makePlayer()` — single instance, stored in `player`
- `makeBullet(x, y, vx, vy)` — pushed into `bullets[]`
- `makeEnemy(type)` — pushed into `enemies[]`; type is `'grunt'`, `'rusher'`, or `'tank'`
- `makeParticle(...)` — pushed into `particles[]`

Collision is circle-based via `circleHit(a, b)` (checks `radius` on each entity).

### Enemy / level system

`ENEMY_TYPES` defines base stats per type. `buildWave(lvl)` returns a shuffled array of type strings (`spawnQueue`). `spawnEnemies(dt)` pops one off the queue at a timed interval. Level is complete when `spawnQueue` is empty and all enemies have `dying === true` or `hp <= 0`.

Enemy speed scales with level: `base.speed + (level - 1) * 8`.

Score per kill: `enemy.score * level`. Level-clear bonus: `100 * level`.

### Rendering

All drawing is done in `render()` → `renderMenu/Game/LevelComplete/GameOver()`. Every draw function uses `ctx.save()` / `ctx.restore()` around transforms. Screen shake applies a random translate on the root `ctx.save()` block each frame.

`drawMenuButton()` doubles as hover detection — it reads `mouse.x/y` at draw time and colors itself accordingly. Click hit-testing in `handleClick()` uses hardcoded pixel regions that match the button positions passed to `drawMenuButton()`.

### Audio

`beep(freq, dur, type, vol)` creates a one-shot Web Audio oscillator. `audioCtx` is lazily initialized on first user interaction to satisfy browser autoplay policy.

### Persistence

`localStorage` key `pixelSiegeHS` stores the high score as a plain integer string.
