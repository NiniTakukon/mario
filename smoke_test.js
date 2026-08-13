/* 无头冒烟测试：桩掉 DOM/Canvas/音频，加载 mario.js，
   校验关卡完整性，并驱动一个简易自动玩家连闯三关。 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const listeners = {};
function makeCtx() {
  const t = { canvas: { width: 0, height: 0 } };
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return () => ({ width: 12 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'createPattern') return () => null;
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeCtx(), addEventListener() {} };
}
class FakeAC {
  constructor() { this.currentTime = 0; this.destination = {}; this.sampleRate = 44100; }
  createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  createBuffer(n, l) { return { getChannelData() { return new Float32Array(l); } }; }
  createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
  resume() { return Promise.resolve(); }
}
let rafCb = null;
let vtime = 0;
function frames(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafCb; rafCb = null;
    vtime += 16.67;
    if (cb) cb(vtime);
  }
}
const sandbox = {
  console,
  Math, JSON, Date, Object, Array, String, Number, Boolean, Uint8Array, Uint8ClampedArray,
  Float32Array, Map, Set, Promise, parseInt, isNaN, setInterval, clearInterval, setTimeout, clearTimeout,
  performance: { now: () => vtime },
  frames,
  listeners,
  document: {
    readyState: 'complete',
    getElementById: () => makeCanvas(),
    createElement: () => makeCanvas(),
    addEventListener() {},
  },
  window: null,
  requestAnimationFrame: (cb) => { rafCb = cb; },
  AudioContext: FakeAC,
  webkitAudioContext: FakeAC,
  localStorage: undefined,
};
sandbox.window = {
  addEventListener: (t, h) => { (listeners[t] = listeners[t] || []).push(h); },
  AudioContext: FakeAC, webkitAudioContext: FakeAC,
  requestAnimationFrame: sandbox.requestAnimationFrame,
  devicePixelRatio: 1, localStorage: undefined,
};

const gameCode = fs.readFileSync(__dirname + '/mario.js', 'utf8');
const testCode = `
;(function(){
  const NL = String.fromCharCode(10);
  const OUT = [];
  window.__RESULTS = OUT;
  const ok = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); OUT.push('ok: ' + msg); };
  const GAME = window.__GAME;

  /* A. 关卡完整性 */
  for (let li = 0; li < LEVELS.length; li++) {
    const def = LEVELS[li];
    ok(def.rows.length === 15, 'L' + (li + 1) + ' 行数=15');
    for (let r = 0; r < def.rows.length; r++) {
      const row = def.rows[r];
      ok(row.length === def.w, 'L' + (li + 1) + ' 第' + r + '行宽=' + row.length);
    }
    const all = def.rows.join('');
    const cnt = (c) => all.split(c).length - 1;
    ok(cnt('S') === 1, 'L' + (li + 1) + ' 出生点=1');
    ok(cnt('F') === 1, 'L' + (li + 1) + ' 旗杆=1');
    ok(cnt('K') >= 1, 'L' + (li + 1) + ' 城堡>=1');
    ok(cnt('o') >= 3, 'L' + (li + 1) + ' 金币=' + cnt('o'));
    ok(cnt('g') + cnt('k') >= 4, 'L' + (li + 1) + ' 敌人=' + (cnt('g') + cnt('k')));
    /* 管道结构校验：管道必须左右成对、自上而下连续、底部落在 r13 */
    for (let c = 0; c < def.w; c++) {
      for (let r = 0; r < def.rows.length; r++) {
        const ch = def.rows[r][c];
        if (ch === '[' || ch === '{') {
          const right = def.rows[r][c + 1];
          ok((ch === '[' && right === ']') || (ch === '{' && right === '}'),
            'L' + (li + 1) + ' 管道成对 col' + c + ' r' + r);
          if (ch === '[') {
            for (let r2 = r + 1; r2 <= 13; r2++) {
              ok(def.rows[r2][c] === '{', 'L' + (li + 1) + ' 管道连续 col' + c + ' r' + r2);
            }
          }
        }
      }
    }
  }
  OUT.push('LEVELS OK');

  /* B. 启动与输入 */
  ok(GAME.getState() === 'title', '初始为标题画面');
  const fire = (type, code, down) => {
    (listeners[type] || []).forEach((h) => h({ code, repeat: !down, preventDefault() {} }));
  };
  fire('keydown', 'Enter', true);
  frames(2);
  ok(GAME.getState() === 'play', '回车后进入游戏');
  ok(GAME.getLevel() === 0, '第 1 关');
  const p0 = GAME.getP();
  const x0 = p0.x;
  fire('keydown', 'ArrowRight', true);
  frames(90);
  ok(GAME.getP().x > x0 + 40, '按住右移：x ' + x0.toFixed(0) + ' -> ' + GAME.getP().x.toFixed(0));
  fire('keyup', 'ArrowRight', true);

  /* C. 自动玩家连闯三关 */
  const state = { holdJump: 0, deaths: 0, lastDeathAt: -1, maxX: -1, stuck: 0, frame: 0, levelFrames: 0, prevX: -1, wasPlay: true };
  function autoplay(framesCount, capFrames) {
    const startLevelIdx = GAME.getLevel();
    for (let i = 0; i < framesCount; i++) {
      state.frame++; state.levelFrames++;
      const st = GAME.getState();
      if (st === 'win') return st;
      if (GAME.getLevel() !== startLevelIdx) return 'next';
      if (st === 'gameover') {
        throw new Error('FAIL: GAME OVER L' + (GAME.getLevel() + 1) + ' 得分=' + GAME.getScore() +
          NL + (state.bwd || []).join(NL) + NL + 'TRACE:' + NL + (state.tr || []).join(NL));
      }
      if (st === 'dying') {
        if (state.wasPlay) {
          state.deaths++; state.wasPlay = false;
          state.maxX = -1; state.stuck = 0;
          state.bwd = (state.bwd || []);
          const di = window.__deathInfo || {};
          const near = GAME.enemiesList().filter((e) => Math.abs(e.x - di.x) < 120).map((e) => e.type + '@' + e.x.toFixed(0) + ',' + e.y.toFixed(0) + ':' + e.state + (e.awake ? '' : '(睡)')).join(' ');
          state.bwd.push('DIE f' + state.frame + ' x=' + GAME.getP().x.toFixed(1) + ' L' + (GAME.getLevel() + 1) + ' reason=' + (di.reason || '?') + ' y=' + di.y + ' time=' + di.time + ' 附近[' + near + ']');
        }
        state.holdJump = 0;
        frames(1);
        continue;
      }
      const p = GAME.getP();
      if (st === 'play') state.wasPlay = true;
      if (p.x < state.prevX - 10) {
        state.bwd = (state.bwd || []);
        state.bwd.push('BACK f' + state.frame + ' x ' + state.prevX.toFixed(1) + ' -> ' + p.x.toFixed(1) + ' st=' + st + ' L' + (GAME.getLevel() + 1));
      }
      state.prevX = p.x;
      if (st === 'play' && GAME.getLevel() === 2 && p.x > 460 && p.x < 660) {
        state.tr = (state.tr || []);
        state.tr.push('f' + state.frame + ' x=' + p.x.toFixed(2) + ' y=' + p.y.toFixed(2) + ' vy=' + p.vy.toFixed(2) + ' onG=' + p.onGround + ' hJ=' + state.holdJump);
        if (state.tr.length > 130) state.tr.shift();
      }
      if (st === 'play') {
        const feet = p.y + p.h;
        const aheadX = p.x + p.w + 2;
        const wallAhead = GAME.solidAt(aheadX + 4, feet - 2) || GAME.solidAt(aheadX + 4, feet - 12);
        const tallWall = p.onGround && GAME.solidAt(p.x + 34, feet - 22);
        const pitAhead = p.onGround && !GAME.groundAt(p.x + 6, feet + 4);
        const enemyNear = GAME.enemiesList().some((e) => {
          if (!e.awake || (e.state !== 'walk' && e.state !== 'moving')) return false;
          if (e.x <= p.x - 6 || e.x >= p.x + 44) return false;
          const dyE = (e.y + e.h / 2) - (p.y + p.h / 2);
          return Math.abs(dyE) < 26 || (p.vy > 0 && dyE > 26 && dyE < 90);
        });
        /* 移动的龟壳威胁更大，前后 60px 都要躲 */
        const shellNear = GAME.enemiesList().some((e) =>
          e.awake && e.state === 'moving' && e.x > p.x - 60 && e.x < p.x + 40 &&
          Math.abs((e.y + e.h / 2) - (p.y + p.h / 2)) < 26);
        if (p.x > state.maxX + 2) { state.maxX = p.x; state.stuck = 0; }
        else state.stuck++;
        if (state.stuck > 80 && state.stuck < 101) {
          state.dbg = (state.dbg || []);
          state.dbg.push('f' + state.frame + ' x=' + p.x.toFixed(2) + ' y=' + p.y.toFixed(2) + ' vx=' + p.vx.toFixed(2) + ' vy=' + p.vy.toFixed(2) + ' onG=' + p.onGround);
        }
        if (state.stuck > 150) {
          const dump = [];
          const W = GAME.getW();
          for (let r = 8; r <= 14; r++) {
            let s = 'r' + r + ' ';
            for (let c = Math.floor(p.x / 16) - 6; c <= Math.floor(p.x / 16) + 8; c++) {
              const code = GAME.getTiles()[r * W + c];
              s += code === 0 ? ' ' : '#';
            }
            dump.push(s);
          }
          const es = GAME.enemiesList().map((e) => e.type + '@' + e.x.toFixed(0) + ',' + e.y.toFixed(0) + ':' + e.state).join(' ');
          throw new Error('FAIL: 卡住 x=' + p.x.toFixed(2) + ' y=' + p.y.toFixed(2) + ' vx=' + p.vx.toFixed(2) +
            ' vy=' + p.vy.toFixed(2) + ' onG=' + p.onGround + ' power=' + p.power + ' L' + (GAME.getLevel() + 1) +
            ' 敌人[' + es + ']' + NL + dump.join(NL) + NL + 'DBG:' + NL + (state.dbg || []).join(NL) + NL +
            'BWD:' + NL + (state.bwd || []).join(NL) + NL + 'TR:' + NL + (state.tr || []).join(NL));
        }
        if (wallAhead || tallWall || pitAhead || enemyNear || shellNear || state.stuck > 40) {
          if (state.holdJump <= 0) { fire('keydown', 'Space', true); state.holdJump = 22; }
        }
        if (state.holdJump > 0) {
          state.holdJump--;
          fire('keydown', 'Space', true);   /* 每帧刷新跳跃缓冲，落地立即起跳 */
          if (state.holdJump === 0) fire('keyup', 'Space', true);
        }
        fire('keydown', 'ArrowRight', true);
        fire('keydown', 'ShiftLeft', true);
      }
      if (st === 'clear' || st === 'pause') { /* 自动行走/奖励阶段 */ }
      frames(1);
      if (state.levelFrames > capFrames) throw new Error('FAIL: 超时未过关 L' + (GAME.getLevel() + 1) + ' x=' + GAME.getP().x.toFixed(0));
    }
    return GAME.getState();
  }
  const levelCount = LEVELS.length;
  for (let li = 0; li < levelCount; li++) {
    state.levelFrames = 0; state.maxX = -1; state.stuck = 0; state.deaths = 0;
    state.tr = []; state.traceA = false; state.traceB = false; state.traceC = false;
    const result = autoplay(16000, 9500);
    if (result === 'win') { OUT.push('自动玩家通关全部 3 关！'); break; }
    if (result === 'gameover') throw new Error('GAME OVER L' + (GAME.getLevel() + 1) + '（自动玩家死亡' + state.deaths + '次）');
    const nxt = GAME.getLevel();
    ok(nxt === li + 1, 'L' + (li + 1) + ' 过关 -> L' + (nxt + 1) + '（死亡' + state.deaths + '次，得分' + GAME.getScore() + '）');
  }
  OUT.push('AUTOPLAY OK 最终状态=' + GAME.getState() + ' 得分=' + GAME.getScore());
  window.__RESULTS = OUT;
})();
`;
try {
  vm.runInNewContext(gameCode + '\n' + testCode, sandbox, { filename: 'mario.js' });
  (sandbox.window.__RESULTS || ['no results']).forEach((s) => console.log(s));
  console.log('SMOKE TEST PASSED');
} catch (e) {
  console.error('SMOKE TEST FAILED:', e.message);
  (sandbox.window.__RESULTS || []).forEach((s) => console.log('  ' + s));
  process.exitCode = 1;
}
process.exit(0);
