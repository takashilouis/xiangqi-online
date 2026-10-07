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
  mode: null,          // 'online' | 'local'
  view: null,          // trạng thái hiển thị (cùng cấu trúc với server)
  sel: null, targets: [],
  flip: false, userFlip: false,
  ghosts: new Set(),
  local: null,         // {game, blind, coverFor}
  prevMoveCount: 0, prevStatus: null,
  ws: null, wsOpen: false, session: null,
  createOpts: { color: 'r', mode: 'normal' },
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
      if (App.mode !== 'online' || changed) { App.ghosts.clear(); App.userFlip = false; App.prevMoveCount = -1; }
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
      if (prev && prev.gameNo !== m.gameNo) { App.ghosts.clear(); App.prevMoveCount = -1; }
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
function startLocal(blind) {
  App.mode = 'local';
  App.local = { game: new XQ.Game(), blind, coverFor: null };
  App.ghosts.clear(); App.userFlip = false; App.prevMoveCount = 0; App.sel = null; App.targets = [];
  history.replaceState(null, '', location.pathname);
  $('chatLog').innerHTML = '';
  showGame();
  if (blind) App.local.coverFor = 'r';
  refreshLocal();
}
function localView() {
  const L = App.local, g = L.game;
  const viewer = g.turn;
  const hide = L.blind && g.status === 'playing';
  const board = g.board.map((row) => row.map((p) => (hide && p && p[0] !== viewer ? null : p)));
  const moves = g.history.map((mv) => (hide && mv.side !== viewer
    ? { side: mv.side, text: mv.captured ? '??? (ăn quân)' : '???', check: mv.check, hidden: true }
    : { side: mv.side, text: mv.text, check: mv.check, cap: !!mv.captured }));
  const lm = g.history[g.history.length - 1];
  let lastMove = null;
  if (lm) lastMove = (hide && lm.side !== viewer) ? (lm.captured ? { to: lm.to } : null) : { from: lm.from, to: lm.to };
  return {
    you: viewer, blind: L.blind, board, turn: g.turn, moves, lastMove, captured: g.captured,
    inCheck: g.status === 'playing' && XQ.inCheck(g.board, g.turn) ? g.turn : null,
    status: g.status, result: g.result, started: true,
    players: { r: { name: 'Đỏ', online: true }, b: { name: 'Đen', online: true } },
  };
}
function refreshLocal() {
  const prev = App.view;
  App.view = localView();
  afterUpdate(prev);
  const L = App.local;
  if (L.blind && L.coverFor && L.game.status === 'playing') {
    $('coverTitle').textContent = `Lượt của ${COLOR_VN[L.coverFor]}`;
    $('cover').classList.remove('hidden');
  } else $('cover').classList.add('hidden');
}
$('coverBtn').onclick = () => { App.local.coverFor = null; $('cover').classList.add('hidden'); };

function localMove(from, to) {
  const g = App.local.game;
  const r = g.move(from, to);
  if (!r.ok) { sfx.bad(); toast(r.error, 'bad'); return; }
  if (App.local.blind && g.status === 'playing') { App.local.coverFor = g.turn; App.ghosts.clear(); }
  refreshLocal();
  if (g.status === 'over') {
    const res = g.result, reason = XQ.REASON_VN[res.reason];
    modal(res.winner ? `${COLOR_VN[res.winner]} THẮNG! (${reason})` : `Hoà! (${reason})`, res.winner ? 'good' : '');
    sfx.win();
  }
}

/* ================== Cập nhật sau khi có trạng thái mới ================== */
function afterUpdate(prev) {
  const v = App.view;
  // tự xoay bàn theo màu của mình
  if (!App.userFlip) App.flip = v.you === 'b';
  if (App.mode === 'local' && !App.local.blind && !App.userFlip) App.flip = false;
  // âm thanh khi có nước mới
  const n = v.moves.length;
  if (App.prevMoveCount >= 0 && n > App.prevMoveCount) {
    const last = v.moves[n - 1];
    if (v.inCheck) {
      sfx.check();
      if (v.inCheck === v.you && App.mode === 'online') toast('Bạn đang bị CHIẾU TƯỚNG!', 'bad');
      else toast('Chiếu tướng!', 'warn');
    } else if (last && (last.cap || /ăn/.test(last.text) || (v.lastMove && !v.lastMove.from))) sfx.capture();
    else sfx.move();
  }
  if (n < App.prevMoveCount) App.ghosts.clear();
  App.prevMoveCount = n;
  App.sel = null; App.targets = [];
  render();
}

/* ================== Màn hình ================== */
function showGame() {
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden');
  $('chatCard').classList.toggle('hidden', App.mode !== 'online');
  $('roomCard').classList.toggle('hidden', false);
}
function goLobby() {
  App.mode = null; App.view = null; App.session = null; App.local = null;
  $('cover').classList.add('hidden');
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
  if (v.lastMove) {
    if (v.lastMove.from) for (const p of [v.lastMove.from, v.lastMove.to]) el('rect', { class: 'last', x: px(p[0]) - 28, y: py(p[1]) - 28, width: 56, height: 56, rx: 6 }, dynLayer);
    else {
      const p = v.lastMove.to;
      el('circle', { class: 'lost', cx: px(p[0]), cy: py(p[1]), r: 26 }, dynLayer);
      const t = el('text', { x: px(p[0]), y: py(p[1]), fill: '#d12f1f', 'font-size': 28, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-weight': 800 }, dynLayer);
      t.textContent = '✕';
    }
  }
  // dấu đoán (chế độ mù)
  if (v.blind && v.status !== 'over') for (const k of App.ghosts) {
    const [x, y] = k.split(',').map(Number); if (v.board[y][x]) continue;
    const g = el('g', { class: 'ghost' }, dynLayer);
    el('circle', { cx: px(x), cy: py(y), r: 24 }, g);
    el('text', { x: px(x), y: py(y) }, g).textContent = '?';
  }
  // quân cờ
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const p = v.board[y][x]; if (!p) continue;
    const sel = App.sel && App.sel[0] === x && App.sel[1] === y;
    const g = el('g', { class: `piece ${p[0]}${sel ? ' sel' : ''}`, transform: `translate(${px(x)},${py(y)})`, filter: 'url(#pshadow)' }, dynLayer);
    el('circle', { class: 'disc', r: 26 }, g);
    el('circle', { class: 'ring', r: 21.5 }, g);
    el('text', { y: 1 }, g).textContent = CHARS[p[0]][p[1]];
    if (v.inCheck && p === v.inCheck + 'K') el('circle', { class: 'checkglow', r: 29 }, g);
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

/* ================== Bảng bên ================== */
function renderBar(barEl, trayEl, c) {
  const v = App.view, p = v.players[c];
  const isTurn = v.status === 'playing' && v.turn === c;
  barEl.className = 'player-bar' + (isTurn ? ' turn' : '');
  let html = `<span class="dot ${c}"></span><span class="pname">${p ? esc(p.name) : '<i>Đang chờ…</i>'}</span><span class="tag">${COLOR_VN[c]}</span>`;
  if (App.mode === 'online' && c === v.you) html += '<span class="tag">Bạn</span>';
  if (App.mode === 'online' && p && !p.online) html += '<span class="tag off">Mất kết nối</span>';
  html += '<span class="spacer"></span>';
  if (isTurn) html += '<span class="tag">⏳ Đang đi</span>';
  barEl.innerHTML = html;
  const caps = v.captured[c] || [];
  trayEl.innerHTML = `<span class="lbl">${COLOR_VN[c]} đã ăn (${caps.length}):</span>` + caps.map((q) => `<span class="mini ${q[0]}">${CHARS[q[0]][q[1]]}</span>`).join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function renderSide() {
  const v = App.view, online = App.mode === 'online';
  const bottom = App.flip ? 'b' : 'r', top = XQ.other(bottom);
  renderBar($('bottomBar'), $('bottomTray'), bottom);
  renderBar($('topBar'), $('topTray'), top);

  $('roomCode').textContent = online ? v.code : 'LOCAL';
  $('copyCode').classList.toggle('hidden', !online);
  $('copyLink').classList.toggle('hidden', !online);
  const badges = [];
  badges.push(v.blind ? '<span class="badge blind">🙈 Cờ mù</span>' : '<span class="badge">👁 Thường</span>');
  badges.push(online ? '<span class="badge">🌐 Online</span>' : '<span class="badge">👥 Cùng máy</span>');
  if (online) badges.push(`<span class="badge">Bạn: ${COLOR_VN[v.you]}</span>`);
  if (online && v.gameNo > 1) badges.push(`<span class="badge">Ván ${v.gameNo}</span>`);
  $('badges').innerHTML = badges.join('');

  // trạng thái
  const st = $('status'); let txt = '', cls = 'status';
  if (v.status === 'waiting') txt = `⏳ Đang chờ đối thủ… Gửi mã phòng ${v.code} cho bạn bè`;
  else if (v.status === 'over') {
    const r = v.result, reason = XQ.REASON_VN[r.reason] || r.reason;
    if (!r.winner) txt = `🤝 Hoà – ${reason}`;
    else if (online) { const win = r.winner === v.you; txt = (win ? '🏆 Bạn thắng' : '💀 Bạn thua') + ` – ${reason}`; cls += win ? ' good' : ' bad'; }
    else { txt = `🏆 ${COLOR_VN[r.winner]} thắng – ${reason}`; cls += ' good'; }
  } else if (online) {
    if (v.inCheck === v.you) { txt = '⚠️ Bạn đang bị CHIẾU! Đến lượt bạn'; cls += ' check'; }
    else if (v.turn === v.you) txt = `▶ Đến lượt bạn (${COLOR_VN[v.you]})`;
    else if (v.inCheck) txt = '🎯 Bạn đang chiếu tướng! Chờ đối thủ…';
    else txt = '⌛ Đối thủ đang suy nghĩ…';
  } else {
    if (v.inCheck) { txt = `⚠️ ${COLOR_VN[v.turn]} đang bị CHIẾU!`; cls += ' check'; }
    else txt = `▶ Lượt ${COLOR_VN[v.turn]}`;
  }
  st.className = cls; st.textContent = txt;

  // nút
  const playing = v.status === 'playing';
  $('swapBtn').classList.toggle('hidden', !(online && v.isHost && (v.status === 'waiting' || (playing && v.moves.length === 0))));
  $('drawBtn').classList.toggle('hidden', !playing);
  $('drawBtn').disabled = online && v.drawOffer === v.you;
  $('drawBtn').textContent = online && v.drawOffer === v.you ? '🤝 Đã cầu hoà…' : '🤝 Cầu hoà';
  $('resignBtn').classList.toggle('hidden', !playing);
  $('undoBtn').classList.toggle('hidden', !(App.mode === 'local' && v.moves.length > 0));
  $('rematchBtn').classList.toggle('hidden', v.status !== 'over');
  const waitingRematch = online && v.rematch && v.rematch[v.you];
  $('rematchBtn').disabled = !!waitingRematch;
  $('rematchBtn').textContent = waitingRematch ? '⏳ Chờ đối thủ…' : (online ? '♻ Ván mới (đổi màu)' : '♻ Ván mới');
  $('drawOffer').classList.toggle('hidden', !(online && playing && v.drawOffer && v.drawOffer !== v.you));

  // danh sách nước đi
  const ol = $('moves'); let html = '';
  for (let i = 0; i < v.moves.length; i += 2) {
    const a = v.moves[i], b = v.moves[i + 1];
    const cell = (m) => m ? `<span class="mv ${m.side}${m.hidden ? ' hid' : ''}">${esc(m.text)}${m.check ? ' +' : ''}</span>` : '';
    html += `<li>${cell(a)}${cell(b)}</li>`;
  }
  ol.innerHTML = html;
  ol.scrollTop = ol.scrollHeight;
}

/* ================== Tương tác bàn cờ ================== */
function canAct() {
  const v = App.view;
  if (!v || v.status !== 'playing') return false;
  if (App.mode === 'local') return !App.local.coverFor;
  return v.turn === v.you;
}
function onSquare(x, y) {
  const v = App.view; if (!v) return;
  if (!canAct()) {
    if (v.status === 'waiting') toast('Đang chờ đối thủ vào phòng');
    else if (v.status === 'playing' && App.mode === 'online') toast('Chưa tới lượt bạn');
    return;
  }
  const me = App.mode === 'online' ? v.you : v.turn;
  const p = v.board[y][x];
  if (App.sel && App.targets.some(([a, b]) => a === x && b === y)) {
    const from = App.sel; App.sel = null; App.targets = [];
    App.ghosts.delete(x + ',' + y);
    if (App.mode === 'local') localMove(from, [x, y]);
    else { send({ t: 'move', from, to: [x, y] }); render(); }
    return;
  }
  if (p && p[0] === me) {
    if (App.sel && App.sel[0] === x && App.sel[1] === y) { App.sel = null; App.targets = []; }
    else {
      App.sel = [x, y];
      App.targets = v.blind ? XQ.blindTargets(v.board, x, y) : XQ.legalMovesFrom(v.board, x, y);
      if (!v.blind && App.targets.length === 0) toast('Quân này không có nước đi hợp lệ', 'warn');
    }
  } else { App.sel = null; App.targets = []; }
  render();
}
function toggleGhost(x, y) {
  const v = App.view;
  if (!v || !v.blind || v.status === 'over' || v.board[y][x]) return;
  const k = x + ',' + y;
  if (App.ghosts.has(k)) App.ghosts.delete(k); else App.ghosts.add(k);
  render();
}
const sqFromEvent = (e) => {
  const t = e.target.closest && e.target.closest('.sq');
  return t ? [Number(t.dataset.x), Number(t.dataset.y)] : null;
};
let pressTimer = null, longPressed = false;
svg.addEventListener('click', (e) => {
  if (longPressed) { longPressed = false; return; }
  const s = sqFromEvent(e); if (s) onSquare(s[0], s[1]);
});
svg.addEventListener('contextmenu', (e) => { e.preventDefault(); const s = sqFromEvent(e); if (s) toggleGhost(s[0], s[1]); });
svg.addEventListener('touchstart', (e) => {
  const s = sqFromEvent(e); if (!s) return;
  longPressed = false;
  pressTimer = setTimeout(() => { longPressed = true; toggleGhost(s[0], s[1]); }, 550);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((ev) => svg.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));

/* ================== Nút bấm ================== */
function segInit(id, key, onChange) {
  $(id).querySelectorAll('button').forEach((b) => b.onclick = () => {
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    App.createOpts[key] = b.dataset.v; onChange && onChange(b.dataset.v);
  });
}
segInit('colorSeg', 'color');
segInit('modeSeg', 'mode', (v) => {
  $('modeHint').textContent = v === 'blind'
    ? 'Cờ mù: mỗi bên chỉ thấy quân mình, quân địch ẩn cho tới khi bị bắt.'
    : 'Hai bên thấy toàn bộ bàn cờ.';
});
const getName = () => { const n = $('nameInput').value.trim(); localStorage.setItem('xq-name', n); return n; };
$('nameInput').value = localStorage.getItem('xq-name') || '';
$('createBtn').onclick = () => send({ t: 'create', name: getName(), color: App.createOpts.color, blind: App.createOpts.mode === 'blind' });
$('joinBtn').onclick = () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 4) return toast('Nhập mã phòng (5 ký tự)', 'warn');
  send({ t: 'join', code, name: getName() });
};
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('localBtn').onclick = () => startLocal(false);
$('localBlindBtn').onclick = () => startLocal(true);

$('flipBtn').onclick = () => { App.userFlip = true; App.flip = !App.flip; render(); };
$('swapBtn').onclick = () => send({ t: 'swap' });
$('resignBtn').onclick = () => {
  if (!confirm('Bạn chắc chắn muốn đầu hàng?')) return;
  if (App.mode === 'online') send({ t: 'resign' });
  else { const g = App.local.game; g.resign(g.turn); refreshLocal(); modal(`${COLOR_VN[g.result.winner]} THẮNG! (Đầu hàng)`, 'good'); }
};
$('drawBtn').onclick = () => {
  if (App.mode === 'online') { send({ t: 'offerDraw' }); toast('Đã gửi lời cầu hoà'); }
  else if (confirm('Hai bên đồng ý hoà?')) { App.local.game.draw(); refreshLocal(); modal('Hoà!'); }
};
$('acceptDraw').onclick = () => send({ t: 'acceptDraw' });
$('declineDraw').onclick = () => send({ t: 'declineDraw' });
$('undoBtn').onclick = () => {
  const L = App.local; if (!L) return;
  const hist = L.game.history.slice(0, -1);
  const g = new XQ.Game();
  for (const m of hist) g.move(m.from, m.to);
  L.game = g; L.coverFor = L.blind ? g.turn : null;
  App.prevMoveCount = hist.length; refreshLocal();
};
$('rematchBtn').onclick = () => {
  if (App.mode === 'online') send({ t: 'rematch' });
  else startLocal(App.local.blind);
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
