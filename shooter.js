// ============================================================
//  PIXEL SIEGE — Top-Down Browser Shooter
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = 800, H = 600;

// ── State machine ──────────────────────────────────────────
const STATE = { MENU: 0, PLAYING: 1, LEVEL_COMPLETE: 2, GAME_OVER: 3 };
let gameState = STATE.MENU;

// ── Input ──────────────────────────────────────────────────
const keys = {};
const mouse = { x: W / 2, y: H / 2, down: false };

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
});
canvas.addEventListener('mousedown', e => { mouse.down = true; handleClick(e); });
canvas.addEventListener('mouseup',   () => { mouse.down = false; });
window.addEventListener('keydown',   e => { keys[e.code] = true; });
window.addEventListener('keyup',     e => { keys[e.code] = false; });

// ── Audio (Web Audio API bleeps) ───────────────────────────
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function beep(freq, dur, type = 'square', vol = 0.15) {
  try {
    ensureAudio();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.start(); osc.stop(audioCtx.currentTime + dur);
  } catch(e) {}
}

// ── Persistence ────────────────────────────────────────────
let highScore = parseInt(localStorage.getItem('pixelSiegeHS') || '0', 10);
function saveHS(s) {
  if (s > highScore) { highScore = s; localStorage.setItem('pixelSiegeHS', s); }
}

// ── Game data ──────────────────────────────────────────────
let player, bullets, enemies, particles, score, level, levelTimer, spawnQueue;
let muzzleFlash = 0;       // frames remaining
let screenShake = 0;       // frames remaining
let shootCooldown = 0;     // ms
let levelCompleteTimer = 0;
let menuEnemies = [];
let showHowTo = false;
let lastTime = 0;

// ── Entity constructors ────────────────────────────────────
function makePlayer() {
  return {
    x: W / 2, y: H / 2,
    angle: 0,
    speed: 200,
    hp: 3, maxHp: 3,
    invincible: 0,   // ms of invincibility after hit
    walkCycle: 0,
    radius: 14,
  };
}

function makeBullet(x, y, vx, vy) {
  return { x, y, vx, vy, radius: 4, life: 1200 }; // life ms
}

const ENEMY_TYPES = {
  grunt:  { color: '#e74c3c', radius: 12, speed: 80,  hp: 1, score: 10, shape: 'square' },
  rusher: { color: '#e67e22', radius: 9,  speed: 150, hp: 1, score: 15, shape: 'diamond' },
  tank:   { color: '#555',    radius: 18, speed: 45,  hp: 3, score: 30, shape: 'heavy' },
};

function makeEnemy(type) {
  const def = ENEMY_TYPES[type];
  // spawn on a random canvas edge
  let x, y;
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) { x = Math.random() * W; y = -def.radius * 2; }
  else if (edge === 1) { x = W + def.radius * 2; y = Math.random() * H; }
  else if (edge === 2) { x = Math.random() * W; y = H + def.radius * 2; }
  else { x = -def.radius * 2; y = Math.random() * H; }
  return {
    x, y, type,
    color: def.color,
    radius: def.radius,
    speed: def.speed + (level - 1) * 8,
    hp: def.hp,
    maxHp: def.hp,
    score: def.score,
    dying: false,
    deathTimer: 0,
    deathRadius: def.radius,
    angle: 0,
  };
}

function makeParticle(x, y, vx, vy, color, life, size) {
  return { x, y, vx, vy, color, life, maxLife: life, size };
}

// ── Level wave definitions ─────────────────────────────────
function buildWave(lvl) {
  const q = [];
  const extras = lvl - 1;
  const grunts  = 8  + extras * 4;
  const rushers = lvl >= 2 ? 4 + extras * 2 : 0;
  const tanks   = lvl >= 3 ? 2 + extras     : 0;
  for (let i = 0; i < grunts;  i++) q.push('grunt');
  for (let i = 0; i < rushers; i++) q.push('rusher');
  for (let i = 0; i < tanks;   i++) q.push('tank');
  // shuffle
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [q[i], q[j]] = [q[j], q[i]];
  }
  return q;
}

// ── Initialise / reset ─────────────────────────────────────
function startGame() {
  player    = makePlayer();
  bullets   = [];
  enemies   = [];
  particles = [];
  score     = 0;
  level     = 1;
  spawnQueue = buildWave(level);
  levelTimer = 0;
  shootCooldown = 0;
  gameState = STATE.PLAYING;
}

function nextLevel() {
  level++;
  enemies   = [];
  bullets   = [];
  particles = [];
  spawnQueue = buildWave(level);
  levelTimer = 0;
  gameState = STATE.PLAYING;
}

function spawnEnemies(dt) {
  if (spawnQueue.length === 0) return;
  levelTimer += dt;
  const interval = Math.max(300, 1200 - level * 80); // ms between spawns
  if (levelTimer >= interval) {
    levelTimer = 0;
    enemies.push(makeEnemy(spawnQueue.shift()));
  }
}

// ── Menu animated enemies ──────────────────────────────────
function initMenuEnemies() {
  menuEnemies = [];
  for (let i = 0; i < 12; i++) {
    menuEnemies.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 40,
      vy: (Math.random() - 0.5) * 40,
      type: ['grunt','rusher','tank'][Math.floor(Math.random()*3)],
      angle: Math.random() * Math.PI * 2,
    });
  }
}

// ── Click handler (menu + game) ────────────────────────────
function handleClick(e) {
  if (gameState === STATE.MENU) {
    // Play button area: centred ~y=310
    if (mouse.x >= 300 && mouse.x <= 500 && mouse.y >= 295 && mouse.y <= 335) {
      beep(440, 0.1); startGame(); return;
    }
    // How to play toggle: y~355
    if (mouse.x >= 300 && mouse.x <= 500 && mouse.y >= 350 && mouse.y <= 390) {
      showHowTo = !showHowTo; return;
    }
    return;
  }
  if (gameState === STATE.GAME_OVER) {
    // Restart
    if (mouse.x >= 300 && mouse.x <= 500 && mouse.y >= 340 && mouse.y <= 380) {
      beep(440, 0.1); startGame(); return;
    }
    if (mouse.x >= 300 && mouse.x <= 500 && mouse.y >= 395 && mouse.y <= 435) {
      gameState = STATE.MENU; return;
    }
    return;
  }
  if (gameState === STATE.PLAYING) {
    tryShoot();
  }
}

// ── Shooting ───────────────────────────────────────────────
function tryShoot() {
  if (shootCooldown > 0) return;
  const dx = mouse.x - player.x;
  const dy = mouse.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  const speed = 550;
  const bx = player.x + (dx / len) * 20;
  const by = player.y + (dy / len) * 20;
  bullets.push(makeBullet(bx, by, (dx / len) * speed, (dy / len) * speed));
  muzzleFlash = 3;
  shootCooldown = 160; // ms
  beep(880, 0.04, 'sawtooth', 0.08);
}

// ── Collisions ─────────────────────────────────────────────
function circleHit(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius;
}

// ── Particle burst ─────────────────────────────────────────
function burst(x, y, color, count, speedMult = 1) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = (30 + Math.random() * 80) * speedMult;
    particles.push(makeParticle(x, y, Math.cos(ang)*spd, Math.sin(ang)*spd,
      color, 400 + Math.random() * 300, 2 + Math.random() * 4));
  }
}

// ── Update ─────────────────────────────────────────────────
function update(dt) {
  if (gameState === STATE.MENU)          { updateMenu(dt); return; }
  if (gameState === STATE.LEVEL_COMPLETE){ updateLevelComplete(dt); return; }
  if (gameState === STATE.GAME_OVER)     { updateParticles(dt); return; }

  // Timers
  if (shootCooldown  > 0) shootCooldown  -= dt;
  if (muzzleFlash    > 0) muzzleFlash    -= 16;
  if (screenShake    > 0) screenShake    -= dt;
  if (player.invincible > 0) player.invincible -= dt;

  // Player movement
  let dx = 0, dy = 0;
  if (keys['ArrowLeft']  || keys['KeyA']) dx -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) dx += 1;
  if (keys['ArrowUp']    || keys['KeyW']) dy -= 1;
  if (keys['ArrowDown']  || keys['KeyS']) dy += 1;
  const dlen = Math.hypot(dx, dy) || 1;
  if (dx || dy) {
    player.x += (dx / dlen) * player.speed * (dt / 1000);
    player.y += (dy / dlen) * player.speed * (dt / 1000);
    player.walkCycle += dt * 0.01;
  }
  // Clamp player inside canvas
  player.x = Math.max(player.radius, Math.min(W - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(H - player.radius, player.y));

  // Auto-fire when mouse held
  if (mouse.down) tryShoot();

  // Player faces mouse
  player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * (dt / 1000);
    b.y += b.vy * (dt / 1000);
    b.life -= dt;
    if (b.life <= 0 || b.x < -10 || b.x > W+10 || b.y < -10 || b.y > H+10) {
      bullets.splice(i, 1);
    }
  }

  // Enemies
  spawnEnemies(dt);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dying) {
      e.deathTimer += dt;
      e.deathRadius += dt * 0.08;
      if (e.deathTimer > 350) enemies.splice(i, 1);
      continue;
    }

    // Move toward player
    const ex = player.x - e.x, ey = player.y - e.y;
    const elen = Math.hypot(ex, ey) || 1;
    e.x += (ex / elen) * e.speed * (dt / 1000);
    e.y += (ey / elen) * e.speed * (dt / 1000);
    e.angle = Math.atan2(ey, ex);

    // Bullet hits enemy
    for (let j = bullets.length - 1; j >= 0; j--) {
      if (circleHit(bullets[j], e)) {
        bullets.splice(j, 1);
        e.hp--;
        burst(e.x, e.y, e.color, 6);
        beep(200, 0.06, 'square', 0.1);
        if (e.hp <= 0) {
          e.dying = true;
          score += e.score * level;
          burst(e.x, e.y, e.color, 18, 1.5);
          beep(120, 0.12, 'sawtooth', 0.15);
        }
        break;
      }
    }

    // Enemy hits player
    if (!e.dying && player.invincible <= 0 && circleHit(e, player)) {
      player.hp--;
      player.invincible = 1400;
      screenShake = 300;
      burst(player.x, player.y, '#fff', 12, 1.2);
      beep(80, 0.2, 'sawtooth', 0.3);
      if (player.hp <= 0) {
        saveHS(score);
        burst(player.x, player.y, '#4ecdc4', 30, 2);
        gameState = STATE.GAME_OVER;
      }
    }
  }

  // Level complete check
  if (spawnQueue.length === 0 && enemies.every(e => e.dying || e.hp <= 0)) {
    // all spawned and dead
    const alive = enemies.filter(e => !e.dying);
    if (alive.length === 0 && spawnQueue.length === 0) {
      score += 100 * level; // level clear bonus
      levelCompleteTimer = 2000;
      gameState = STATE.LEVEL_COMPLETE;
      beep(660, 0.08); beep(880, 0.12);
    }
  }

  updateParticles(dt);
}

function updateMenu(dt) {
  for (const e of menuEnemies) {
    e.x += e.vx * (dt / 1000);
    e.y += e.vy * (dt / 1000);
    if (e.x < -30 || e.x > W+30) e.vx *= -1;
    if (e.y < -30 || e.y > H+30) e.vy *= -1;
    e.angle += 0.5 * (dt / 1000);
  }
}

function updateLevelComplete(dt) {
  levelCompleteTimer -= dt;
  updateParticles(dt);
  if (levelCompleteTimer <= 0) nextLevel();
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * (dt / 1000);
    p.y += p.vy * (dt / 1000);
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ── Draw helpers ───────────────────────────────────────────
function drawGrid() {
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x <= W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function drawScanlines() {
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 2) {
    ctx.fillRect(0, y, W, 1);
  }
  ctx.restore();
}

function drawPlayer() {
  const p = player;
  const bob = Math.sin(p.walkCycle) * 1.5;
  const inv = p.invincible > 0 && Math.floor(Date.now() / 80) % 2 === 0;
  if (inv) return; // flicker

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.rotate(p.angle);

  // Gun barrel
  ctx.fillStyle = '#2a9d8f';
  ctx.fillRect(8, -3, 16, 6);

  // Muzzle flash
  if (muzzleFlash > 0) {
    ctx.save();
    ctx.globalAlpha = muzzleFlash / 3;
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(26, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Body
  ctx.fillStyle = '#4ecdc4';
  ctx.fillRect(-12, -12, 24, 24);

  // Helmet
  ctx.fillStyle = '#2a9d8f';
  ctx.beginPath();
  ctx.arc(0, -6, 10, Math.PI, 0);
  ctx.fill();

  // Eyes (visor)
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(2, -8, 5, 4);

  // Legs
  const legOffset = Math.sin(p.walkCycle) * 4;
  ctx.fillStyle = '#1a6b65';
  ctx.fillRect(-8, 12, 6, 8 + legOffset);
  ctx.fillRect(2,  12, 6, 8 - legOffset);

  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);

  if (e.dying) {
    ctx.globalAlpha = Math.max(0, 1 - e.deathTimer / 350);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, e.deathRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.rotate(e.angle);

  if (e.type === 'grunt') {
    // Square body
    ctx.fillStyle = e.color;
    ctx.fillRect(-e.radius, -e.radius, e.radius*2, e.radius*2);
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.fillRect(-6, -5, 4, 5);
    ctx.fillRect(2,  -5, 4, 5);
    ctx.fillStyle = '#000';
    ctx.fillRect(-5, -4, 2, 3);
    ctx.fillRect(3,  -4, 2, 3);
    // HP bar (if damaged — grunts have 1hp so skip)
  } else if (e.type === 'rusher') {
    // Diamond
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(0, -e.radius);
    ctx.lineTo(e.radius, 0);
    ctx.lineTo(0, e.radius);
    ctx.lineTo(-e.radius, 0);
    ctx.closePath();
    ctx.fill();
    // Glow
    ctx.strokeStyle = '#ffc';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (e.type === 'tank') {
    // Large heavy square
    ctx.fillStyle = e.color;
    ctx.fillRect(-e.radius, -e.radius, e.radius*2, e.radius*2);
    // Plating lines
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(-e.radius+3, -e.radius+3, e.radius*2-6, e.radius*2-6);
    // Barrel
    ctx.fillStyle = '#999';
    ctx.fillRect(e.radius - 4, -4, 12, 8);
    // HP bar
    if (e.hp < e.maxHp) {
      const barW = e.radius * 2;
      ctx.fillStyle = '#333';
      ctx.fillRect(-e.radius, -e.radius - 8, barW, 4);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(-e.radius, -e.radius - 8, barW * (e.hp / e.maxHp), 4);
    }
  }

  ctx.restore();
}

function drawBullet(b) {
  ctx.save();
  ctx.fillStyle = '#ffd700';
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    ctx.restore();
  }
}

function drawHUD() {
  // Hearts
  for (let i = 0; i < player.maxHp; i++) {
    const filled = i < player.hp;
    ctx.save();
    ctx.fillStyle = filled ? '#e74c3c' : '#333';
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 1.5;
    const hx = 18 + i * 28, hy = 18;
    // Simple heart as two rects + diamond
    ctx.beginPath();
    ctx.arc(hx - 4, hy, 5, Math.PI, 0);
    ctx.arc(hx + 4, hy, 5, Math.PI, 0);
    ctx.lineTo(hx, hy + 12);
    ctx.closePath();
    if (filled) ctx.fill(); else ctx.stroke();
    ctx.restore();
  }

  // Score
  ctx.save();
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText('SCORE: ' + score, W / 2, 30);
  ctx.restore();

  // Level
  ctx.save();
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#4ecdc4';
  ctx.textAlign = 'right';
  ctx.fillText('LVL ' + level, W - 14, 30);
  ctx.restore();

  // Remaining enemies
  const remaining = spawnQueue.length + enemies.filter(e => !e.dying).length;
  ctx.save();
  ctx.font = '13px monospace';
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'right';
  ctx.fillText('ENEMIES: ' + remaining, W - 14, 50);
  ctx.restore();
}

function drawMenuButton(x, y, w, h, label, hover) {
  const mx = mouse.x, my = mouse.y;
  const isHover = mx >= x && mx <= x + w && my >= y && my <= y + h;
  ctx.save();
  ctx.fillStyle = isHover ? '#4ecdc4' : '#1a3a3a';
  ctx.strokeStyle = '#4ecdc4';
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = isHover ? '#000' : '#4ecdc4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w/2, y + h/2);
  ctx.restore();
}

// ── Render ─────────────────────────────────────────────────
function render() {
  // Screen shake
  ctx.save();
  if (screenShake > 0) {
    const mag = Math.min(screenShake / 50, 6);
    ctx.translate((Math.random()-0.5)*mag*2, (Math.random()-0.5)*mag*2);
  }

  // Background
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, W, H);
  drawGrid();

  if (gameState === STATE.MENU) {
    renderMenu();
  } else if (gameState === STATE.PLAYING) {
    renderGame();
  } else if (gameState === STATE.LEVEL_COMPLETE) {
    renderGame();
    renderLevelComplete();
  } else if (gameState === STATE.GAME_OVER) {
    renderGameOver();
  }

  drawScanlines();
  ctx.restore();
}

function renderMenu() {
  // Dim animated bg enemies
  ctx.save();
  ctx.globalAlpha = 0.25;
  for (const e of menuEnemies) drawEnemy(e);
  ctx.restore();

  // Title
  ctx.save();
  ctx.font = 'bold 72px monospace';
  ctx.fillStyle = '#4ecdc4';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#4ecdc4';
  ctx.shadowBlur = 20;
  ctx.fillText('PIXEL SIEGE', W/2, 160);
  ctx.shadowBlur = 0;
  ctx.font = '16px monospace';
  ctx.fillStyle = '#aaa';
  ctx.fillText('TOP-DOWN SURVIVOR', W/2, 200);
  ctx.restore();

  // Subtitle line
  ctx.save();
  ctx.strokeStyle = '#4ecdc4';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  ctx.beginPath(); ctx.moveTo(200, 220); ctx.lineTo(600, 220); ctx.stroke();
  ctx.restore();

  // High score
  ctx.save();
  ctx.font = '15px monospace';
  ctx.fillStyle = '#ffd700';
  ctx.textAlign = 'center';
  ctx.fillText('HIGH SCORE: ' + highScore, W/2, 260);
  ctx.restore();

  drawMenuButton(300, 295, 200, 40, '▶  PLAY', true);
  drawMenuButton(300, 350, 200, 40, showHowTo ? '✕  HIDE HELP' : '?  HOW TO PLAY', true);

  if (showHowTo) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(160, 400, 480, 170);
    ctx.strokeStyle = '#4ecdc4';
    ctx.lineWidth = 1;
    ctx.strokeRect(160, 400, 480, 170);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#ccc';
    ctx.textAlign = 'left';
    const lines = [
      'MOVE:   WASD / Arrow Keys',
      'AIM:    Move mouse',
      'SHOOT:  Left Click / Hold',
      'GOAL:   Kill all enemies to advance',
      '',
      'ENEMIES:  Grunt (red)  Rusher (orange)  Tank (grey)',
    ];
    lines.forEach((l, i) => ctx.fillText(l, 180, 426 + i * 22));
    ctx.restore();
  }
}

function renderGame() {
  for (const e of enemies) drawEnemy(e);
  drawParticles();
  for (const b of bullets) drawBullet(b);
  if (player && gameState !== STATE.GAME_OVER) drawPlayer();
  drawHUD();
}

function renderLevelComplete() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, H);

  ctx.font = 'bold 52px monospace';
  ctx.fillStyle = '#ffd700';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 24;
  ctx.fillText('LEVEL COMPLETE!', W/2, H/2 - 40);
  ctx.shadowBlur = 0;

  ctx.font = '24px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText('SCORE: ' + score, W/2, H/2 + 10);
  ctx.font = '16px monospace';
  ctx.fillStyle = '#aaa';
  ctx.fillText('Next level loading...', W/2, H/2 + 50);
  ctx.restore();
}

function renderGameOver() {
  drawParticles();

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, W, H);

  ctx.font = 'bold 64px monospace';
  ctx.fillStyle = '#e74c3c';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#e74c3c';
  ctx.shadowBlur = 28;
  ctx.fillText('GAME OVER', W/2, H/2 - 80);
  ctx.shadowBlur = 0;

  ctx.font = '26px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText('SCORE: ' + score, W/2, H/2 - 20);

  ctx.font = '18px monospace';
  ctx.fillStyle = '#ffd700';
  ctx.fillText('HIGH SCORE: ' + highScore, W/2, H/2 + 20);

  ctx.restore();

  drawMenuButton(300, 340, 200, 40, '▶  PLAY AGAIN', true);
  drawMenuButton(300, 395, 200, 40, '⌂  MAIN MENU', true);
}

// ── Main loop ──────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min(ts - lastTime, 50); // cap at 50ms to avoid spiral of death
  lastTime = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

// ── Boot ───────────────────────────────────────────────────
initMenuEnemies();
requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(loop); });
