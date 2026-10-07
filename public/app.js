/* Cờ Tướng Online – client */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const CHARS = {
  r: { K: '帥', A: '仕', B: '相', R: '車', N: '馬', C: '砲', P: '兵' },
  b: { K: '將', A: '士', B: '象', R: '車', N: '馬', C: '炮', P: '卒' },
};
const COLOR_VN = { r: 'Đỏ', b: 'Đen' };
const M = 40, CELL = 60;

const App = {
  mode: null,          // 'online' | 'local' | 'ai'
  view: null,          // trạng thái hiển thị (cùng cấu trúc với server)
  sel: null, targets: [],
  flip: false, userFlip: false,
  flipFx: null,        // {x, y, until} – hiệu ứng lật quân
  local: null,         // {game, variant, ai: {level, me, colorChoice} | null}
  aiPending: null,     // {id, kind: 'move'|'hint', t0} – yêu cầu đang gửi cho Web Worker
  hint: null,          // {from, to} – gợi ý đang hiển thị
  aiInfo: '',
  prevMoveCount: 0, prevStatus: null,
  ws: null, wsOpen: false, session: null,
  createOpts: { color: 'r', mode: 'normal' },
  aiOpts: { mode: 'normal', level: 'medium', color: 'r' },
};

/* ================== Âm thanh ================== */
let actx = null;
function beep(freq = 520, dur = 0.08, type = 'sine', vol = 0.15) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime; g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch {}
}
const sfx = {
  flip: () => { beep(660, 0.06, 'triangle', 0.2); setTimeout(() => beep(990, 0.08, 'triangle', 0.18), 60); },
  move: () => beep(300, 0.09, 'triangle', 0.25),
  capture: () => { beep(220, 0.12, 'square', 0.12); setTimeout(() => beep(160, 0.1, 'square', 0.1), 70); },
  check: () => { beep(880, 0.12, 'sawtooth', 0.1); setTimeout(() => beep(990, 0.15, 'sawtooth', 0.1), 130); },
  bad: () => beep(140, 0.2, 'square', 0.1),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'triangle', 0.2), i * 120)),
};

/* ================== Thông báo ================== */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function modal(text, kind = '') {
  $('modalText').textContent = text;
  $('modal').querySelector('.modal-box').className = 'modal-box ' + kind;
  $('modal').classList.remove('hidden');
}
$('modalClose').onclick = () => $('modal').classList.add('hidden');

/* ================== Kết nối WebSocket ================== */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch { return setTimeout(connect, 2000); }
  App.ws = ws;
  ws.onopen = () => {
    App.wsOpen = true; setConn(true);
    const s = loadSession();
    if (s && (App.mode === 'online' || wantResume(s))) send({ t: 'resume', code: s.code, token: s.token });
  };
  ws.onclose = () => { App.wsOpen = false; setConn(false); setTimeout(connect, 1500); };
  ws.onerror = () => {};
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
}
function setConn(ok) {
  const el = $('conn');
  el.className = 'conn ' + (ok ? 'ok' : 'bad');
  el.textContent = ok ? '● Đã kết nối' : '● Mất kết nối – đang thử lại…';
}
function send(obj) {
  if (!App.wsOpen) { toast('Chưa kết nối được máy chủ', 'bad'); return false; }
  App.ws.send(JSON.stringify(obj)); return true;
}
const loadSession = () => { try { return JSON.parse(sessionStorage.getItem('xq-session')); } catch { return null; } };
const saveSession = (s) => sessionStorage.setItem('xq-session', JSON.stringify(s));
const clearSession = () => sessionStorage.removeItem('xq-session');
function wantResume(s) {
  const q = new URLSearchParams(location.search).get('room');
  return q && q.toUpperCase() === s.code;
}

function onMessage(m) {
  switch (m.t) {
    case 'joined': {
      const changed = App.session && App.session.color !== m.color;
      App.session = { code: m.code, token: m.token, color: m.color };
      saveSession(App.session);
      if (App.mode !== 'online' || changed) { App.userFlip = false; App.prevMoveCount = -1; }
      App.mode = 'online';
      history.replaceState(null, '', '?room=' + m.code);
      showGame();
      break;
    }
    case 'resumeFail':
      clearSession();
      if (App.mode === 'online') { toast(m.msg, 'bad'); goLobby(); }
      break;
    case 'state': {
      if (App.mode !== 'online') return;
      const prev = App.view;
      if (prev && prev.gameNo !== m.gameNo) App.prevMoveCount = -1;
      App.view = m;
      afterUpdate(prev);
      break;
    }
    case 'illegal': sfx.bad(); toast(m.msg, 'bad'); App.sel = null; App.targets = []; render(); break;
    case 'error': toast(m.msg, 'bad'); break;
    case 'toast': toast(m.msg, m.kind); break;
    case 'gameover':
      modal(m.msg, m.kind);
      if (m.kind === 'good') sfx.win(); else sfx.bad();
      break;
    case 'chat': addChat(m); break;
  }
}

/* ================== Chế độ local (hotseat) ================== */
function startLocal(variant, ai) {
  cancelAI();
  App.mode = ai ? 'ai' : 'local';
  if (ai) ai.me = ai.colorChoice === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : ai.colorChoice;
  App.local = { game: new XQ.Game({ variant }), variant, ai: ai || null };
  App.userFlip = false; App.prevMoveCount = 0; App.sel = null; App.targets = []; App.view = null; App.hint = null; App.aiInfo = '';
  history.replaceState(null, '', location.pathname);
  $('chatLog').innerHTML = '';
  showGame();
  refreshLocal();
  if (ai) {
    toast(`Bạn cầm quân ${COLOR_VN[ai.me]} · Máy ${XQAI.LEVELS[ai.level].name}${ai.me === 'b' ? ' – máy đi trước' : ''}`, 'good');
    maybeAI();
  }
}
/* Cờ úp cùng máy: giao diện chỉ dùng bản đã che danh tính quân úp (giống online) */
function localView() {
  const L = App.local, g = L.game;
  const over = g.status === 'over';
  const lm = g.history[g.history.length - 1];
  const ai = L.ai;
  const players = ai
    ? { [ai.me]: { name: 'Bạn', online: true }, [XQ.other(ai.me)]: { name: `🤖 Máy (${XQAI.LEVELS[ai.level].name})`, online: true } }
    : { r: { name: 'Đỏ', online: true }, b: { name: 'Đen', online: true } };
  return {
    you: ai ? ai.me : g.turn, variant: L.variant, board: over ? g.board : XQ.publicBoard(g.board), turn: g.turn,
    moves: g.history.map((mv) => ({ side: mv.side, text: mv.text, check: mv.check, cap: !!mv.captured, flip: !!mv.revealed })),
    lastMove: lm ? { from: lm.from, to: lm.to } : null, captured: g.captured,
    inCheck: g.status === 'playing' && XQ.inCheck(g.board, g.turn) ? g.turn : null,
    status: g.status, result: g.result, started: true,
    players,
  };
}
function refreshLocal() {
  const prev = App.view;
  App.view = localView();
  afterUpdate(prev);
}

function localMove(from, to) {
  const L = App.local, g = L.game;
  const r = g.move(from, to);
  if (!r.ok) { sfx.bad(); toast(r.error, 'bad'); return false; }
  refreshLocal();
  if (g.status === 'over') {
    const res = g.result, reason = XQ.REASON_VN[res.reason];
    if (L.ai) {
      if (!res.winner) { modal(`Hoà! (${reason})`); sfx.move(); }
      else if (res.winner === L.ai.me) { modal(`🏆 Bạn THẮNG máy! (${reason})`, 'good'); sfx.win(); }
      else { modal(`🤖 Máy thắng (${reason})`, 'bad'); sfx.bad(); }
    } else {
      modal(res.winner ? `${COLOR_VN[res.winner]} THẮNG! (${reason})` : `Hoà! (${reason})`, res.winner ? 'good' : '');
      sfx.win();
    }
  }
  maybeAI();
  return true;
}

/* ================== Chơi với máy (AI chạy trong Web Worker) ==================
 * Máy chỉ nhận bàn cờ ĐÃ CHE (XQ.publicBoard): quân úp chỉ còn 'rC?' – không có danh tính thật.
 * (Danh tính quân úp vẫn nằm trong bộ nhớ trình duyệt ở luồng chính để luật lật quân hoạt động.) */
let aiWorker = null, aiSeq = 0, workerBroken = false;
function getWorker() {
  if (aiWorker || workerBroken || typeof Worker === 'undefined') return aiWorker;
  try {
    aiWorker = new Worker('ai-worker.js');
    aiWorker.onmessage = (e) => onAIResult(e.data);
    aiWorker.onerror = (e) => {
      console.warn('AI worker lỗi, chuyển sang chạy trực tiếp', e && e.message);
      workerBroken = true; aiWorker = null;
      const p = App.aiPending; if (p) { App.aiPending = null; requestAI(p.kind); }
    };
  } catch (err) { workerBroken = true; aiWorker = null; }
  return aiWorker;
}
function cancelAI() {
  if (!App.aiPending) return;
  App.aiPending = null;
  if (aiWorker) { aiWorker.terminate(); aiWorker = null; } // dừng ngay phép tính đang chạy
}
const aiThinking = () => !!(App.aiPending && App.aiPending.kind === 'move');
function maybeAI() {
  const L = App.local;
  if (App.mode !== 'ai' || !L || !L.ai) return;
  const g = L.game;
  if (g.status === 'playing' && g.turn !== L.ai.me && !aiThinking()) requestAI('move');
}
function requestAI(kind) {
  const L = App.local, g = L.game;
  if (App.aiPending) cancelAI();
  const id = ++aiSeq;
  App.aiPending = { id, kind, t0: Date.now() };
  const pos = { board: XQ.publicBoard(g.board), turn: g.turn, captured: g.captured, variant: L.variant, moveCount: g.history.length,
    prevBoards: XQAI.recentBoards(g) };
  const opts = kind === 'hint' ? { level: 'medium', timeMs: 700 } : { level: L.ai.level };
  const w = getWorker();
  if (w) w.postMessage({ id, pos, opts });
  else setTimeout(() => { // dự phòng: trình duyệt không hỗ trợ Worker
    let res, ok = true, error;
    try { res = XQAI.think({ ...pos, board: XQAI.aiView(pos.board) }, opts); } catch (err) { ok = false; error = String(err); }
    onAIResult({ id, ok, res, error });
  }, 30);
  if (App.view) renderSide();
}
function onAIResult(d) {
  const p = App.aiPending;
  if (!p || !d || d.id !== p.id || App.mode !== 'ai') return; // kết quả cũ (đã đi lại / ván mới)
  if (!d.ok || !d.res || !d.res.move) {
    App.aiPending = null;
    toast('Máy gặp lỗi: ' + (d.error || 'không tìm được nước đi'), 'bad'); renderSide(); return;
  }
  const { from, to } = d.res.move;
  if (p.kind === 'hint') {
    App.aiPending = null;
    App.hint = { from, to };
    const txt = XQ.notation(App.view.board, from, to);
    toast(`💡 Gợi ý: ${txt}`, 'info');
    render(); return;
  }
  const wait = Math.max(0, 350 - (Date.now() - p.t0)); // để người chơi kịp thấy nước của mình
  setTimeout(() => {
    if (App.aiPending !== p) return;
    App.aiPending = null;
    const r = d.res;
    App.aiInfo = r.book ? 'Máy: nước khai cuộc' : r.random ? 'Máy: đi ngẫu hứng' : r.forced ? 'Máy: nước bắt buộc'
      : `Máy: độ sâu ${r.depth} · ${(r.timeMs / 1000).toFixed(1)}s · ${r.nodes >= 1e6 ? (r.nodes / 1e6).toFixed(1) + 'M' : r.nodes >= 1e4 ? Math.round(r.nodes / 1000) + 'k' : r.nodes} thế cờ` +
        (Math.abs(r.score) > 29000 ? (r.score > 0 ? ' · thấy chiếu bí!' : ' · sắp bị chiếu bí') : '');
    if (!localMove(from, to)) toast('Máy đi nước không hợp lệ (lỗi)', 'bad');
  }, wait);
}

/* ================== Cập nhật sau khi có trạng thái mới ================== */
function afterUpdate(prev) {
  const v = App.view;
  // tự xoay bàn theo màu của mình
  if (!App.userFlip) App.flip = (App.mode === 'online' || App.mode === 'ai') && v.you === 'b';
  // âm thanh khi có nước mới
  const n = v.moves.length;
  if (App.prevMoveCount >= 0 && n > App.prevMoveCount) {
    const last = v.moves[n - 1];
    if (v.inCheck) {
      sfx.check();
      if (v.inCheck === v.you && App.mode !== 'local') toast('Bạn đang bị CHIẾU TƯỚNG!', 'bad');
      else toast('Chiếu tướng!', 'warn');
    } else if (last && last.cap) sfx.capture();
    else sfx.move();
    // cờ úp: hiệu ứng lật quân + thông báo danh tính quân vừa lộ
    if (prev && prev.board && v.lastMove && n === App.prevMoveCount + 1) {
      const [fx, fy] = v.lastMove.from, [tx, ty] = v.lastMove.to;
      const was = prev.board[fy][fx], victim = prev.board[ty][tx], now = v.board[ty][tx];
      const msgs = [];
      if (XQ.isDown(was) && now) {
        App.flipFx = { x: tx, y: ty, until: Date.now() + 700 };
        msgs.push(`${COLOR_VN[now[0]]} lật quân: ${XQ.VN_NAME[now[1]]}`);
        setTimeout(sfx.flip, 120);
      }
      if (XQ.isDown(victim)) {
        const caps = v.captured[last.side] || [], q = caps[caps.length - 1];
        if (q) msgs.push(`Ăn quân úp: ${COLOR_VN[q[0]]} ${XQ.VN_NAME[q[1]]}`);
      }
      if (msgs.length) toast(msgs.join(' · '), 'info');
    }
  }
  App.prevMoveCount = n;
  App.sel = null; App.targets = []; App.hint = null;
  render();
}

/* ================== Màn hình ================== */
function showGame() {
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden');
  $('chatCard').classList.toggle('hidden', App.mode !== 'online');
  $('roomCard').classList.toggle('hidden', false);
}
function goLobby() {
  cancelAI();
  App.mode = null; App.view = null; App.session = null; App.local = null;
  $('game').classList.add('hidden'); $('lobby').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
}

/* ================== Vẽ bàn cờ ================== */
const svg = $('board');
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const dx = (x) => (App.flip ? 8 - x : x), dy = (y) => (App.flip ? 9 - y : y);
const px = (x) => M + CELL * dx(x), py = (y) => M + CELL * dy(y);

let staticLayer, dynLayer;
function buildStatic() {
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <linearGradient id="woodGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f2d29b"/><stop offset=".5" stop-color="#e7bf7c"/><stop offset="1" stop-color="#dcae66"/>
    </linearGradient>
    <radialGradient id="pieceGrad" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#fff6e0"/><stop offset=".7" stop-color="#f3dcae"/><stop offset="1" stop-color="#d9b77c"/>
    </radialGradient>
    <radialGradient id="backR" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#e0574a"/><stop offset="1" stop-color="#8e1712"/></radialGradient>
    <radialGradient id="backB" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#555"/><stop offset="1" stop-color="#111"/></radialGradient>
    <filter id="pshadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1.5" dy="2.5" stdDeviation="1.8" flood-opacity=".45"/></filter>`;
  staticLayer = el('g', {}, svg);
  el('rect', { x: 2, y: -8, width: 556, height: 636, rx: 14, fill: 'url(#woodGrad)', stroke: '#7a4b1f', 'stroke-width': 4 }, staticLayer);
  const g = el('g', { stroke: '#5b3415', 'stroke-width': 1.6, fill: 'none' }, staticLayer);
  const X = (i) => M + CELL * i, Y = (j) => M + CELL * j;
  el('rect', { x: X(0) - 6, y: Y(0) - 6, width: CELL * 8 + 12, height: CELL * 9 + 12, 'stroke-width': 3 }, g);
  for (let j = 0; j < 10; j++) el('line', { x1: X(0), y1: Y(j), x2: X(8), y2: Y(j) }, g);
  for (let i = 0; i < 9; i++) {
    if (i === 0 || i === 8) el('line', { x1: X(i), y1: Y(0), x2: X(i), y2: Y(9) }, g);
    else { el('line', { x1: X(i), y1: Y(0), x2: X(i), y2: Y(4) }, g); el('line', { x1: X(i), y1: Y(5), x2: X(i), y2: Y(9) }, g); }
  }
  // cung
  for (const [a, b] of [[0, 2], [7, 9]]) {
    el('line', { x1: X(3), y1: Y(a), x2: X(5), y2: Y(b) }, g);
    el('line', { x1: X(5), y1: Y(a), x2: X(3), y2: Y(b) }, g);
  }
  // dấu vị trí pháo / tốt
  const marks = [[1, 2], [7, 2], [1, 7], [7, 7]];
  for (let i = 0; i < 9; i += 2) { marks.push([i, 3]); marks.push([i, 6]); }
  for (const [i, j] of marks) {
    const cx = X(i), cy = Y(j), d = 5, l = 10;
    for (const sx of [-1, 1]) {
      if ((sx < 0 && i === 0) || (sx > 0 && i === 8)) continue;
      for (const sy of [-1, 1]) {
        el('polyline', { points: `${cx + sx * d},${cy + sy * (d + l)} ${cx + sx * d},${cy + sy * d} ${cx + sx * (d + l)},${cy + sy * d}`, 'stroke-width': 1.4 }, g);
      }
    }
  }
  // sông
  const river = el('g', { fill: '#6b3e18', 'font-size': 30, 'font-family': '"KaiTi","STKaiti","Noto Serif CJK SC",serif', 'text-anchor': 'middle', 'dominant-baseline': 'central', opacity: .85 }, staticLayer);
  const ry = M + CELL * 4.5;
  el('text', { x: X(1.5), y: ry }, river).textContent = '楚 河';
  el('text', { x: X(6.5), y: ry }, river).textContent = '漢 界';
  const vn = el('text', { x: X(4), y: ry, fill: '#8a5a2b', 'font-size': 15, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-style': 'italic', 'font-family': 'Georgia,serif' }, staticLayer);
  vn.textContent = '~ Sông ~';
  dynLayer = el('g', {}, svg);
}
buildStatic();

function render() {
  const v = App.view; if (!v) return;
  dynLayer.innerHTML = '';
  // số cột: dưới theo bên dưới, trên theo bên trên
  const bottom = App.flip ? 'b' : 'r', top = XQ.other(bottom);
  const lab = el('g', { 'font-size': 13, fill: '#6b3e18', 'text-anchor': 'middle', 'font-family': 'Georgia,serif', 'font-weight': 700 }, dynLayer);
  for (let x = 0; x < 9; x++) {
    // x ở đây là cột màn hình
    const sx = M + CELL * x;
    const realB = App.flip ? 8 - x : x;
    el('text', { x: sx, y: 624 }, lab).textContent = bottom === 'r' ? 9 - realB : realB + 1;
    el('text', { x: sx, y: 6 }, lab).textContent = top === 'r' ? 9 - realB : realB + 1;
  }
  // nước đi cuối
  if (v.lastMove) for (const p of [v.lastMove.from, v.lastMove.to]) el('rect', { class: 'last', x: px(p[0]) - 28, y: py(p[1]) - 28, width: 56, height: 56, rx: 6 }, dynLayer);
  if (App.hint) for (const p of [App.hint.from, App.hint.to]) el('rect', { class: 'hintmark', x: px(p[0]) - 29, y: py(p[1]) - 29, width: 58, height: 58, rx: 29 }, dynLayer);
  // quân cờ
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const p = v.board[y][x]; if (!p) continue;
    const sel = App.sel && App.sel[0] === x && App.sel[1] === y;
    const down = XQ.isDown(p);
    const outer = el('g', { class: `piece ${p[0]}${down ? ' down' : ''}${sel ? ' sel' : ''}`, transform: `translate(${px(x)},${py(y)})`, filter: 'url(#pshadow)' }, dynLayer);
    const fx = App.flipFx && App.flipFx.x === x && App.flipFx.y === y && Date.now() < App.flipFx.until;
    const g = el('g', { class: fx ? 'flipin' : '' }, outer);
    if (down) drawBack(g, p); else {
      el('circle', { class: 'disc', r: 26 }, g);
      el('circle', { class: 'ring', r: 21.5 }, g);
      el('text', { y: 1 }, g).textContent = CHARS[p[0]][p[1]];
    }
    if (v.inCheck && p === v.inCheck + 'K') el('circle', { class: 'checkglow', r: 29 }, outer);
  }
  // ô có thể đi
  for (const [x, y] of App.targets) {
    if (v.board[y][x]) el('circle', { class: 'target-cap', cx: px(x), cy: py(y), r: 29 }, dynLayer);
    else el('circle', { class: 'target', cx: px(x), cy: py(y), r: 8 }, dynLayer);
  }
  // vùng bấm
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const r = el('rect', { class: 'sq', x: px(x) - 30, y: py(y) - 30, width: 60, height: 60, 'data-x': x, 'data-y': y }, dynLayer);
  }
  renderSide();
}

/* Mặt lưng quân úp: đĩa màu của bên, hoa văn, không có chữ. Hết ván (p có 4 ký tự) thì hiện mờ quân thật. */
function drawBack(g, p) {
  el('circle', { class: 'disc', r: 26 }, g);
  el('circle', { class: 'ring', r: 21 }, g);
  el('circle', { class: 'ring', r: 13 }, g);
  for (const a of [0, 45, 90, 135]) el('line', { class: 'pat', x1: -13, y1: 0, x2: 13, y2: 0, transform: `rotate(${a})` }, g);
  el('circle', { class: 'dot', r: 3 }, g);
  if (p[3]) el('text', { y: 1, class: 'ghostchar' }, g).textContent = CHARS[p[0]][p[3]];
}

/* ================== Bảng bên ================== */
function renderBar(barEl, trayEl, c) {
  const v = App.view, p = v.players[c];
  const isTurn = v.status === 'playing' && v.turn === c;
  barEl.className = 'player-bar' + (isTurn ? ' turn' : '');
  let html = `<span class="dot ${c}"></span><span class="pname">${p ? esc(p.name) : '<i>Đang chờ…</i>'}</span><span class="tag">${COLOR_VN[c]}</span>`;
  if (App.mode === 'online' && c === v.you) html += '<span class="tag">Bạn</span>';
  if (App.mode === 'ai' && c !== v.you && aiThinking()) html += '<span class="tag">💭 Đang nghĩ…</span>';
  if (App.mode === 'online' && p && !p.online) html += '<span class="tag off">Mất kết nối</span>';
  html += '<span class="spacer"></span>';
  if (isTurn) html += '<span class="tag">⏳ Đang đi</span>';
  barEl.innerHTML = html;
  const caps = v.captured[c] || [];
  trayEl.innerHTML = `<span class="lbl">${COLOR_VN[c]} đã ăn (${caps.length}):</span>` + caps.map((q) => `<span class="mini ${q[0]}">${CHARS[q[0]][q[1]]}</span>`).join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function renderSide() {
  const v = App.view, online = App.mode === 'online', vsAI = App.mode === 'ai';
  const bottom = App.flip ? 'b' : 'r', top = XQ.other(bottom);
  renderBar($('bottomBar'), $('bottomTray'), bottom);
  renderBar($('topBar'), $('topTray'), top);

  $('roomCode').textContent = online ? v.code : vsAI ? 'VS MÁY' : 'LOCAL';
  $('roomLabel').textContent = online ? 'Mã phòng' : 'Chế độ';
  if (!online && !vsAI) $('roomCode').textContent = 'CÙNG MÁY';
  $('copyCode').classList.toggle('hidden', !online);
  $('copyLink').classList.toggle('hidden', !online);
  const badges = [];
  badges.push(v.variant === 'up' ? '<span class="badge up">🎴 Cờ úp</span>' : '<span class="badge">♟ Thường</span>');
  badges.push(online ? '<span class="badge">🌐 Online</span>' : vsAI ? `<span class="badge">🤖 Máy · ${XQAI.LEVELS[App.local.ai.level].name}</span>` : '<span class="badge">👥 Cùng máy</span>');
  if (online || vsAI) badges.push(`<span class="badge">Bạn: ${COLOR_VN[v.you]}</span>`);
  if (online && v.gameNo > 1) badges.push(`<span class="badge">Ván ${v.gameNo}</span>`);
  $('badges').innerHTML = badges.join('');

  // trạng thái
  const st = $('status'); let txt = '', cls = 'status';
  if (v.status === 'waiting') txt = `⏳ Đang chờ đối thủ… Gửi mã phòng ${v.code} cho bạn bè`;
  else if (v.status === 'over') {
    const r = v.result, reason = XQ.REASON_VN[r.reason] || r.reason;
    if (!r.winner) txt = `🤝 Hoà – ${reason}`;
    else if (online || vsAI) { const win = r.winner === v.you; txt = (win ? '🏆 Bạn thắng' : '💀 Bạn thua') + ` – ${reason}`; cls += win ? ' good' : ' bad'; }
    else { txt = `🏆 ${COLOR_VN[r.winner]} thắng – ${reason}`; cls += ' good'; }
  } else if (online) {
    if (v.inCheck === v.you) { txt = '⚠️ Bạn đang bị CHIẾU! Đến lượt bạn'; cls += ' check'; }
    else if (v.turn === v.you) txt = `▶ Đến lượt bạn (${COLOR_VN[v.you]})`;
    else if (v.inCheck) txt = '🎯 Bạn đang chiếu tướng! Chờ đối thủ…';
    else txt = '⌛ Đối thủ đang suy nghĩ…';
  } else if (vsAI) {
    if (v.turn !== v.you) { txt = v.inCheck ? '🎯 Bạn chiếu tướng! Máy đang nghĩ…' : '🤖 Máy đang nghĩ…'; cls += ' thinking'; }
    else if (v.inCheck === v.you) { txt = '⚠️ Bạn đang bị CHIẾU! Đến lượt bạn'; cls += ' check'; }
    else txt = `▶ Đến lượt bạn (${COLOR_VN[v.you]})`;
  } else {
    if (v.inCheck) { txt = `⚠️ ${COLOR_VN[v.turn]} đang bị CHIẾU!`; cls += ' check'; }
    else txt = `▶ Lượt ${COLOR_VN[v.turn]}`;
  }
  st.className = cls; st.textContent = txt;

  // nút
  const playing = v.status === 'playing';
  $('swapBtn').classList.toggle('hidden', !(online && v.isHost && (v.status === 'waiting' || (playing && v.moves.length === 0))));
  $('drawBtn').classList.toggle('hidden', !playing || vsAI);
  $('drawBtn').disabled = online && v.drawOffer === v.you;
  $('drawBtn').textContent = online && v.drawOffer === v.you ? '🤝 Đã cầu hoà…' : '🤝 Cầu hoà';
  $('resignBtn').classList.toggle('hidden', !playing);
  $('undoBtn').classList.toggle('hidden', !((App.mode === 'local' && v.moves.length > 0) || (vsAI && v.moves.some((m) => m.side === v.you))));
  $('hintBtn').classList.toggle('hidden', !(vsAI && playing));
  $('hintBtn').disabled = !(vsAI && playing && v.turn === v.you && !App.aiPending);
  $('aiInfo').classList.toggle('hidden', !(vsAI && App.aiInfo));
  $('aiInfo').textContent = vsAI ? App.aiInfo : '';
  $('rematchBtn').classList.toggle('hidden', v.status !== 'over');
  const waitingRematch = online && v.rematch && v.rematch[v.you];
  $('rematchBtn').disabled = !!waitingRematch;
  $('rematchBtn').textContent = waitingRematch ? '⏳ Chờ đối thủ…' : (online ? '♻ Ván mới (đổi màu)' : '♻ Ván mới');
  $('drawOffer').classList.toggle('hidden', !(online && playing && v.drawOffer && v.drawOffer !== v.you));

  // danh sách nước đi
  const ol = $('moves'); let html = '';
  for (let i = 0; i < v.moves.length; i += 2) {
    const a = v.moves[i], b = v.moves[i + 1];
    const cell = (m) => m ? `<span class="mv ${m.side}${m.flip ? ' flip' : ''}">${esc(m.text)}${m.check ? ' +' : ''}</span>` : '';
    html += `<li>${cell(a)}${cell(b)}</li>`;
  }
  ol.innerHTML = html;
  ol.scrollTop = ol.scrollHeight;
}

/* ================== Tương tác bàn cờ ================== */
function canAct() {
  const v = App.view;
  if (!v || v.status !== 'playing') return false;
  if (App.mode === 'local') return true;
  if (App.mode === 'ai') return v.turn === v.you && !aiThinking();
  return v.turn === v.you;
}
function onSquare(x, y) {
  const v = App.view; if (!v) return;
  if (!canAct()) {
    if (v.status === 'waiting') toast('Đang chờ đối thủ vào phòng');
    else if (v.status === 'playing' && App.mode === 'online') toast('Chưa tới lượt bạn');
    else if (v.status === 'playing' && App.mode === 'ai') toast('Máy đang nghĩ, chờ chút…');
    return;
  }
  const me = App.mode === 'local' ? v.turn : v.you;
  const p = v.board[y][x];
  if (App.sel && App.targets.some(([a, b]) => a === x && b === y)) {
    const from = App.sel; App.sel = null; App.targets = [];
    if (App.mode !== 'online') localMove(from, [x, y]);
    else { send({ t: 'move', from, to: [x, y] }); render(); }
    return;
  }
  if (p && p[0] === me) {
    if (App.sel && App.sel[0] === x && App.sel[1] === y) { App.sel = null; App.targets = []; }
    else {
      App.sel = [x, y];
      // quân úp đi theo loại quân của ô nó đang đứng – client tính được nước hợp lệ mà không cần biết danh tính
      App.targets = XQ.legalMovesFrom(v.board, x, y);
      if (App.targets.length === 0) toast('Quân này không có nước đi hợp lệ', 'warn');
    }
  } else { App.sel = null; App.targets = []; }
  render();
}
const sqFromEvent = (e) => {
  const t = e.target.closest && e.target.closest('.sq');
  return t ? [Number(t.dataset.x), Number(t.dataset.y)] : null;
};
svg.addEventListener('click', (e) => {
  const s = sqFromEvent(e); if (s) onSquare(s[0], s[1]);
});

/* ================== Nút bấm ================== */
function segInit(id, key, onChange, store = App.createOpts) {
  $(id).querySelectorAll('button').forEach((b) => b.onclick = () => {
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    store[key] = b.dataset.v; onChange && onChange(b.dataset.v);
  });
}
segInit('colorSeg', 'color');
segInit('modeSeg', 'mode', (v) => {
  $('modeHint').textContent = v === 'up'
    ? 'Cờ úp: 15 quân mỗi bên bị xáo trộn và úp mặt (chỉ Tướng ngửa). Quân úp đi theo vị trí đứng, đi xong thì lật.'
    : 'Cờ tướng truyền thống.';
});
const getName = () => { const n = $('nameInput').value.trim(); localStorage.setItem('xq-name', n); return n; };
$('nameInput').value = localStorage.getItem('xq-name') || '';
$('createBtn').onclick = () => send({ t: 'create', name: getName(), color: App.createOpts.color, variant: App.createOpts.mode === 'up' ? 'up' : 'normal' });
$('joinBtn').onclick = () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 4) return toast('Nhập mã phòng (5 ký tự)', 'warn');
  send({ t: 'join', code, name: getName() });
};
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('localBtn').onclick = () => startLocal('normal');
segInit('aiModeSeg', 'mode', null, App.aiOpts);
segInit('aiColorSeg', 'color', null, App.aiOpts);
const LEVEL_HINT = {
  easy: 'Máy chỉ nhìn 1 nước và hay đi ẩu – hợp cho người mới.',
  medium: 'Máy tính trước vài nước, chơi chắc tay.',
  hard: 'Máy tính sâu (~1,5 giây mỗi nước), rất khó thắng.',
};
segInit('aiLevelSeg', 'level', (v) => { $('aiLevelHint').textContent = LEVEL_HINT[v]; }, App.aiOpts);
$('aiStartBtn').onclick = () => startLocal(App.aiOpts.mode === 'up' ? 'up' : 'normal', { level: App.aiOpts.level, colorChoice: App.aiOpts.color });
$('localUpBtn').onclick = () => startLocal('up');

$('flipBtn').onclick = () => { App.userFlip = true; App.flip = !App.flip; render(); };
$('swapBtn').onclick = () => send({ t: 'swap' });
$('resignBtn').onclick = () => {
  if (!confirm('Bạn chắc chắn muốn đầu hàng?')) return;
  if (App.mode === 'online') send({ t: 'resign' });
  else if (App.mode === 'ai') { cancelAI(); const g = App.local.game; g.resign(App.local.ai.me); refreshLocal(); modal('🤖 Máy thắng (Bạn đầu hàng)', 'bad'); }
  else { const g = App.local.game; g.resign(g.turn); refreshLocal(); modal(`${COLOR_VN[g.result.winner]} THẮNG! (Đầu hàng)`, 'good'); }
};
$('drawBtn').onclick = () => {
  if (App.mode === 'online') { send({ t: 'offerDraw' }); toast('Đã gửi lời cầu hoà'); }
  else if (confirm('Hai bên đồng ý hoà?')) { App.local.game.draw(); refreshLocal(); modal('Hoà!'); }
};
$('hintBtn').onclick = () => { if (App.mode === 'ai' && canAct()) requestAI('hint'); };
$('acceptDraw').onclick = () => send({ t: 'acceptDraw' });
$('declineDraw').onclick = () => send({ t: 'declineDraw' });
$('undoBtn').onclick = () => {
  const L = App.local; if (!L) return;
  let cut = L.game.history.length - 1;
  if (L.ai) { // chơi với máy: lùi cả nước của máy lẫn nước của mình (về lượt mình)
    while (cut >= 0 && L.game.history[cut].side !== L.ai.me) cut--;
    if (cut < 0) return;
    cancelAI(); App.aiInfo = '';
  }
  const hist = L.game.history.slice(0, cut);
  const g = new XQ.Game({ variant: L.variant, board: L.game.startBoard }); // cùng thế xáo trộn ban đầu
  for (const m of hist) g.move(m.from, m.to);
  L.game = g;
  App.prevMoveCount = hist.length; refreshLocal();
};
$('rematchBtn').onclick = () => {
  if (App.mode === 'online') send({ t: 'rematch' });
  else startLocal(App.local.variant, App.local.ai ? { level: App.local.ai.level, colorChoice: App.local.ai.colorChoice } : null);
};
$('leaveBtn').onclick = () => {
  if (App.mode === 'online') {
    const v = App.view;
    if (v && v.status === 'playing' && !confirm('Rời phòng khi đang chơi sẽ bị xử thua. Tiếp tục?')) return;
    send({ t: 'leave' }); clearSession();
  }
  goLobby();
};
function copy(text, okMsg) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(okMsg, 'good'), () => prompt('Sao chép:', text));
}
$('copyCode').onclick = () => copy(App.view.code, 'Đã sao chép mã phòng');
$('copyLink').onclick = () => copy(`${location.origin}${location.pathname}?room=${App.view.code}`, 'Đã sao chép link mời');

/* ================== Chat ================== */
function addChat(m) {
  const d = document.createElement('div'); d.className = 'm';
  d.innerHTML = `<b class="${m.color}">${esc(m.from)}:</b> ${esc(m.text)}`;
  $('chatLog').appendChild(d); $('chatLog').scrollTop = 1e9;
}
$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const t = $('chatInput').value.trim(); if (!t) return;
  if (send({ t: 'chat', text: t })) $('chatInput').value = '';
};

/* ================== Khởi động ================== */
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) {
  const s = loadSession();
  if (!s || s.code !== qRoom.toUpperCase()) {
    $('codeInput').value = qRoom.toUpperCase();
    setTimeout(() => toast(`Bạn được mời vào phòng ${qRoom.toUpperCase()} – nhập tên rồi bấm "Vào phòng"`, 'good'), 300);
  }
}
connect();
window.__xq = App; // debug
})();
