/* Cờ tướng online – server Node (HTTP tĩnh + WebSocket). Không cần DB. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const XQ = require('./public/rules.js');

const PORT = Number(process.env.PORT) || 3847;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ===== Phòng chơi ===== */
const rooms = new Map(); // code -> room
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const newToken = () => crypto.randomBytes(16).toString('hex');
const cleanName = (s, def) => (String(s || '').replace(/[<>]/g, '').trim().slice(0, 20) || def);

const newGame = (variant) => new XQ.Game({ variant, rand: (n) => crypto.randomInt(n) });

function createRoom(opts) {
  const variant = opts.variant === 'up' ? 'up' : 'normal';
  const room = {
    code: newCode(), variant, game: newGame(variant),
    seats: { r: null, b: null }, // {token, name, ws}
    hostColor: null, started: false, drawOffer: null, rematch: { r: false, b: false },
    chat: [], lastActive: Date.now(), gameNo: 1,
  };
  rooms.set(room.code, room);
  return room;
}

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

/* Tạo "góc nhìn" cho từng người. Cờ úp: danh tính quân úp CHỈ nằm ở server –
 * client nhận 'rC?' (màu + loại theo ô đứng) cho tới khi quân được lật hoặc bị ăn. */
function viewFor(room, color) {
  const g = room.game;
  const over = g.status === 'over';
  const board = over ? g.board : XQ.publicBoard(g.board); // hết ván: lộ toàn bộ quân còn úp
  const moves = g.history.map((m) => ({ side: m.side, text: m.text, check: m.check, cap: !!m.captured, flip: !!m.revealed }));
  const lm = g.history[g.history.length - 1];
  const lastMove = lm ? { from: lm.from, to: lm.to } : null;
  const seat = (c) => room.seats[c] ? { name: room.seats[c].name, online: !!(room.seats[c].ws && room.seats[c].ws.readyState === 1) } : null;
  return {
    t: 'state', code: room.code, you: color, variant: room.variant, started: room.started, gameNo: room.gameNo,
    isHost: room.seats[color] && room.hostColor === color,
    players: { r: seat('r'), b: seat('b') },
    board, turn: g.turn, moves, lastMove,
    captured: g.captured, // quân bị mỗi bên ăn (đã lộ danh tính)
    inCheck: g.status === 'playing' && XQ.inCheck(g.board, g.turn) ? g.turn : null,
    status: !room.started ? 'waiting' : g.status, result: g.result,
    drawOffer: room.drawOffer, rematch: room.rematch,
  };
}

function broadcast(room) {
  for (const c of ['r', 'b']) { const s = room.seats[c]; if (s && s.ws) send(s.ws, viewFor(room, c)); }
}
function notify(room, msg, kind = 'info') {
  for (const c of ['r', 'b']) { const s = room.seats[c]; if (s && s.ws) send(s.ws, { t: 'toast', msg, kind }); }
}
const COLOR_VN = { r: 'Đỏ', b: 'Đen' };

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(ws, msg); } catch (e) { console.error(e); send(ws, { t: 'error', msg: 'Lỗi máy chủ' }); }
  });
  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    const s = room.seats[ws.color];
    if (s && s.ws === ws) { s.ws = null; broadcast(room); }
  });
});

function seatIn(room, color, name, ws) {
  const token = newToken();
  room.seats[color] = { token, name, ws };
  ws.room = room.code; ws.color = color;
  return token;
}

function handle(ws, msg) {
  if (msg.t === 'create') {
    const room = createRoom({ variant: msg.variant });
    let color = msg.color === 'b' ? 'b' : msg.color === 'r' ? 'r' : (crypto.randomInt(2) ? 'r' : 'b');
    room.hostColor = color;
    const token = seatIn(room, color, cleanName(msg.name, 'Chủ phòng'), ws);
    send(ws, { t: 'joined', code: room.code, token, color });
    broadcast(room);
    return;
  }
  if (msg.t === 'join') {
    const code = String(msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', msg: `Không tìm thấy phòng "${code}"` });
    const free = !room.seats.r ? 'r' : !room.seats.b ? 'b' : null;
    if (!free) return send(ws, { t: 'error', msg: 'Phòng đã đủ 2 người' });
    if (room.game.history.length > 0 || room.game.status === 'over') { room.game = newGame(room.variant); room.drawOffer = null; room.rematch = { r: false, b: false }; }
    const token = seatIn(room, free, cleanName(msg.name, 'Khách'), ws);
    if (!room.hostColor || !room.seats[room.hostColor]) room.hostColor = XQ.other(free);
    room.started = true; room.lastActive = Date.now();
    send(ws, { t: 'joined', code: room.code, token, color: free });
    notify(room, `${room.seats[free].name} đã vào phòng – ván cờ bắt đầu! Đỏ đi trước.`, 'good');
    broadcast(room);
    return;
  }
  if (msg.t === 'resume') {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'resumeFail', msg: 'Phòng không còn tồn tại' });
    const color = ['r', 'b'].find((c) => room.seats[c] && room.seats[c].token === msg.token);
    if (!color) return send(ws, { t: 'resumeFail', msg: 'Không thể vào lại phòng' });
    const old = room.seats[color].ws;
    room.seats[color].ws = ws; ws.room = room.code; ws.color = color;
    if (old && old !== ws) { old.room = null; try { old.close(); } catch {} }
    send(ws, { t: 'joined', code: room.code, token: msg.token, color });
    broadcast(room);
    return;
  }

  // các lệnh trong phòng
  const room = ws.room && rooms.get(ws.room);
  if (!room) return send(ws, { t: 'error', msg: 'Bạn chưa ở trong phòng' });
  const me = ws.color, opp = XQ.other(me), g = room.game;
  room.lastActive = Date.now();

  switch (msg.t) {
    case 'move': {
      if (!room.started) return send(ws, { t: 'error', msg: 'Đang chờ đối thủ vào phòng' });
      const r = g.move(msg.from, msg.to, me);
      if (!r.ok) return send(ws, { t: 'illegal', msg: r.error });
      room.drawOffer = null;
      broadcast(room);
      if (g.status === 'over') announceEnd(room);
      return;
    }
    case 'resign':
      if (g.status !== 'playing' || !room.started) return;
      g.resign(me); broadcast(room); announceEnd(room); return;
    case 'offerDraw':
      if (g.status !== 'playing' || !room.started) return;
      if (room.drawOffer === opp) { g.draw(); room.drawOffer = null; broadcast(room); announceEnd(room); return; }
      room.drawOffer = me; broadcast(room);
      send(room.seats[opp] && room.seats[opp].ws, { t: 'toast', msg: 'Đối thủ cầu hoà', kind: 'info' });
      return;
    case 'acceptDraw':
      if (room.drawOffer === opp && g.status === 'playing') { g.draw(); room.drawOffer = null; broadcast(room); announceEnd(room); }
      return;
    case 'declineDraw':
      if (room.drawOffer === opp) {
        room.drawOffer = null; broadcast(room);
        send(room.seats[opp] && room.seats[opp].ws, { t: 'toast', msg: 'Đối thủ từ chối hoà', kind: 'warn' });
      }
      return;
    case 'swap': { // Đảo màu: chỉ trước khi có nước đi đầu tiên
      if (g.history.length > 0 && g.status === 'playing') return send(ws, { t: 'error', msg: 'Chỉ đảo màu được trước nước đi đầu tiên' });
      if (g.status === 'over') return send(ws, { t: 'error', msg: 'Hãy dùng "Ván mới" (tự đảo màu)' });
      if (room.hostColor !== me) return send(ws, { t: 'error', msg: 'Chỉ chủ phòng được đảo màu' });
      swapSeats(room);
      notify(room, 'Đã đảo màu hai bên', 'info');
      broadcast(room);
      return;
    }
    case 'rematch': {
      if (g.status !== 'over') return;
      room.rematch[me] = true;
      if (room.rematch.r && room.rematch.b) {
        swapSeats(room);
        room.game = newGame(room.variant); room.drawOffer = null; room.rematch = { r: false, b: false }; room.gameNo++;
        notify(room, `Ván ${room.gameNo} bắt đầu – hai bên đã đổi màu`, 'good');
      } else {
        send(room.seats[opp] && room.seats[opp].ws, { t: 'toast', msg: 'Đối thủ muốn chơi ván mới', kind: 'info' });
      }
      broadcast(room);
      return;
    }
    case 'debugSetBoard': { // chỉ dùng khi chạy test (XQ_TEST=1)
      if (process.env.XQ_TEST !== '1') return;
      g.board = msg.board; g.turn = msg.turn || 'r'; broadcast(room); return;
    }
    case 'chat': {
      const text = String(msg.text || '').slice(0, 200).trim();
      if (!text) return;
      const item = { t: 'chat', from: room.seats[me].name, color: me, text };
      for (const c of ['r', 'b']) send(room.seats[c] && room.seats[c].ws, item);
      return;
    }
    case 'leave': {
      if (room.started && g.status === 'playing' && room.seats[opp]) { g.resign(me); broadcast(room); announceEnd(room); }
      room.seats[me] = null; ws.room = null;
      if (room.hostColor === me) room.hostColor = opp;
      room.started = false; // chờ người mới vào
      if (room.seats[opp]) { notify(room, 'Đối thủ đã rời phòng', 'warn'); broadcast(room); }
      if (!room.seats.r && !room.seats.b) rooms.delete(room.code);
      return;
    }
  }
}

function swapSeats(room) {
  const { r, b } = room.seats;
  room.seats = { r: b, b: r };
  room.hostColor = XQ.other(room.hostColor);
  for (const c of ['r', 'b']) if (room.seats[c] && room.seats[c].ws) room.seats[c].ws.color = c;
  for (const c of ['r', 'b']) if (room.seats[c] && room.seats[c].ws) send(room.seats[c].ws, { t: 'joined', code: room.code, token: room.seats[c].token, color: c });
}

function announceEnd(room) {
  const res = room.game.result; if (!res) return;
  for (const c of ['r', 'b']) {
    const s = room.seats[c]; if (!s || !s.ws) continue;
    const reason = XQ.REASON_VN[res.reason] || res.reason;
    let msg, kind;
    if (!res.winner) { msg = `Hoà! (${reason})`; kind = 'info'; }
    else if (res.winner === c) { msg = `Bạn THẮNG! (${reason})`; kind = 'good'; }
    else { msg = `Bạn thua (${reason})`; kind = 'bad'; }
    send(s.ws, { t: 'gameover', msg, kind });
  }
}

// giữ kết nối + dọn phòng cũ
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch {} }
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyOnline = ['r', 'b'].some((c) => room.seats[c] && room.seats[c].ws && room.seats[c].ws.readyState === 1);
    if (!anyOnline && now - room.lastActive > 2 * 3600 * 1000) rooms.delete(code);
  }
}, 30000);

server.listen(PORT, () => console.log(`Cờ tướng online đang chạy: http://localhost:${PORT}`));
