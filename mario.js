'use strict';
/* ============================================================
   超级水管工 SUPER PLUMBER
   一个从零手写的马里奥风格平台跳跃游戏。
   全部代码、像素素材、关卡设计、音效与音乐均为原创，
   未参考任何网络资料或现成实现。
   玩法：奔跑 / 跳跃 / 踩敌人 / 顶砖块 / 吃金币与道具 / 抵达城堡
   ============================================================ */

/* ---------------- 基础工具 ---------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rectHit = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* 颜色工具：十六进制色 × 明暗系数 */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c) => Math.round(clamp(c + (255 - c) * f, 0, 255));
  return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
}

/* ---------------- 常量 ---------------- */
const TILE = 16;
const VIEW_W = 320, VIEW_H = 192;   /* 逻辑分辨率（复古） */
const SCALE = 3;                    /* 放大到 960×576 */
const STEP = 1 / 60;
const GRAV = 0.30;
const MAXFALL = 5.2;
const P_ACC = 0.085, P_AIR_ACC = 0.06, P_FRIC = 0.10, P_AIR_FRIC = 0.005;
const P_MAX_WALK = 1.15, P_MAX_RUN = 1.85;
const JUMP_V = 6.9, JUMP_CUT = 1.9;
const COYOTE = 6, JUMP_BUF = 8;
const STOMP_BOUNCE = 4.2, STOMP_BOUNCE_HOLD = 6.3;
const GOOMBA_V = 0.30, KOOPA_V = 0.45, SHELL_V = 2.6;

/* 图块编码 */
const T_EMPTY = 0, T_GROUND = 1, T_BRICK = 2, T_QCOIN = 3, T_QMUSH = 4,
      T_QFLOWER = 5, T_USED = 6, T_PIPE_TL = 7, T_PIPE_TR = 8,
      T_PIPE_BL = 9, T_PIPE_BR = 10, T_PLAT = 11, T_CASTLE = 13;

/* ---------------- 输入 ---------------- */
const KEYS = new Set();
const JUMP_CODES = ['Space', 'KeyZ', 'KeyK', 'ArrowUp'];
const LEFT_CODES = ['ArrowLeft', 'KeyA'];
const RIGHT_CODES = ['ArrowRight', 'KeyD'];
const RUN_CODES = ['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyJ'];
const SHOOT_CODES = ['KeyF', 'KeyL'];
const PREVENT = new Set([...JUMP_CODES, ...LEFT_CODES, ...RIGHT_CODES,
  'ShiftLeft', 'ShiftRight', 'KeyF', 'KeyL', 'KeyP', 'Escape', 'KeyM']);
const isDown = (arr) => arr.some((c) => KEYS.has(c));

function updateStartPrompt() {
  const prompt = document.getElementById('startPrompt');
  const label = document.getElementById('startPromptLabel');
  const hint = document.getElementById('startPromptHint');
  if (!prompt) return;
  const canStart = G.state === 'title' || G.state === 'gameover' || G.state === 'win';
  prompt.hidden = !canStart;
  if (canStart && label && hint) {
    const restart = G.state === 'gameover' || G.state === 'win';
    label.textContent = restart ? '点击重新开始' : '点击开始游戏';
    hint.textContent = restart ? '也可以按 Enter 键返回标题' : '也可以按 Enter 或空格键';
  }
}

function handleStartPointer() {
  if (!AC) initAudio();
  if (G.state === 'title') startGame();
  else if (G.state === 'gameover' || G.state === 'win') {
    G.state = 'title';
    G.best = Math.max(G.best, G.score);
  }
  updateStartPrompt();
}

window.addEventListener('keydown', (e) => {
  if (PREVENT.has(e.code)) e.preventDefault();
  if (e.repeat) { KEYS.add(e.code); return; }
  KEYS.add(e.code);
  if (JUMP_CODES.includes(e.code)) {
    G.jumpBuf = JUMP_BUF;
    /* 下 + 跳：从单向木桥上落下 */
    if (isDown(['ArrowDown', 'KeyS'])) P.dropT = 10;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') { G.muted = !G.muted; if (AC) masterGain.gain.value = G.muted ? 0 : 0.9; }
  if (e.code === 'Enter' || (G.state === 'title' && e.code === 'Space')) {
    if (!AC) initAudio();
    if (G.state === 'title') startGame();
    else if (G.state === 'gameover' || G.state === 'win') { G.state = 'title'; G.best = Math.max(G.best, G.score); }
    updateStartPrompt();
  }
});
window.addEventListener('keyup', (e) => { KEYS.delete(e.code); });
window.addEventListener('blur', () => { KEYS.clear(); });

function togglePause() {
  if (G.state === 'play') { G.state = 'pause'; }
  else if (G.state === 'pause') { G.state = 'play'; }
}

/* ---------------- 音频（Web Audio 合成，全部原创） ---------------- */
let AC = null, masterGain = null;
function initAudio() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    AC = new Ctor();
    masterGain = AC.createGain();
    masterGain.gain.value = G.muted ? 0 : 0.9;
    masterGain.connect(AC.destination);
    if (MUSIC.on) { MUSIC.step = 0; MUSIC.nextT = AC.currentTime + 0.05; }
  } catch (err) { AC = null; }
}
function tone(f0, f1, dur, type, vol, delay) {
  if (!AC || G.muted) return;
  try {
    const t0 = AC.currentTime + (delay || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    g.gain.setValueAtTime(vol || 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(masterGain);
    o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (err) { /* 忽略 */ }
}
function noise(dur, vol, delay) {
  if (!AC || G.muted) return;
  try {
    const t0 = AC.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(AC.sampleRate * dur));
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = AC.createBufferSource();
    const g = AC.createGain();
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.buffer = buf; s.connect(g); g.connect(masterGain);
    s.start(t0);
  } catch (err) { /* 忽略 */ }
}
const SFX = {
  jump()    { tone(240, 660, 0.18, 'square', 0.07); },
  coin()    { tone(988, 988, 0.07, 'square', 0.08); tone(1319, 1319, 0.18, 'square', 0.08, 0.07); },
  stomp()   { tone(420, 90, 0.12, 'square', 0.10); noise(0.08, 0.10); },
  bump()    { tone(120, 80, 0.09, 'square', 0.10); },
  brick()   { noise(0.18, 0.16); tone(180, 60, 0.15, 'square', 0.08); },
  powerup() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.08, 'square', 0.08, i * 0.07)); },
  powerdown(){ [784, 523, 392, 262].forEach((f, i) => tone(f, f, 0.10, 'square', 0.09, i * 0.09)); },
  fire()    { tone(880, 220, 0.12, 'square', 0.07); },
  kick()    { tone(300, 560, 0.10, 'square', 0.09); },
  sprout()  { tone(392, 784, 0.22, 'square', 0.07); },
  die()     { [659, 523, 392, 262, 196, 131, 98].forEach((f, i) => tone(f, f, 0.12, 'square', 0.09, i * 0.11)); },
  oneup()   { [659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, f, 0.09, 'square', 0.08, i * 0.08)); },
  flag()    { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.10, 'square', 0.09, i * 0.09)); },
  courseClear(){ [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, f, 0.12, 'square', 0.09, i * 0.11)); },
  gameover(){ [392, 330, 262, 196].forEach((f, i) => tone(f, f, 0.20, 'triangle', 0.12, i * 0.18)); },
  tick()    { tone(1100, 1100, 0.04, 'square', 0.05); },
};

/* 原创背景音乐：C 大调欢快小曲（自编） */
const MUSIC = { on: true, step: 0, nextT: 0, timer: null };
const MELODY_LEAD = [
  ['E5',1],['G5',1],['A5',1],['G5',1],['E5',1],['C5',1],['D5',1],['E5',1],
  ['G5',1],['E5',1],['C5',1],['A4',1],['G4',1],['A4',1],['C5',1],['D5',1],
  ['E5',1],['G5',1],['A5',1],['C6',1],['A5',1],['G5',1],['E5',1],['D5',1],
  ['C5',1],['D5',1],['E5',1],['D5',1],['C5',2],['E5',1],['G5',1],['C6',2],
];
const MELODY_BASS = [
  ['C3',2],['G2',2],['A2',2],['E2',2],['F2',2],['C3',2],['G2',2],['C3',2],
  ['C3',2],['G2',2],['A2',2],['E2',2],['F2',2],['G2',2],['C3',2],['C3',2],
];
const NOTE_FREQ = (() => {
  const f = {};
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  for (let oct = 1; oct <= 7; oct++) {
    names.forEach((n, i) => {
      const midi = (oct + 1) * 12 + i;
      f[n + oct] = 440 * Math.pow(2, (midi - 69) / 12);
    });
  }
  return f;
})();
function scheduleMusic() {
  if (!AC || !MUSIC.on || G.muted || (G.state !== 'title' && G.state !== 'play' && G.state !== 'clear')) return;
  const eighth = 0.19;
  while (MUSIC.nextT < AC.currentTime + 0.25) {
    const li = MUSIC.step % MELODY_LEAD.length;
    const bi = MUSIC.step % MELODY_BASS.length;
    const ln = MELODY_LEAD[li], bn = MELODY_BASS[bi];
    tone(NOTE_FREQ[ln[0]], NOTE_FREQ[ln[0]], eighth * ln[1] * 0.95, 'square', 0.035, MUSIC.nextT - AC.currentTime);
    if (MUSIC.step % 2 === 0) tone(NOTE_FREQ[bn[0]], NOTE_FREQ[bn[0]], eighth * bn[1] * 0.95, 'triangle', 0.07, MUSIC.nextT - AC.currentTime);
    MUSIC.nextT += eighth * 1;
    MUSIC.step++;
  }
}
setInterval(scheduleMusic, 90);

/* ---------------- 像素字体（3×5 点阵，原创） ---------------- */
const FONT = {
  'A':['.#.','#.#','###','#.#','#.#'], 'B':['##.','#.#','##.','#.#','##.'],
  'C':['.##','#..','#..','#..','.##'], 'D':['##.','#.#','#.#','#.#','##.'],
  'E':['###','#..','##.','#..','###'], 'F':['###','#..','##.','#..','#..'],
  'G':['.##','#..','#.#','#.#','.##'], 'H':['#.#','#.#','###','#.#','#.#'],
  'I':['###','.#.','.#.','.#.','###'], 'J':['..#','..#','..#','#.#','.#.'],
  'K':['#.#','#.#','##.','#.#','#.#'], 'L':['#..','#..','#..','#..','###'],
  'M':['#.#','###','###','#.#','#.#'], 'N':['###','#.#','#.#','#.#','#.#'],
  'O':['.#.','#.#','#.#','#.#','.#.'], 'P':['##.','#.#','##.','#..','#..'],
  'Q':['.#.','#.#','#.#','##.','.##'], 'R':['##.','#.#','##.','#.#','#.#'],
  'S':['.##','#..','.#.','..#','##.'], 'T':['###','.#.','.#.','.#.','.#.'],
  'U':['#.#','#.#','#.#','#.#','.#.'], 'V':['#.#','#.#','#.#','.#.','.#.'],
  'W':['#.#','#.#','###','###','#.#'], 'X':['#.#','#.#','.#.','#.#','#.#'],
  'Y':['#.#','#.#','.#.','.#.','.#.'], 'Z':['###','..#','.#.','#..','###'],
  '0':['.#.','#.#','#.#','#.#','.#.'], '1':['.#.','##.', '.#.','.#.','###'],
  '2':['##.','..#','.#.','#..','###'], '3':['##.','..#','.#.','..#','##.'],
  '4':['#.#','#.#','###','..#','..#'], '5':['###','#..','##.','..#','##.'],
  '6':['.##','#..','##.','#.#','.#.'], '7':['###','..#','.#.','.#.','.#.'],
  '8':['.#.','#.#','.#.','#.#','.#.'], '9':['.#.','#.#','.##','..#','##.'],
  '-':['...','...','###','...','...'], ':':['...','.#.','...','.#.','...'],
  '!':['.#.','.#.','.#.','...','.#.'], 'x':['#.#','#.#','.#.','#.#','#.#'],
  '.':['...','...','...','...','.#.'], '?':['##.','..#','.#.','...','.#.'],
};
function drawText(ctx, str, x, y, scale, color) {
  ctx.fillStyle = color || '#ffffff';
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] || FONT['?'];
    for (let r = 0; r < 5; r++) {
      const row = g[r];
      for (let c = 0; c < 3; c++) {
        if (row[c] === '#') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += 4 * scale;
  }
  return cx - x;
}
function drawTextCenter(ctx, str, cx, y, scale, color) {
  const w = str.length * 4 * scale;
  drawText(ctx, str, Math.round(cx - w / 2), y, scale, color);
}

/* ---------------- 精灵数据（原创像素画） ---------------- */
function makeSprite(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch && ch !== '.' && pal[ch]) {
        ctx.fillStyle = pal[ch];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return cv;
}

const PAL_HERO = { R:'#e23c30', S:'#f8b88c', N:'#7a4418', U:'#2b4fd0', Y:'#ffd800', K:'#1a1a1a' };
const PAL_FIRE = { R:'#f8f8f8', S:'#f8b88c', N:'#7a4418', U:'#e23c30', Y:'#ffd800', K:'#1a1a1a' };

/* 小个子主角（16×16） */
const S_HEAD = [
  '......RRRRRR....',
  '.....RRRRRRRRR..',
  '.....NNNSSSSSS..',
  '....NNSSSSSSS...',
  '....SSSSKKSSS...',
  '....SSSSSSSSS...',
  '.....SSSSSSS....',
  '.....RRRRRR.....',
  '....RRRRRRRR....',
];
const S_IDLE = [...S_HEAD,
  '....UUUUUUUU....',
  '...SUUUUUUUUS...',
  '...SS.UUUU.SS...',
  '.....UU..UU.....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '...NNNN..NNNN...',
];
const S_RUN1 = [...S_HEAD,
  '....UUUUUUUU....',
  '...SSUUUUUUSS...',
  '.....UUUUUU.....',
  '....UUU..UUU....',
  '....UU....UU....',
  '...NNN....NNN...',
  '..NNNN....NNNN..',
];
const S_RUN2 = [...S_HEAD,
  '....UUUUUUUU....',
  '..SS.UUUUUU.SS..',
  '.....UUUUUU.....',
  '.....UU..UU.....',
  '.....UU..UU.....',
  '....NNN..NNN....',
  '....NNN..NNN....',
];
const S_JUMP = [...S_HEAD,
  '....UUUUUUUU....',
  '..SS..UUUU..SS..',
  '.......UU.......',
  '......UUUU......',
  '......UUU.......',
  '.....NNNN.......',
  '.....NNNN.......',
];

/* 大个子主角（16×32） */
const B_HEAD = [
  '......RRRRRR....',
  '.....RRRRRRRRR..',
  '....RRRRRRRRRR..',
  '.....NNNSSSSS...',
  '....NNSSSSSSS...',
  '....SSSSKKSSS...',
  '....SSSSSSSSS...',
  '.....SSSSSSS....',
  '.....RRRRRR.....',
  '....RRRRRRRR....',
  '....RRRRRRRRR...',
  '....RRRRRRRR....',
];
const B_IDLE = [...B_HEAD,
  '....UUUUUUUU....',
  '....UUUUUUUU....',
  '...SUUUUUUUUS...',
  '...SUUUUUUUUS...',
  '...SS.UUUU.SS...',
  '.....UU..UU.....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UU....UU....',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '..UUUU....UUUU..',
  '..UUUU....UUUU..',
  '..NNNN....NNNN..',
  '..NNNN....NNNN..',
];
const B_RUN1 = [...B_HEAD,
  '....UUUUUUUU....',
  '....UUUUUUUU....',
  '...SSUUUUUUSS...',
  '.....UUUUUU.....',
  '....UUU..UUU....',
  '....UU....UU....',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '...UU......UU...',
  '..UUU......UUU..',
  '..UUU......UUU..',
  '..UUU......UUU..',
  '..UUU......UUU..',
  '..UU........UU..',
  '..UU........UU..',
  '..UU........UU..',
  '.NNNN......NNNN.',
  '.NNNN......NNNN.',
];
const B_RUN2 = [...B_HEAD,
  '....UUUUUUUU....',
  '....UUUUUUUU....',
  '..SS.UUUUUU.SS..',
  '.....UUUUUU.....',
  '.....UU..UU.....',
  '.....UU..UU.....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UU....UU....',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '...UU......UU...',
  '...UU......UU...',
  '...UU......UU...',
  '....NN....NN....',
  '....NN....NN....',
];
const B_JUMP = [...B_HEAD,
  '....UUUUUUUU....',
  '....UUUUUUUU....',
  '..SS..UUUU..SS..',
  '..SS..UUUU..SS..',
  '......UUUU......',
  '.....UUUUUU.....',
  '.....UU..UU.....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '....UU......UU..',
  '....UU......UU..',
  '....UU......UU..',
  '....UU......UU..',
  '....UU......UU..',
  '...NNNN....NNNN.',
  '...NNNN....NNNN.',
  '...NNNN....NNNN.',
  '...NNNN....NNNN.',
];

/* 板栗怪 Goomba */
const GOOMBA_A = [
  '.....KKKKKK.....',
  '....KKKKKKKK....',
  '...WWWWWWWWWW...',
  '..WWKWWWWWWKWW..',
  '..WWWWWWWWWWWW..',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
  '.BBBBBBBBBBBBBB.',
  '..BBB....BBB....',
  '...NN....NN.....',
  '..NNN....NNN....',
];
const GOOMBA_B = [...GOOMBA_A.slice(0, 13),
  '..BBB....BBB....',
  '...NN....NN.....',
  '...NNN...NNN....',
];
const GOOMBA_SQUASH = [
  '..WWWWWWWWWWWW..',
  '.BBBBBBBBBBBBBB.',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBB',
  '.BBBBBBBBBBBBBB.',
  '..NNN......NNN..',
  '..NNN......NNN..',
];

/* 乌龟怪 Koopa */
const KOOPA_A = [
  '....GGGGGGGG....',
  '..GGGGGGGGGGGG..',
  '.GGWGGGGGGGGWGG.',
  '.GGWGGGGGGGGWGG.',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  '..YYYYYYYYYYYY..',
  '.YYKYYYYYYYYKYY.',
  '.YYYYYYYYYYYYYY.',
  'YYYYYYYYYYYYYYYY',
  'YYYYYYYYYYYYYYYY',
  '..YY........YY..',
  '...NN......NN...',
  '..NNN......NNN..',
];
const KOOPA_B = [...KOOPA_A.slice(0, 13),
  '..YY........YY..',
  '...NN......NN...',
  '...NNN...NNN....',
];
const SHELL = [
  '...GGGGGGGGGG...',
  '..GGGGGGGGGGGG..',
  '.GGWGGGGGGGGWGG.',
  '.GGWGGGGGGGGWGG.',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  '.GGGGGGGGGGGGGG.',
  '..GGGGGGGGGGGG..',
];

/* 蘑菇 / 火焰花 / 金币 / 火球 */
const MUSH = [
  '.....RRRRRR.....',
  '...RRRRRRRRRR...',
  '..RRWWRRRRWWRR..',
  '..RRWWRRRRWWRR..',
  '.RRRRRRRRRRRRRR.',
  '.RRRRRRRRRRRRRR.',
  'RRRRRRRRRRRRRRRR',
  'RRRRRRRRRRRRRRRR',
  '..TTTTTTTTTTTT..',
  '.TTTTTTTTTTTTTT.',
  '.TTKKTTTTTTKKTT.',
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  '.TTTTTTTTTTTTTT.',
  '..TTT......TTT..',
  '..TTT......TTT..',
];
const FLOWER = [
  '.......OO.......',
  '......OOOO......',
  '......OOOO......',
  '...OOOWWWWOOO...',
  '...OOOWWWWOOO...',
  '...OOOWWWWOOO...',
  '...OOOWWWWOOO...',
  '......OOOO......',
  '......OOOO......',
  '.......OO.......',
  '.......GG.......',
  '....GGGGGGGG....',
  '....GGGGGGGG....',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
];
const COIN_A = [
  '....GGGG....',
  '..GGGGGGGG..',
  '.GGHHHHHHGG.',
  '.GHGGGGGGHG.',
  'GHGGGGGGGGHG',
  'GHGGGGGGGGHG',
  'GHGGGGGGGGHG',
  'GHGGGGGGGGHG',
  'GHGGGGGGGGHG',
  'GHGGGGGGGGHG',
  '.GHGGGGGGHG.',
  '.GGHHHHHHGG.',
  '..GGGGGGGG..',
  '....GGGG....',
];
const COIN_B = [
  '...GGGG...',
  '.GGGGGGGG.',
  'GGHHHHHHGG',
  'GGHGGGGHGG',
  'GGHGGGGHGG',
  'GGHGGGGHGG',
  'GGHGGGGHGG',
  'GGHGGGGHGG',
  'GGHGGGGHGG',
  'GGHGGGGHGG',
  'GGHGGGGHGG',
  'GGHHHHHHGG',
  '.GGGGGGGG.',
  '...GGGG...',
];
const COIN_C = [
  '...GG...',
  '..GHGG..',
  '.GGHGGG.',
  'GGGHGGGG',
  'GGGHGGGG',
  'GGGHGGGG',
  'GGGHGGGG',
  'GGGHGGGG',
  'GGGHGGGG',
  'GGGHGGGG',
  'GGGHGGGG',
  '.GGHGGG.',
  '..GHGG..',
  '...GG...',
];
const FIRE_A = [
  '..OOOO..',
  '.OYYYYO.',
  'OYWWYYYO',
  'OYWWYYYO',
  'OYYYYYYO',
  'OYYYYYYO',
  '.OYYYYO.',
  '..OOOO..',
];
const FIRE_B = [
  '..OOOO..',
  '.OYYYYO.',
  'OYWWYYYO',
  'OYYWYYYO',
  'OYYYYYYO',
  '.OYYYYO.',
  '..OYYO..',
  '...OO...',
];

/* 预渲染所有精灵 */
const SPR = {};
function buildSprites() {
  const hp = PAL_HERO, fp = PAL_FIRE;
  SPR.heroSmall = [
    [makeSprite(S_IDLE, hp), makeSprite(S_RUN1, hp), makeSprite(S_RUN2, hp), makeSprite(S_JUMP, hp)],
    [makeSprite(S_IDLE, fp), makeSprite(S_RUN1, fp), makeSprite(S_RUN2, fp), makeSprite(S_JUMP, fp)],
  ];
  SPR.heroBig = [
    [makeSprite(B_IDLE, hp), makeSprite(B_RUN1, hp), makeSprite(B_RUN2, hp), makeSprite(B_JUMP, hp)],
    [makeSprite(B_IDLE, fp), makeSprite(B_RUN1, fp), makeSprite(B_RUN2, fp), makeSprite(B_JUMP, fp)],
  ];
  SPR.goomba = [makeSprite(GOOMBA_A, { K:'#1a1a1a', W:'#ffffff', B:'#a06428', N:'#5f3a12' }),
                makeSprite(GOOMBA_B, { K:'#1a1a1a', W:'#ffffff', B:'#a06428', N:'#5f3a12' })];
  SPR.goombaSquash = makeSprite(GOOMBA_SQUASH, { K:'#1a1a1a', W:'#ffffff', B:'#a06428', N:'#5f3a12' });
  const kp = { G:'#2fae3e', W:'#e8f8e8', Y:'#f7d25c', K:'#1a1a1a', N:'#5f3a12' };
  SPR.koopa = [makeSprite(KOOPA_A, kp), makeSprite(KOOPA_B, kp)];
  SPR.shell = makeSprite(SHELL, kp);
  SPR.mush = makeSprite(MUSH, { R:'#e23c30', W:'#fff2d0', T:'#f7d9a8', K:'#1a1a1a' });
  SPR.flower = makeSprite(FLOWER, { O:'#f8a018', W:'#fff8e0', G:'#2fae3e' });
  const cp = { G:'#ffcf40', H:'#c8860a' };
  SPR.coin = [makeSprite(COIN_A, cp), makeSprite(COIN_B, cp), makeSprite(COIN_C, cp), makeSprite(COIN_B, cp)];
  const fp2 = { O:'#ff7010', Y:'#ffd040', W:'#fff2c0' };
  SPR.fire = [makeSprite(FIRE_A, fp2), makeSprite(FIRE_B, fp2)];
}

/* ---------------- 图块（程序化绘制） ---------------- */
function tileCanvas(drawFn) {
  const cv = document.createElement('canvas');
  cv.width = TILE; cv.height = TILE;
  const ctx = cv.getContext('2d');
  drawFn(ctx);
  return cv;
}
function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function drawGround(ctx, f) {
  const base = shade('#c06828', f);
  px(ctx, 0, 0, 16, 3, shade('#7a3a18', f));
  px(ctx, 0, 3, 16, 12, base);
  px(ctx, 0, 15, 16, 1, shade('#7a3a18', f));
  const d = shade('#8a4418', f);
  px(ctx, 4, 6, 2, 2, d); px(ctx, 10, 9, 2, 2, d); px(ctx, 7, 12, 2, 2, d);
  px(ctx, 0, 3, 16, 1, shade('#e8984a', f));
}
function drawBrick(ctx, f) {
  const b = shade('#c8582e', f), l = shade('#e0784e', f), m = shade('#6b2410', f), dk = shade('#8a3418', f);
  px(ctx, 0, 0, 16, 16, b);
  px(ctx, 0, 0, 16, 2, l);
  px(ctx, 0, 0, 1, 16, dk); px(ctx, 15, 0, 1, 16, dk);
  px(ctx, 0, 7, 16, 1, m); px(ctx, 0, 15, 16, 1, dk);
  px(ctx, 8, 0, 1, 7, m);
  px(ctx, 4, 8, 1, 7, m); px(ctx, 12, 8, 1, 7, m);
}
function drawQBlock(ctx, f) {
  const b = shade('#e8a33d', f), d = shade('#7a4a14', f), l = shade('#ffe9b8', f);
  px(ctx, 0, 0, 16, 16, b);
  px(ctx, 0, 0, 16, 1, d); px(ctx, 0, 15, 16, 1, d);
  px(ctx, 0, 0, 1, 16, d); px(ctx, 15, 0, 1, 16, d);
  px(ctx, 1, 1, 3, 3, l); px(ctx, 1, 13, 2, 2, d);
  px(ctx, 13, 1, 2, 2, d); px(ctx, 13, 13, 2, 2, d);
  const glyph = ['01110','10001','00001','00010','00100','00000','00100'];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
    if (glyph[r][c] === '1') px(ctx, 5 + c, 4 + r, 1, 1, d);
  }
}
function drawUsed(ctx, f) {
  const b = shade('#a5713a', f), d = shade('#5f4528', f);
  px(ctx, 0, 0, 16, 16, b);
  px(ctx, 0, 0, 16, 1, d); px(ctx, 0, 15, 16, 1, d);
  px(ctx, 0, 0, 1, 16, d); px(ctx, 15, 0, 1, 16, d);
  px(ctx, 1, 1, 2, 2, d); px(ctx, 13, 1, 2, 2, d);
  px(ctx, 1, 13, 2, 2, d); px(ctx, 13, 13, 2, 2, d);
}
function drawPipeTL(ctx) {
  const b = '#2f9e3c', d = '#0c3d10', l = '#8fe88a', s = '#1e6b24';
  px(ctx, 0, 2, 16, 6, b); px(ctx, 0, 2, 16, 1, d);
  px(ctx, 0, 2, 1, 6, d); px(ctx, 15, 2, 1, 6, d);
  px(ctx, 2, 8, 14, 8, b);
  px(ctx, 2, 8, 1, 8, d); px(ctx, 15, 8, 1, 8, d);
  px(ctx, 3, 8, 2, 8, l); px(ctx, 12, 8, 2, 8, s);
  px(ctx, 1, 3, 2, 4, l);
}
function drawPipeTR(ctx) {
  const b = '#2f9e3c', d = '#0c3d10', l = '#8fe88a', s = '#1e6b24';
  px(ctx, 0, 2, 16, 6, b); px(ctx, 0, 2, 16, 1, d);
  px(ctx, 0, 2, 1, 6, d); px(ctx, 15, 2, 1, 6, d);
  px(ctx, 0, 8, 14, 8, b);
  px(ctx, 0, 8, 1, 8, d); px(ctx, 13, 8, 1, 8, d);
  px(ctx, 1, 8, 2, 8, l); px(ctx, 10, 8, 2, 8, s);
  px(ctx, 13, 3, 2, 4, l);
}
function drawPipeBL(ctx) {
  const b = '#2f9e3c', d = '#0c3d10', l = '#8fe88a', s = '#1e6b24';
  px(ctx, 2, 0, 14, 16, b);
  px(ctx, 2, 0, 1, 16, d); px(ctx, 15, 0, 1, 16, d);
  px(ctx, 3, 0, 2, 16, l); px(ctx, 12, 0, 2, 16, s);
  px(ctx, 0, 0, 2, 16, d);
}
function drawPipeBR(ctx) {
  const b = '#2f9e3c', d = '#0c3d10', l = '#8fe88a', s = '#1e6b24';
  px(ctx, 0, 0, 14, 16, b);
  px(ctx, 0, 0, 1, 16, d); px(ctx, 13, 0, 1, 16, d);
  px(ctx, 1, 0, 2, 16, l); px(ctx, 10, 0, 2, 16, s);
  px(ctx, 14, 0, 2, 16, d);
}
function drawPlat(ctx) {
  px(ctx, 0, 0, 16, 16, '#a87840');
  px(ctx, 0, 0, 16, 2, '#e0b878');
  px(ctx, 0, 2, 16, 1, '#c89050');
  px(ctx, 0, 15, 16, 1, '#7a5428');
  px(ctx, 0, 0, 1, 16, '#8a6030'); px(ctx, 15, 0, 1, 16, '#8a6030');
  px(ctx, 3, 3, 1, 1, '#7a5428'); px(ctx, 12, 3, 1, 1, '#7a5428');
}
const TILESP = {};
function buildTiles() {
  TILESP[T_GROUND] = tileCanvas((c) => drawGround(c, 0));
  TILESP[T_BRICK] = tileCanvas((c) => drawBrick(c, 0));
  TILESP[T_QCOIN] = [0, 1, 2].map((i) => tileCanvas((c) => drawQBlock(c, [0, 0.18, -0.12][i])));
  TILESP[T_QMUSH] = [0, 1, 2].map((i) => tileCanvas((c) => drawQBlock(c, [0, 0.18, -0.12][i])));
  TILESP[T_QFLOWER] = [0, 1, 2].map((i) => tileCanvas((c) => drawQBlock(c, [0, 0.18, -0.12][i])));
  TILESP[T_USED] = tileCanvas((c) => drawUsed(c, 0));
  TILESP[T_PIPE_TL] = tileCanvas(drawPipeTL);
  TILESP[T_PIPE_TR] = tileCanvas(drawPipeTR);
  TILESP[T_PIPE_BL] = tileCanvas(drawPipeBL);
  TILESP[T_PIPE_BR] = tileCanvas(drawPipeBR);
  TILESP[T_PLAT] = tileCanvas(drawPlat);
}

/* ---------------- 关卡数据（原创设计） ----------------
   图例： X 地面  B 砖块  ? 金币块  M 蘑菇块  f 火花块  U 已用块
         [ ] 管道顶  { } 管道身  = 单向木桥  o 金币
         g 板栗怪  k 乌龟怪  S 出生点  F 旗杆  K 城堡
         （空格为空白） */
function segRow(segs, w) {
  let s = '';
  for (const g of segs) s += (typeof g === 'string') ? g : g[0].repeat(g[1]);
  return s.padEnd(w, ' ').slice(0, w);
}
/* ---- 第 1 关：青草平原 ---- */
const L1 = { w: 200, time: 300, rows: [
  segRow([[' ',200]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',187],['F',1],[' ',12]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',133],['X',4],[' ',42],['X',5],[' ',16]], 200),
  segRow([[' ',132],['X',2],[' ',44],['X',2],[' ',20]], 200),
  segRow([[' ',131],['X',3],[' ',43],['X',3],[' ',20]], 200),
  segRow([[' ',130],['X',4],[' ',19],['o',1],[' ',1],['o',1],[' ',1],['o',1],[' ',18],['X',4],[' ',20]], 200),
  segRow([[' ',8],['?',3],[' ',9],['M',1],[' ',3],['B',1],['?',1],['B',1],[' ',9],['M',1],[' ',7],['B',1],['?',1],['B',1],[' ',6],['X',1],[' ',42],['B',1],['?',1],['B',1],['f',1],['B',1],['B',1],[' ',21],['?',1],[' ',5],['X',5],[' ',18],['=',7],[' ',3],['f',1],[' ',12],['X',5],[' ',20]], 200),
  segRow([[' ',52],['X',2],[' ',12],['o',1],[' ',1],['o',1],[' ',1],['o',1],[' ',3],['[',1],[']',1],[' ',4],['=',7],[' ',25],['=',7],[' ',9],['X',6],[' ',40],['X',6],[' ',20]], 200),
  segRow([[' ',32],['[',1],[']',1],[' ',17],['X',3],[' ',20],['{',1],['}',1],[' ',48],['o',1],[' ',1],['o',1],['X',7],[' ',26],['[',1],[']',1],[' ',11],['X',7],[' ',20]], 200),
  segRow([[' ',3],['S',1],[' ',12],['[',1],[']',1],[' ',9],['g',1],[' ',4],['{',1],['}',1],[' ',4],['g',1],[' ',1],['g',1],[' ',9],['X',4],[' ',3],['k',1],[' ',16],['{',1],['}',1],[' ',6],['g',1],[' ',1],['g',1],[' ',7],['k',1],[' ',20],['g',1],[' ',2],['g',1],[' ',3],['[',1],[']',1],[' ',4],['X',8],[' ',10],['k',1],[' ',3],['g',1],[' ',11],['{',1],['}',1],[' ',10],['X',8],[' ',20]], 200),
  segRow([['X',16],['{}',1],['X',14],['{}',1],['X',40],['{}',1],['X',29],[' ',4],['X',11],['{}',1],['X',16],[' ',4],['X',18],['{}',1],['X',4],[' ',4],['X',22],['K',5],['X',3]], 200),
  segRow([['X',59],[' ',3],['X',43],[' ',4],['X',29],[' ',4],['X',24],[' ',4],['X',30]], 200),
]};
/* ---- 第 2 关：断桥丘陵 ---- */
const L2 = { w: 200, time: 300, rows: [
  segRow([[' ',200]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',186],['F',1],[' ',13]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',171],['X',5],[' ',24]], 200),
  segRow([[' ',170],['X',2],[' ',28]], 200),
  segRow([[' ',80],['o',1],[' ',1],['o',1],[' ',86],['X',3],[' ',28]], 200),
  segRow([[' ',80],['=',3],[' ',69],['o',1],[' ',15],['X',4],[' ',28]], 200),
  segRow([[' ',32],['B',1],['?',1],['f',1],['?',1],['B',1],[' ',14],['X',1],[' ',10],['M',1],[' ',43],['B',1],['?',1],['B',1],['f',1],['B',1],['B',1],[' ',20],['M',1],[' ',17],['=',5],[' ',6],['f',1],[' ',5],['X',5],[' ',28]], 200),
  segRow([[' ',16],['=',4],[' ',30],['X',2],[' ',1],['=',3],[' ',16],['[',1],[']',1],[' ',4],['=',7],[' ',13],['X',2],[' ',15],['=',4],[' ',47],['X',6],[' ',28]], 200),
  segRow([[' ',24],['[',1],[']',1],[' ',23],['X',3],[' ',20],['{',1],['}',1],[' ',23],['X',3],[' ',28],['[',1],[']',1],[' ',35],['X',7],[' ',28]], 200),
  segRow([[' ',3],['S',1],[' ',8],['g',1],[' ',1],['g',1],[' ',9],['{',1],['}',1],[' ',2],['k',1],[' ',19],['X',4],[' ',6],['g',1],[' ',1],['g',1],[' ',5],['k',1],[' ',1],['k',1],[' ',3],['{',1],['}',1],[' ',22],['X',4],[' ',2],['k',1],[' ',19],['g',1],['g',1],['g',1],[' ',3],['{',1],['}',1],[' ',12],['k',1],[' ',3],['g',1],[' ',11],['[',1],[']',1],[' ',4],['X',8],[' ',28]], 200),
  segRow([['X',16],[' ',4],['X',4],['{}',1],['X',14],[' ',4],['X',9],[' ',3],['X',16],['{}',1],['X',14],[' ',4],['X',23],[' ',4],['X',9],['{}',1],['X',4],[' ',4],['X',20],['{}',1],['X',17],[' ',4],['X',19]], 200),
  segRow([['X',16],[' ',4],['X',20],[' ',4],['X',9],[' ',3],['X',32],[' ',4],['X',23],[' ',4],['X',15],[' ',4],['X',39],[' ',4],['X',10],['K',5],['X',4]], 200),
]};
/* ---- 第 3 关：铁壳山谷 ---- */
const L3 = { w: 200, time: 280, rows: [
  segRow([[' ',200]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',184],['F',1],[' ',15]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',200]], 200),
  segRow([[' ',169],['X',5],[' ',26]], 200),
  segRow([[' ',168],['X',2],[' ',30]], 200),
  segRow([[' ',96],['o',1],[' ',1],['o',1],[' ',68],['X',3],[' ',30]], 200),
  segRow([[' ',71],['o',1],['o',1],[' ',23],['=',3],[' ',67],['X',4],[' ',30]], 200),
  segRow([[' ',10],['M',1],[' ',6],['o',1],['o',1],[' ',5],['B',1],['?',1],['?',1],['f',1],['B',1],[' ',18],['X',1],[' ',3],['o',1],['o',1],[' ',9],['B',1],['B',1],['?',1],['B',1],['f',1],['B',1],[' ',2],['=',4],[' ',16],['f',1],[' ',24],['X',1],[' ',16],['M',1],[' ',3],['B',1],['?',1],['B',1],['f',1],['B',1],['?',1],['B',1],[' ',22],['X',5],[' ',30]], 200),
  segRow([[' ',16],['=',4],[' ',26],['X',2],[' ',2],['=',4],[' ',32],['[',1],[']',1],[' ',6],['=',7],[' ',13],['X',2],[' ',4],['=',3],[' ',23],['=',4],[' ',14],['X',6],[' ',30]], 200),
  segRow([[' ',32],['[',1],[']',1],[' ',11],['X',3],[' ',38],['{',1],['}',1],[' ',25],['X',3],[' ',38],['[',1],[']',1],[' ',7],['X',7],[' ',30]], 200),
  segRow([[' ',3],['S',1],[' ',2],['g',1],[' ',1],['g',1],[' ',5],['k',1],[' ',17],['{',1],['}',1],[' ',2],['k',1],[' ',2],['g',1],[' ',4],['X',4],[' ',10],['k',1],[' ',1],['k',1],[' ',17],['k',1],[' ',1],['k',1],[' ',1],['g',1],[' ',3],['{',1],['}',1],[' ',24],['X',4],[' ',2],['k',1],[' ',7],['g',1],[' ',1],['g',1],[' ',1],['g',1],[' ',23],['{',1],['}',1],[' ',2],['k',1],[' ',3],['X',8],[' ',30]], 200),
  segRow([['X',16],[' ',4],['X',12],['{}',1],['X',16],[' ',4],['X',16],[' ',4],['X',12],['{}',1],['X',16],[' ',4],['X',12],[' ',3],['X',23],[' ',4],['X',4],['{}',1],['X',33],['K',5],['X',6]], 200),
  segRow([['X',16],[' ',4],['X',30],[' ',4],['X',16],[' ',4],['X',30],[' ',4],['X',12],[' ',3],['X',23],[' ',4],['X',50]], 200),
]};
const LEVELS = [L1, L2, L3];

/* ---------------- 游戏状态 ---------------- */
const G = {
  state: 'title',   /* title | play | pause | dying | clear | gameover | win */
  level: 0, score: 0, coins: 0, lives: 3, best: 0,
  time: 300, timerF: 0, timeWarn: false,
  camX: 0, camY: 0, ftime: 0, jumpBuf: 0,
  chain: 0, clearPhase: 'slide', deathT: 0, bonusT: 0,
  muted: false, blink: 0,
};
const P = {
  x: 0, y: 0, vx: 0, vy: 0, w: 12, h: 14, face: 1,
  power: 0, onGround: false, coyote: 0, inv: 0,
  growT: 0, shrinkT: 0, cool: 0, dropT: 0, dead: false, animT: 0,
};
let W = 0, H = 0, tiles = null, flagX = 0, flagTopY = 0, flagGroundY = 0,
    castleCol = -1, castleDoorX = 0, spawnX = 0, spawnY = 0;
let enemies = [], items = [], coins = [], fireballs = [], particles = [], floats = [];
const BLOCKS = new Map();   /* idx -> 顶动计时 */

/* ---------------- 关卡解析 ---------------- */
function parseLevel(li) {
  const def = LEVELS[li];
  W = def.w;
  const rows = def.rows.map((r) => (typeof r === 'string' ? r : r));
  H = rows.length;
  tiles = new Uint8Array(W * H);
  enemies = []; items = []; coins = []; fireballs = []; particles = []; floats = [];
  BLOCKS.clear();
  flagX = -1; castleCol = -1;
  for (let y = 0; y < H; y++) {
    const row = rows[y];
    for (let x = 0; x < W; x++) {
      const ch = row[x] || ' ';
      const idx = y * W + x;
      switch (ch) {
        case 'X': tiles[idx] = T_GROUND; break;
        case 'B': tiles[idx] = T_BRICK; break;
        case '?': tiles[idx] = T_QCOIN; break;
        case 'M': tiles[idx] = T_QMUSH; break;
        case 'f': tiles[idx] = T_QFLOWER; break;
        case 'U': tiles[idx] = T_USED; break;
        case '[': tiles[idx] = T_PIPE_TL; break;
        case ']': tiles[idx] = T_PIPE_TR; break;
        case '{': tiles[idx] = T_PIPE_BL; break;
        case '}': tiles[idx] = T_PIPE_BR; break;
        case '=': tiles[idx] = T_PLAT; break;
        case 'o': coins.push(makeCoin(x * TILE + 3, y * TILE + 1)); break;
        case 'g': enemies.push(makeGoomba(x * TILE, y * TILE + 16 - 13)); break;
        case 'k': enemies.push(makeKoopa(x * TILE, y * TILE + 16 - 14)); break;
        case 'S': spawnX = x * TILE + 1; spawnY = y * TILE + 16; break;
        case 'F': flagX = x * TILE + 7; flagTopY = y * TILE; break;
        case 'K': if (castleCol < 0) castleCol = x; break;
        default: tiles[idx] = T_EMPTY;
      }
    }
  }
  /* 旗杆底部 = 该列下方第一块实心图块顶部 */
  if (flagX >= 0) {
    const fc = Math.floor(flagX / TILE);
    let gy = H;
    for (let y = Math.floor(flagTopY / TILE); y < H; y++) {
      const c = tiles[y * W + fc];
      if (c >= 1 && c <= 10) { gy = y; break; }
    }
    flagGroundY = gy * TILE;
  }
  castleDoorX = castleCol >= 0 ? (castleCol + 2) * TILE + 2 : 0;
}
function resetPlayer() {
  P.x = spawnX; P.y = spawnY - 14; P.vx = 0; P.vy = 0;
  P.power = 0; P.inv = 0; P.growT = 0; P.shrinkT = 0; P.cool = 0;
  P.dead = false; P.onGround = false; P.coyote = 0; P.dropT = 0; P.animT = 0;
}
function startGame() {
  G.score = 0; G.coins = 0; G.lives = 3;
  startLevel(0);
}
function startLevel(li) {
  G.level = li;
  G.state = 'play';
  updateStartPrompt();
  G.chain = 0;
  G.time = LEVELS[li].time;
  G.timerF = 0;
  parseLevel(li);
  resetPlayer();
  G.camX = clamp(P.x + P.w / 2 - VIEW_W / 2, 0, W * TILE - VIEW_W);
  G.camY = clamp(P.y + P.h / 2 - VIEW_H / 2, 0, H * TILE - VIEW_H);
}
function nextLevel() {
  if (G.level + 1 < LEVELS.length) {
    startLevel(G.level + 1);
  } else {
    G.state = 'win';
    updateStartPrompt();
    G.best = Math.max(G.best, G.score);
    try { if (window.localStorage) window.localStorage.setItem('sp_best', String(G.best)); } catch (e) {}
    SFX.courseClear();
  }
}

/* ---------------- 实体工厂 ---------------- */
function makeGoomba(x, y) {
  return { type: 'goomba', x, y, w: 14, h: 13, vx: -GOOMBA_V, vy: 0,
           state: 'walk', deadT: 0, awake: false, animT: 0 };
}
function makeKoopa(x, y) {
  return { type: 'koopa', x, y, w: 14, h: 14, vx: -KOOPA_V, vy: 0,
           state: 'walk', shellT: 0, deadT: 0, awake: false, animT: 0 };
}
function makeCoin(x, y) {
  return { x, y, w: 10, h: 13 };
}
function makeItem(x, y, kind) {
  return { type: 'item', kind, x, y, w: 14, h: 14, vx: 0.4, vy: 0,
           riseT: 17, active: false };
}
function makeCoinPop(x, y) {
  return { type: 'coinpop', x, y, w: 10, h: 13, vy: -3.4, life: 26 };
}
function spawnItem(tx, ty, kind) {
  items.push(makeItem(tx * TILE + 1, ty * TILE + 2, kind));
}
function addScorePopup(x, y, text) {
  floats.push({ x, y, text, t: 50 });
}
function addDebris(tx, ty) {
  const cx = tx * TILE, cy = ty * TILE;
  for (let i = 0; i < 4; i++) {
    const qx = cx + (i % 2) * 8, qy = cy + Math.floor(i / 2) * 8;
    particles.push({ x: qx, y: qy, vx: (i % 2 ? 1.1 : -1.1) + (Math.random() - 0.5), vy: -3.2 - Math.random() * 1.5,
                     g: 0.25, life: 90, color: '#c8582e', size: 8 });
  }
  particles.push({ x: cx + 8, y: cy + 8, vx: 0, vy: -1, g: 0, life: 12, color: '#ffffff', size: 10 });
}
function addPuff(x, y) {
  for (let i = 0; i < 5; i++) {
    particles.push({ x: x + Math.random() * 8 - 4, y: y + Math.random() * 4, vx: (Math.random() - 0.5) * 0.8,
                     vy: -Math.random() * 0.6, g: 0, life: 18, color: '#ffffff', size: 3 });
  }
}
function addSparkle(x, y) {
  for (let i = 0; i < 6; i++) {
    particles.push({ x: x + 6, y: y + 6, vx: (Math.random() - 0.5) * 2.2, vy: (Math.random() - 0.5) * 2.2,
                     g: 0.05, life: 22, color: '#ffd040', size: 2 });
  }
}

/* ---------------- 碰撞 ---------------- */
function tileAt(tx, ty) {
  if (ty < 0) return T_EMPTY;
  if (ty >= H) return T_EMPTY;
  if (tx < 0 || tx >= W) return T_GROUND;
  return tiles[ty * W + tx];
}
function isSolid(c) { return c >= 1 && c <= 10; }

function moveAndCollide(ent, dx, dy, opts) {
  opts = opts || {};
  const res = { wall: 0, ground: false, head: [] };
  if (dx !== 0) {
    const dir = dx > 0 ? 1 : -1;
    ent.x += dx;
    let snap = null;
    const y0 = Math.max(0, Math.floor(ent.y / TILE));
    const y1 = Math.floor((ent.y + ent.h) / TILE);
    const x0 = Math.floor(ent.x / TILE);
    const x1 = Math.floor((ent.x + ent.w) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isSolid(tileAt(tx, ty))) continue;
        /* 严格重叠：贴边不算碰撞，避免脚底踩进地面 1px 时把地面当侧墙 */
        if ((ty + 1) * TILE <= ent.y || ty * TILE >= ent.y + ent.h) continue;
        if (dir > 0 && (snap === null || tx < snap)) snap = tx;
        if (dir < 0 && (snap === null || tx > snap)) snap = tx;
      }
    }
    if (snap !== null) {
      ent.x = dir > 0 ? snap * TILE - ent.w : (snap + 1) * TILE;
      res.wall = dir;
      if (opts.bounce) ent.vx = -ent.vx;
      else if (opts.zeroVx) ent.vx = 0;
    }
  }
  if (dy !== 0) {
    const dir = dy > 0 ? 1 : -1;
    const prevBottom = ent.y + ent.h;
    ent.y += dy;
    let snap = null, bumpTiles = [];
    const y0 = Math.floor(ent.y / TILE);
    const y1 = Math.floor((ent.y + ent.h) / TILE);
    const x0 = Math.floor(ent.x / TILE);
    const x1 = Math.floor((ent.x + ent.w) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = tileAt(tx, ty);
        if ((ty + 1) * TILE <= ent.y || ty * TILE >= ent.y + ent.h) continue;
        if ((tx + 1) * TILE <= ent.x || tx * TILE >= ent.x + ent.w) continue;
        if (dir > 0) {
          const solid = isSolid(c) || (c === T_PLAT && opts.player && !opts.dropThrough &&
                                       prevBottom <= ty * TILE + 0.5);
          if (solid && (snap === null || ty < snap)) snap = ty;
        } else {
          if (isSolid(c)) {
            if (snap === null || ty > snap) snap = ty;
            bumpTiles.push([tx, ty]);
          }
        }
      }
    }
    if (snap !== null) {
      if (dir > 0) {
        ent.y = snap * TILE - ent.h;
        res.ground = true;
        if (opts.bounceDown) ent.vy = opts.bounceDown;
      } else {
        ent.y = (snap + 1) * TILE;
        res.head = bumpTiles;
        ent.vy = 0;
      }
    }
  }
  return res;
}

function enemySolidityCheck(e) {
  /* 乌龟怪在边缘回头：前方脚下没有实心地则反向（龟壳不回头） */
  if (e.type !== 'koopa' || !e.onGround || e.state !== 'walk') return;
  const ahead = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
  const footY = e.y + e.h + 1;
  const c = tileAt(Math.floor(ahead / TILE), Math.floor(footY / TILE));
  if (!isSolid(c)) e.vx = -e.vx;
}

/* ---------------- 顶砖块 ---------------- */
function bumpTile(tx, ty) {
  const idx = ty * W + tx;
  const c = tiles[idx];
  if (c === T_BRICK) {
    if (P.power > 0) {
      tiles[idx] = T_EMPTY;
      addDebris(tx, ty);
      G.score += 50;
      addScorePopup(tx * TILE + 8, ty * TILE, '50');
      SFX.brick();
    } else {
      BLOCKS.set(idx, 0.25);
      SFX.bump();
    }
  } else if (c === T_QCOIN) {
    tiles[idx] = T_USED;
    BLOCKS.set(idx, 0.25);
    coins.push(makeCoinPop(tx * TILE + 3, ty * TILE - 2));
    G.coins++; G.score += 200;
    if (G.coins % 100 === 0) { G.lives++; SFX.oneup(); addScorePopup(tx * TILE, ty * TILE - 10, '1UP'); }
    SFX.coin();
  } else if (c === T_QMUSH) {
    tiles[idx] = T_USED;
    BLOCKS.set(idx, 0.25);
    spawnItem(tx, ty, 'mush');
    SFX.sprout();
  } else if (c === T_QFLOWER) {
    tiles[idx] = T_USED;
    BLOCKS.set(idx, 0.25);
    spawnItem(tx, ty, P.power > 0 ? 'flower' : 'mush');
    SFX.sprout();
  } else if (c === T_USED) {
    BLOCKS.set(idx, 0.25);
    SFX.bump();
  }
}

/* ---------------- 玩家更新 ---------------- */
function applyHitbox() {
  let h;
  if (P.growT > 0) h = P.growT > 0.5 ? 14 : 28;
  else if (P.shrinkT > 0) h = P.shrinkT > 0.5 ? 28 : 14;
  else h = P.power > 0 ? 28 : 14;
  /* 头顶有实心时暂不放大 */
  if (h > P.h) {
    const tx0 = Math.floor(P.x / TILE), tx1 = Math.floor((P.x + P.w - 1) / TILE);
    const ty = Math.floor((P.y + P.h - h) / TILE);
    let blocked = false;
    for (let tx = tx0; tx <= tx1 && !blocked; tx++) {
      if (isSolid(tileAt(tx, ty))) blocked = true;
    }
    if (blocked) h = P.h;
  }
  P.h = h;
}
function updatePlayer() {
  if (P.dead) {
    P.vy += 0.35;
    P.y += P.vy;
    G.deathT++;
    return;
  }
  if (P.inv > 0) P.inv--;
  if (P.growT > 0) P.growT -= STEP;
  if (P.shrinkT > 0) P.shrinkT -= STEP;
  if (P.cool > 0) P.cool--;
  if (P.dropT > 0) P.dropT--;
  applyHitbox();

  const left = isDown(LEFT_CODES), right = isDown(RIGHT_CODES);
  const run = isDown(RUN_CODES);
  const max = run ? P_MAX_RUN : P_MAX_WALK;
  const acc = P.onGround ? P_ACC : P_AIR_ACC;
  if (left && !right) { P.vx -= acc; P.face = -1; }
  else if (right && !left) { P.vx += acc; P.face = 1; }
  else {
    const fr = P.onGround ? P_FRIC : P_AIR_FRIC;
    if (P.vx > 0) P.vx = Math.max(0, P.vx - fr);
    else if (P.vx < 0) P.vx = Math.min(0, P.vx + fr);
  }
  P.vx = clamp(P.vx, -max, max);

  /* 跳跃：土狼时间 + 输入缓冲 */
  if (G.jumpBuf > 0 && (P.onGround || P.coyote > 0)) {
    P.vy = -JUMP_V;
    P.onGround = false;
    P.coyote = 0;
    G.jumpBuf = 0;
    SFX.jump();
    if (P.dropT > 0) P.dropT = 0;
  }
  G.jumpBuf = Math.max(0, G.jumpBuf - 1);
  if (P.coyote > 0) P.coyote--;

  const jumpHeld = isDown(JUMP_CODES);
  if (!jumpHeld && P.vy < -JUMP_CUT) P.vy = -JUMP_CUT;
  P.vy = Math.min(P.vy + GRAV, MAXFALL);

  const dropThrough = P.dropT > 0;
  const rx = moveAndCollide(P, P.vx, 0, { player: true });
  if (rx.wall) P.vx = 0;
  const prevOnGround = P.onGround;
  const prevBottomY = P.y + P.h;   /* 用于踩怪判定：上一帧脚底位置 */
  const vyBeforeMove = P.vy;       /* 落地前一刻的垂直速度 */
  const ry = moveAndCollide(P, 0, P.vy, { player: true, dropThrough });
  let justLanded = false;
  if (ry.ground && P.vy > 0) {
    if (!prevOnGround) G.chain = 0;
    P.onGround = true;
    justLanded = true;
    P.vy = 0;
  } else if (P.vy > 0) {
    P.onGround = false;
  }
  if (ry.head.length) {
    for (const [tx, ty] of ry.head) bumpTile(tx, ty);
  }

  /* 发射火球（火花之力） */
  if (P.power === 2 && isDown(SHOOT_CODES) && P.cool <= 0 && fireballs.length < 2) {
    fireballs.push({
      x: P.x + (P.face > 0 ? P.w : -7), y: P.y + (P.h > 20 ? 8 : 4),
      vx: P.face * 2.4, vy: 0.3, w: 7, h: 7, life: 130,
    });
    P.cool = 20;
    SFX.fire();
  }

  /* 敌人互动 */
  for (const e of enemies) {
    if (!e.awake || e.state === 'flip' || e.state === 'dead') continue;
    if (!rectHit(P, e)) continue;
    const feet = P.y + P.h;
    const falling = P.vy > 0.1 || justLanded;
    /* 踩怪：正在下落（或刚落地），且上一帧脚底在敌人头顶附近；
       或下落速度足够快（vy≥3）时擦到敌人也视为踩踏 */
    const stomp = falling && (prevBottomY <= e.y + e.h * 0.8 || vyBeforeMove >= 3);
    if (stomp) {
      doStomp(e);
    } else if (e.state === 'shell') {
      /* 侧面踢壳 */
      const dir = (e.x + e.w / 2) <= (P.x + P.w / 2) ? 1 : -1;
      e.state = 'moving';
      e.vx = dir * SHELL_V;
      e.shellT = 0;
      G.score += 400;
      addScorePopup(e.x, e.y - 8, '400');
      SFX.kick();
      P.inv = Math.max(P.inv, 30);
    } else if (e.state === 'moving') {
      hurtPlayer();
    } else if (P.inv <= 0) {
      hurtPlayer();
    }
  }

  /* 道具收集 */
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (!it.active || !rectHit(P, it)) continue;
    items.splice(i, 1);
    G.score += 1000;
    addScorePopup(it.x, it.y - 8, '1000');
    if (it.kind === 'mush') {
      if (P.power === 0) { P.power = 1; P.growT = 1; }
      SFX.powerup();
    } else {
      P.power = 2; P.growT = Math.max(P.growT, 0.4);
      SFX.powerup();
    }
  }
  /* 金币收集 */
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (c.type === 'coinpop') continue;
    if (!rectHit(P, c)) continue;
    coins.splice(i, 1);
    G.coins++; G.score += 200;
    addSparkle(c.x, c.y);
    if (G.coins % 100 === 0) { G.lives++; SFX.oneup(); addScorePopup(c.x, c.y - 8, '1UP'); }
    SFX.coin();
  }
  P.animT += Math.abs(P.vx) * 0.9;
}

function doStomp(e) {
  const hold = isDown(JUMP_CODES);
  P.vy = hold ? -STOMP_BOUNCE_HOLD : -STOMP_BOUNCE;
  P.onGround = false;
  if (e.type === 'goomba') {
    e.state = 'dead';
    e.deadT = 0.5;
    e.y += 5; e.h = 8;
    G.chain = Math.min(G.chain + 1, 3);
    const sc = 100 * Math.pow(2, G.chain - 1);
    G.score += sc;
    addScorePopup(e.x, e.y - 6, String(sc));
  } else if (e.type === 'koopa') {
    if (e.state === 'moving') {
      e.state = 'shell';
      e.vx = 0;
      e.shellT = 8;
      G.score += 100;
      addScorePopup(e.x, e.y - 8, '100');
    } else {
      e.state = 'shell';
      e.vx = 0;
      e.shellT = 8;
      G.score += 100;
      addScorePopup(e.x, e.y - 8, '100');
    }
  }
  SFX.stomp();
  addPuff(e.x + e.w / 2, e.y);
}

function hurtPlayer() {
  if (P.inv > 0) return;
  if (P.power > 0) {
    P.power = P.power === 2 ? 1 : 0;
    P.shrinkT = 1;
    P.inv = 130;
    SFX.powerdown();
  } else {
    die('hurt');
  }
}
function die(reason) {
  if (G.state !== 'play') return;
  G.state = 'dying';
  updateStartPrompt();
  G.deathT = 0;
  P.dead = true;
  P.vy = -6.5;
  P.vx = 0;
  window.__deathInfo = { x: P.x, y: P.y, time: G.time, reason: reason || '?', frame: G.ftime };
  SFX.die();
}

/* ---------------- 敌人更新 ---------------- */
function updateEnemy(e) {
  if (!e.awake) {
    if (Math.abs(e.x - (G.camX + VIEW_W / 2)) < 280) e.awake = true;
    else return;
  }
  if (e.state === 'dead') {
    e.deadT -= STEP;
    if (e.deadT <= 0) e.remove = true;
    return;
  }
  if (e.state === 'flip') {
    e.vy += GRAV;
    e.y += e.vy;
    if (e.y > H * TILE + 40) e.remove = true;
    return;
  }
  if (e.state === 'shell') {
    e.shellT -= STEP;
    if (e.shellT <= 0) { e.state = 'walk'; e.vx = e.type === 'goomba' ? -GOOMBA_V : -KOOPA_V; }
  }
  e.animT += 0.1;
  e.vy = Math.min(e.vy + GRAV, MAXFALL);
  const rx = moveAndCollide(e, e.vx, 0, { bounce: e.state === 'moving' });
  if (rx.wall && e.state !== 'moving') { e.vx = -e.vx; }
  const ry = moveAndCollide(e, 0, e.vy, {});
  if (ry.ground) { e.onGround = true; e.vy = 0; } else { e.onGround = false; }
  enemySolidityCheck(e);
  if (e.y > H * TILE + 40) e.remove = true;

  /* 移动的龟壳撞飞其它敌人 */
  if (e.state === 'moving') {
    for (const o of enemies) {
      if (o === e || o.state === 'flip' || o.state === 'dead' || !o.awake) continue;
      if (rectHit(e, o)) {
        o.state = 'flip'; o.vy = -3.4;
        G.score += 500;
        addScorePopup(o.x, o.y - 8, '500');
        SFX.kick();
      }
    }
  }
}
function flipEnemy(e, score) {
  e.state = 'flip';
  e.vy = -3.4;
  G.score += score;
  addScorePopup(e.x, e.y - 8, String(score));
  SFX.stomp();
}

/* ---------------- 道具 / 金币 / 火球更新 ---------------- */
function updateItem(it) {
  if (it.riseT > 0) {
    it.riseT -= 1;
    it.y -= 1;
    return;
  }
  it.active = true;
  if (it.kind === 'flower') {
    it.animT = (it.animT || 0) + 0.1;
    return;
  }
  it.vy = Math.min(it.vy + GRAV, MAXFALL);
  const rx = moveAndCollide(it, it.vx, 0, {});
  if (rx.wall) it.vx = -it.vx;
  const ry = moveAndCollide(it, 0, it.vy, {});
  if (ry.ground) it.vy = 0;
  if (it.y > H * TILE + 40) it.remove = true;
}
function updateCoin(c) {
  if (c.type === 'coinpop') {
    c.vy += 0.18;
    c.y += c.vy;
    c.life--;
    if (c.life <= 0) c.remove = true;
  }
}
function updateFireball(f) {
  f.life--;
  f.vy = Math.min(f.vy + 0.16, 3);
  const rx = moveAndCollide(f, f.vx, 0, {});
  if (rx.wall) { f.dead = true; }
  const ry = moveAndCollide(f, 0, f.vy, { bounceDown: -2.6 });
  if (f.life <= 0) f.dead = true;
  if (f.dead) {
    for (let i = 0; i < 5; i++) {
      particles.push({ x: f.x + 3, y: f.y + 3, vx: (Math.random() - 0.5) * 1.6, vy: -Math.random() * 1.2,
                       g: 0.05, life: 16, color: i % 2 ? '#ff7010' : '#ffd040', size: 3 });
    }
    f.remove = true;
    return;
  }
  for (const e of enemies) {
    if (!e.awake || e.state === 'flip' || e.state === 'dead') continue;
    if (rectHit(f, e)) {
      flipEnemy(e, 200);
      f.dead = true;
      break;
    }
  }
}

/* ---------------- 旗杆与过关 ---------------- */
function startFlag() {
  G.state = 'clear';
  G.clearPhase = 'slide';
  P.x = flagX - P.w - 2;
  P.vy = 0; P.vx = 0;
  G.chain = 0;
  SFX.flag();
}
function updateClear() {
  if (G.clearPhase === 'slide') {
    P.y += 1.4;
    P.animT += 0.5;
    if (P.y + P.h >= flagGroundY - 0.5) {
      P.y = flagGroundY - P.h;
      G.clearPhase = 'walk';
      SFX.flag();
    }
  } else if (G.clearPhase === 'walk') {
    P.face = 1;
    P.x += 1.1;
    P.animT += 0.5;
    if (P.x + P.w >= castleDoorX) {
      G.clearPhase = 'bonus';
      G.bonusT = 0;
      SFX.courseClear();
    }
  } else if (G.clearPhase === 'bonus') {
    G.bonusT++;
    if (G.bonusT % 2 === 0 && G.time > 0) {
      G.time--;
      G.score += 50;
      SFX.tick();
    }
    if (G.time <= 0) nextLevel();
  }
}

/* ---------------- 世界更新 ---------------- */
function updateWorld() {
  /* 倒计时 */
  if (G.state === 'play' || G.state === 'clear') {
    if (G.state === 'play') {
      G.timerF += STEP;
      if (G.timerF >= 0.35) {
        G.timerF -= 0.35;
        G.time--;
        if (G.time <= 0) die('timer');
      }
    }
  }

  if (G.state === 'dying') {
    updatePlayer();
    if (P.y > H * TILE + 48) {
      G.lives--;
      if (G.lives > 0) startLevel(G.level);
      else {
  G.state = 'gameover';
  updateStartPrompt();
        G.best = Math.max(G.best, G.score);
        try { if (window.localStorage) window.localStorage.setItem('sp_best', String(G.best)); } catch (e) {}
        SFX.gameover();
      }
    }
    updateParticles();
    return;
  }
  if (G.state === 'clear') {
    updateClear();
    updateParticles();
    return;
  }
  if (G.state !== 'play') return;

  updatePlayer();
  if (G.state !== 'play') return;   /* 玩家可能已死亡/触旗 */

  for (const e of enemies) {
    updateEnemy(e);
    if (e.state === 'flip' || e.state === 'dead') continue;
  }
  enemies = enemies.filter((e) => !e.remove);
  for (const it of items) updateItem(it);
  items = items.filter((it) => !it.remove);
  for (const c of coins) updateCoin(c);
  coins = coins.filter((c) => !c.remove);
  for (const f of fireballs) updateFireball(f);
  fireballs = fireballs.filter((f) => !f.remove);
  updateParticles();

  /* 顶动动画计时 */
  for (const [k, v] of BLOCKS) {
    const nv = v - STEP;
    if (nv <= 0) BLOCKS.delete(k); else BLOCKS.set(k, nv);
  }

  /* 掉坑死亡 */
  if (P.y > H * TILE + 40) { die('pit'); return; }

  /* 触旗 */
  if (P.x + P.w >= flagX - 1) startFlag();

  /* 相机 */
  G.camX = clamp(P.x + P.w / 2 - VIEW_W / 2, 0, W * TILE - VIEW_W);
  const ty2 = clamp(P.y + P.h / 2 - VIEW_H / 2, 0, H * TILE - VIEW_H);
  G.camY += (ty2 - G.camY) * 0.2;
}
function updateParticles() {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life--;
  }
  particles = particles.filter((p) => p.life > 0);
  for (const f of floats) { f.y -= 0.5; f.t--; }
  floats = floats.filter((f) => f.t > 0);
}

/* ---------------- 渲染 ---------------- */
let cv, ctx, mainCv, mainCtx;
function initCanvas() {
  cv = document.createElement('canvas');
  cv.width = VIEW_W; cv.height = VIEW_H;
  ctx = cv.getContext('2d');
  mainCv = document.getElementById('game');
  mainCv.width = VIEW_W * SCALE; mainCv.height = VIEW_H * SCALE;
  mainCtx = mainCv.getContext('2d');
  mainCtx.imageSmoothingEnabled = false;
  const prompt = document.getElementById('startPrompt');
  if (prompt) prompt.addEventListener('click', handleStartPointer);
}
function hashN(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function drawBackground() {
  const gr = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  gr.addColorStop(0, '#6fb8f0');
  gr.addColorStop(1, '#b8dcf8');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  /* 云 */
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 12; i++) {
    const h1 = hashN(i * 3 + 1), h2 = hashN(i * 3 + 2);
    let x = i * 420 + h1 * 300 - G.camX * 0.4;
    const span = 3000;
    x = ((x % span) + span) % span - 600;
    const y = 24 + h2 * 60;
    ctx.fillRect(x, y, 30, 10);
    ctx.fillRect(x + 6, y - 6, 18, 16);
    ctx.fillRect(x - 6, y + 3, 12, 7);
  }
  /* 远山 */
  ctx.fillStyle = '#4fae5c';
  for (let i = 0; i < 8; i++) {
    const h1 = hashN(i * 7 + 5);
    let x = i * 260 + h1 * 160 - G.camX * 0.6;
    x = ((x % 2400) + 2400) % 2400 - 500;
    ctx.beginPath();
    ctx.ellipse(x, VIEW_H - 30, 90 + h1 * 40, 46 + h1 * 30, 0, Math.PI, 0);
    ctx.fill();
  }
}
function drawWorld() {
  ctx.save();
  ctx.translate(-Math.round(G.camX), -Math.round(G.camY));
  const tx0 = Math.max(0, Math.floor(G.camX / TILE));
  const tx1 = Math.min(W - 1, Math.ceil((G.camX + VIEW_W) / TILE));
  const ty0 = Math.max(0, Math.floor(G.camY / TILE));
  const ty1 = Math.min(H - 1, Math.ceil((G.camY + VIEW_H) / TILE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const c = tiles[ty * W + tx];
      if (c === T_EMPTY) continue;
      const idx = ty * W + tx;
      let oy = 0;
      if (BLOCKS.has(idx)) {
        const t = BLOCKS.get(idx);
        oy = -Math.round(Math.sin((0.25 - t) / 0.25 * Math.PI) * 5);
      }
      const spr = TILESP[c];
      if (!spr) continue;
      if (Array.isArray(spr)) ctx.drawImage(spr[Math.floor(G.ftime / 14) % 3], tx * TILE, ty * TILE + oy);
      else ctx.drawImage(spr, tx * TILE, ty * TILE + oy);
      if (c === T_GROUND && hashN(tx * 31 + ty * 17) > 0.75 && tileAt(tx, ty - 1) === T_EMPTY) {
        ctx.fillStyle = '#3fae4c';
        ctx.fillRect(tx * TILE + 4, ty * TILE - 2, 2, 2);
        ctx.fillRect(tx * TILE + 9, ty * TILE - 3, 2, 3);
      }
    }
  }
  drawCastleWorld();
  drawFlagWorld();
  /* 实体 */
  for (const it of items) drawItem(it);
  for (const c of coins) drawCoinEntity(c);
  for (const e of enemies) drawEnemy(e);
  for (const f of fireballs) {
    const spr = SPR.fire[Math.floor(G.ftime / 6) % 2];
    ctx.drawImage(spr, Math.round(f.x - 1), Math.round(f.y - 1));
  }
  drawPlayer();
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / 20, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    ctx.globalAlpha = 1;
  }
  for (const f of floats) {
    drawTextCenter(ctx, f.text, f.x, f.y, 1, '#ffffff');
  }
  ctx.restore();
}
function drawCastleWorld() {
  if (castleCol < 0) return;
  const x = castleCol * TILE - TILE, gy = H * TILE;
  const y = gy - 5 * TILE;
  ctx.fillStyle = '#b8b8c0';
  ctx.fillRect(x, y, 5 * TILE, 5 * TILE);
  /* 城齿 */
  for (let i = 0; i < 5; i++) ctx.fillRect(x + i * TILE, y - 6, 8, 6);
  /* 砖缝 */
  ctx.fillStyle = '#7a7a84';
  for (let r = 1; r < 5; r++) ctx.fillRect(x, y + r * TILE - 1, 5 * TILE, 1);
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 5; r++) {
      ctx.fillRect(x + c * TILE + (r % 2) * 8, y + r * TILE + 4, 1, 10);
    }
  }
  /* 窗户 */
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x + 10, y + 16, 8, 12);
  ctx.fillRect(x + 62, y + 16, 8, 12);
  /* 门 */
  ctx.fillRect(x + 32, y + 48, 16, 32);
  ctx.fillStyle = '#b8b8c0';
  ctx.beginPath();
  ctx.arc(x + 40, y + 48, 8, Math.PI, 0);
  ctx.fill();
  /* 塔楼与旗帜 */
  ctx.fillStyle = '#9a9aa4';
  ctx.fillRect(x + 22, y - 18, 36, 18);
  ctx.fillStyle = '#7a7a84';
  ctx.fillRect(x + 22, y - 18, 36, 1);
  ctx.fillStyle = '#d8d8e0';
  ctx.fillRect(x + 39, y - 30, 2, 12);
  ctx.fillStyle = '#e23c30';
  ctx.beginPath();
  ctx.moveTo(x + 41, y - 30);
  ctx.lineTo(x + 53, y - 26);
  ctx.lineTo(x + 41, y - 22);
  ctx.fill();
}
function drawFlagWorld() {
  if (flagX < 0) return;
  const x = flagX;
  ctx.fillStyle = '#d8d8e0';
  ctx.fillRect(x - 1, flagTopY, 3, flagGroundY - flagTopY);
  ctx.fillStyle = '#f0f0f0';
  ctx.beginPath();
  ctx.arc(x + 1, flagTopY - 3, 3, 0, Math.PI * 2);
  ctx.fill();
  const wave = Math.floor(G.ftime / 10) % 2;
  ctx.fillStyle = '#2fae3c';
  ctx.beginPath();
  ctx.moveTo(x - 1, flagTopY + 2);
  ctx.lineTo(x - 15 - wave * 2, flagTopY + 9);
  ctx.lineTo(x - 1, flagTopY + 16);
  ctx.fill();
  ctx.fillStyle = '#f8f8f0';
  ctx.beginPath();
  ctx.arc(x - 8 - wave, flagTopY + 9, 2, 0, Math.PI * 2);
  ctx.fill();
}
function drawEnemy(e) {
  if (e.state === 'dead') {
    if (e.type === 'goomba') ctx.drawImage(SPR.goombaSquash, Math.round(e.x - 1), Math.round(e.y));
    return;
  }
  if (e.state === 'flip') {
    const spr = e.type === 'goomba' ? SPR.goomba[0] : SPR.koopa[0];
    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    ctx.scale(1, -1);
    ctx.drawImage(spr, -8, -8);
    ctx.restore();
    return;
  }
  const fr = Math.floor(e.animT) % 2;
  if (e.type === 'goomba') {
    ctx.drawImage(SPR.goomba[fr], Math.round(e.x - 1), Math.round(e.y + e.h - 16));
  } else if (e.type === 'koopa') {
    if (e.state === 'walk') ctx.drawImage(SPR.koopa[fr], Math.round(e.x - 1), Math.round(e.y + e.h - 16));
    else ctx.drawImage(SPR.shell, Math.round(e.x - 1), Math.round(e.y));
  }
}
function drawItem(it) {
  const spr = it.kind === 'mush' ? SPR.mush : SPR.flower;
  ctx.drawImage(spr, Math.round(it.x - 1), Math.round(it.y - 2));
}
function drawCoinEntity(c) {
  const spr = SPR.coin[Math.floor(G.ftime / 8) % 4];
  ctx.drawImage(spr, Math.round(c.x - 1), Math.round(c.y));
}
function drawPlayer() {
  if (P.dead && G.state === 'dying') {
    const set = SPR.heroSmall[0];
    ctx.save();
    ctx.translate(P.x + 6, P.y + 8);
    ctx.scale(P.face, -1);
    ctx.drawImage(set[3], -8, -8);
    ctx.restore();
    return;
  }
  /* 变大变小的交替动画 */
  let showBig = P.power > 0;
  if (P.growT > 0) showBig = Math.floor(P.growT * 8) % 2 === 0;
  if (P.shrinkT > 0) showBig = Math.floor(P.shrinkT * 8) % 2 === 0;
  const pal = P.power === 2 ? 1 : 0;
  let frame;
  if (!P.onGround) frame = 3;
  else if (Math.abs(P.vx) < 0.06) frame = 0;
  else frame = Math.floor(P.animT / 5) % 2 === 0 ? 1 : 2;
  const set = showBig ? SPR.heroBig[pal] : SPR.heroSmall[pal];
  const spr = set[frame];
  const boxW = 16, boxH = showBig ? 32 : 16;
  const sx = Math.round(P.x + P.w / 2 - boxW / 2);
  const sy = Math.round(P.y + P.h - boxH);
  if (P.inv > 0 && Math.floor(G.ftime / 4) % 2 === 0 && G.state === 'play') return; /* 闪烁 */
  ctx.save();
  ctx.translate(sx + (P.face > 0 ? 0 : boxW), sy);
  ctx.scale(P.face > 0 ? 1 : -1, 1);
  ctx.drawImage(spr, 0, 0);
  ctx.restore();
}

/* ---------------- HUD ---------------- */
function drawHUD() {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, VIEW_W, 22);
  drawText(ctx, 'SCORE', 4, 4, 1, '#ffffff');
  drawText(ctx, String(G.score).padStart(6, '0'), 4, 13, 1, '#ffffff');
  const cw = 44 + 9;
  drawText(ctx, 'COINS', cw, 4, 1, '#ffffff');
  ctx.drawImage(SPR.coin[0], cw, 12, 7, 8);
  drawText(ctx, 'x' + String(G.coins).padStart(2, '0'), cw + 10, 13, 1, '#ffffff');
  drawText(ctx, 'WORLD', 128, 4, 1, '#ffffff');
  drawText(ctx, '1-' + (G.level + 1), 136, 13, 1, '#ffffff');
  drawText(ctx, 'TIME', 196, 4, 1, '#ffffff');
  drawText(ctx, String(Math.max(0, G.time)).padStart(3, '0'), 196, 13, 1, '#ffffff');
  drawText(ctx, 'LIVES', 254, 4, 1, '#ffffff');
  ctx.drawImage(SPR.heroSmall[0][0], 254, 11, 8, 8);
  drawText(ctx, 'x' + Math.max(0, G.lives), 266, 13, 1, '#ffffff');
}

/* ---------------- 标题 / 结束画面 ---------------- */
function drawTitle() {
  drawBackground();
  ctx.fillStyle = '#3fae4c';
  ctx.fillRect(0, VIEW_H - 32, VIEW_W, 32);
  for (let i = 0; i < 20; i++) ctx.drawImage(TILESP[T_GROUND], i * TILE, VIEW_H - 16);
  /* 装饰 */
  ctx.drawImage(TILESP[T_PIPE_TL], 60, VIEW_H - 48);
  ctx.drawImage(TILESP[T_PIPE_TR], 76, VIEW_H - 48);
  ctx.drawImage(TILESP[T_PIPE_BL], 60, VIEW_H - 32);
  ctx.drawImage(TILESP[T_PIPE_BR], 76, VIEW_H - 32);
  ctx.drawImage(TILESP[T_QCOIN][Math.floor(G.ftime / 14) % 3], 180, VIEW_H - 64);
  const p = (G.ftime * 0.35) % 240;
  const gx = p < 120 ? 120 + p : 360 - p;
  const dir = p < 120 ? 1 : -1;
  ctx.save();
  ctx.translate(dir > 0 ? gx + 16 : gx, VIEW_H - 16);
  ctx.scale(dir, 1);
  ctx.drawImage(SPR.goomba[Math.floor(G.ftime / 8) % 2], 0, -16);
  ctx.restore();
  ctx.drawImage(SPR.heroSmall[0][0], 220, VIEW_H - 16 - 16 + 2);

  /* 标题 */
  ctx.font = 'bold 34px "Microsoft YaHei", "SimHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7a1a10';
  ctx.fillText('超级水管工', VIEW_W / 2 + 2, 56 + 2);
  ctx.fillStyle = '#e23c30';
  ctx.fillText('超级水管工', VIEW_W / 2, 56);
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('- SUPER PLUMBER -', VIEW_W / 2, 74);

  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#203040';
  ctx.fillText('← → / A D 移动        空格 / Z / K / ↑ 跳跃', VIEW_W / 2, 98);
  ctx.fillText('长按跳跃键跳得更高    Shift / X 加速跑', VIEW_W / 2, 114);
  ctx.fillText('F / L 发射火球（需要火花）    ↓+跳 穿过木桥', VIEW_W / 2, 130);
  ctx.fillText('P 暂停 · M 静音', VIEW_W / 2, 146);

  if (Math.floor(G.ftime / 30) % 2 === 0) {
    ctx.font = 'bold 17px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#ffd800';
    ctx.fillText('按 回车键 开始游戏', VIEW_W / 2, 172);
  }
  ctx.font = '10px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#5a6a7a';
  ctx.fillText('原创同人练习作品 · 代码与像素素材全部手写 · 3 关等你挑战', VIEW_W / 2, VIEW_H - 6);
  if (G.best > 0) {
    drawTextCenter(ctx, 'BEST ' + String(G.best).padStart(6, '0'), VIEW_W / 2, 84, 1, '#ffd800');
  }
  ctx.textAlign = 'left';
}
function drawGameOver() {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawTextCenter(ctx, 'GAME OVER', VIEW_W / 2, 70, 3, '#e23c30');
  drawTextCenter(ctx, 'SCORE ' + String(G.score).padStart(6, '0'), VIEW_W / 2, 104, 1, '#ffffff');
  ctx.font = '15px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd800';
  if (Math.floor(G.ftime / 30) % 2 === 0) ctx.fillText('按 回车键 返回标题', VIEW_W / 2, 140);
  ctx.textAlign = 'left';
}
function drawWin() {
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.font = 'bold 30px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd800';
  ctx.fillText('恭喜通关！', VIEW_W / 2, 66);
  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('FINAL SCORE  ' + String(G.score).padStart(6, '0'), VIEW_W / 2, 96);
  ctx.fillStyle = '#7ec8f0';
  ctx.fillText('你拯救了蘑菇王国！', VIEW_W / 2, 120);
  ctx.font = '15px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#ffd800';
  if (Math.floor(G.ftime / 30) % 2 === 0) ctx.fillText('按 回车键 返回标题', VIEW_W / 2, 152);
  ctx.textAlign = 'left';
}
function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.font = 'bold 26px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('暂停中', VIEW_W / 2, 86);
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.fillText('按 P 或 回车 继续游戏', VIEW_W / 2, 112);
  ctx.textAlign = 'left';
}

/* ---------------- 主循环 ---------------- */
function render() {
  if (G.state === 'title') { drawTitle(); }
  else if (G.state === 'gameover') { drawGameOver(); }
  else if (G.state === 'win') { drawWin(); }
  else {
    drawBackground();
    drawWorld();
    drawHUD();
    if (G.state === 'pause') drawPause();
  }
  mainCtx.clearRect(0, 0, mainCv.width, mainCv.height);
  mainCtx.drawImage(cv, 0, 0, mainCv.width, mainCv.height);
}
let lastT = 0, acc = 0;
function frame(t) {
  const dt = clamp((t - lastT) / 1000, 0, 0.1);
  lastT = t;
  G.ftime++;
  if (G.state === 'play' || G.state === 'dying' || G.state === 'clear') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      updateWorld();
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
  }
  render();
  requestAnimationFrame(frame);
}

/* ---------------- 启动 ---------------- */
function boot() {
  buildSprites();
  buildTiles();
  initCanvas();
  try {
    const b = window.localStorage && window.localStorage.getItem('sp_best');
    if (b) G.best = parseInt(b, 10) || 0;
  } catch (e) {}
  lastT = performance.now();
  updateStartPrompt();
  requestAnimationFrame(frame);
  /* 供测试与调试 */
  window.__GAME = {
    getState: () => G.state, getP: () => P, getScore: () => G.score,
    getLevel: () => G.level, getLives: () => G.lives, getTime: () => G.time,
    getEnemies: () => enemies.length, getCoins: () => coins.length,
    getFrame: () => G.ftime, getCamX: () => G.camX,
    solidAt: (x, y) => isSolid(tileAt(Math.floor(x / TILE), Math.floor(y / TILE))),
    groundAt: (x, y) => {
      const c = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
      return isSolid(c) || c === T_PLAT;
    },
    platformAt: (x, y) => tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) === T_PLAT,
    enemiesList: () => enemies, getTiles: () => tiles, getW: () => W, getH: () => H,
  };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
