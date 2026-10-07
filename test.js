/* Kiểm thử tự động: luật + luồng online (chạy: npm test) */
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const XQ = require('./public/rules.js');

// ---- 1. Luật ----
function perft(b, c, d) { if (!d) return 1; let n = 0; for (const m of XQ.allLegalMoves(b, c)) n += perft(XQ.applyMove(b, m.from, m.to), XQ.other(c), d - 1); return n; }
const b0 = XQ.initialBoard();
assert.deepStrictEqual([perft(b0, 'r', 1), perft(b0, 'r', 2), perft(b0, 'r', 3)], [44, 1920, 79666]);
const empty = () => Array.from({ length: 10 }, () => Array(9).fill(null));
// chiếu hết bằng 2 xe
let g = new XQ.Game(); let b = empty();
b[0][3] = 'bK'; b[9][5] = 'rK'; b[1][0] = 'rR'; b[5][8] = 'rR'; g.board = b;
assert.ok(g.move([8, 5], [8, 0]).ok); assert.strictEqual(g.status, 'over'); assert.deepStrictEqual(g.result, { winner: 'r', reason: 'checkmate' });
// cấm lộ mặt tướng
b = empty(); b[0][4] = 'bK'; b[9][3] = 'rK'; b[0][0] = 'bR';
assert.ok(!XQ.isLegal(b, 'r', [3, 9], [4, 9]), 'không được đối mặt tướng');
b = empty(); b[0][4] = 'bK'; b[9][4] = 'rK'; b[5][4] = 'rN';
assert.ok(!XQ.isLegal(b, 'r', [4, 5], [2, 4]), 'mã ghim không được rời cột');
// tượng không qua sông, sĩ trong cung, tốt chưa qua sông không đi ngang
assert.ok(!XQ.pseudoMoves((() => { const q = empty(); q[5][2] = 'rB'; return q; })(), 2, 5).some(([x, y]) => y < 5));
assert.deepStrictEqual(XQ.pseudoMoves((() => { const q = empty(); q[6][4] = 'rP'; return q; })(), 4, 6), [[4, 5]]);
assert.strictEqual(XQ.pseudoMoves((() => { const q = empty(); q[4][4] = 'rP'; return q; })(), 4, 4).length, 3);
// ký hiệu
assert.strictEqual(XQ.notation(b0, [7, 7], [4, 7]), 'P2-5');
assert.strictEqual(XQ.notation(b0, [7, 9], [6, 7]), 'M2.3');
assert.strictEqual(XQ.notation(b0, [1, 0], [2, 2]), 'M2.3');
console.log('✓ Luật cờ OK');

// ---- 2. Online ----
const PORT = 3999;
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, XQ_TEST: '1' }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const c = { ws, msgs: [], state: null, send: (o) => ws.send(JSON.stringify(o)) };
    c.wait = (pred, ms = 2000) => new Promise((ok, bad) => {
      const t0 = Date.now();
      (function poll() { const m = c.msgs.find(pred); if (m) { c.msgs.splice(c.msgs.indexOf(m), 1); return ok(m); } if (Date.now() - t0 > ms) return bad(new Error('timeout')); setTimeout(poll, 20); })();
    });
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'state') c.state = m; c.msgs.push(m); });
    ws.on('open', () => res(c));
  });
}
const count = (board, color) => board.flat().filter((p) => p && p[0] === color).length;

(async () => {
  await sleep(500);
  try {
    // phòng mù
    const A = await client(), B = await client();
    A.send({ t: 'create', name: 'An', color: 'r', blind: true });
    const j = await A.wait((m) => m.t === 'joined');
    B.send({ t: 'join', code: j.code, name: 'Bình' });
    const jb = await B.wait((m) => m.t === 'joined'); assert.strictEqual(jb.color, 'b');
    await sleep(150);
    assert.strictEqual(A.state.status, 'playing');
    assert.strictEqual(count(A.state.board, 'r'), 16); assert.strictEqual(count(A.state.board, 'b'), 0, 'Đỏ không thấy quân Đen');
    assert.strictEqual(count(B.state.board, 'b'), 16); assert.strictEqual(count(B.state.board, 'r'), 0, 'Đen không thấy quân Đỏ');
    // đi sai lượt
    B.send({ t: 'move', from: [0, 3], to: [0, 4] }); await B.wait((m) => m.t === 'illegal');
    // pháo đỏ (7,7) ăn mã đen (7,0)
    A.send({ t: 'move', from: [7, 7], to: [7, 0] }); await sleep(150);
    assert.deepStrictEqual(A.state.captured.r, ['bN']);
    assert.strictEqual(B.state.moves[0].hidden, true, 'Đen không thấy ký hiệu nước của Đỏ');
    assert.deepStrictEqual(B.state.lastMove, { to: [7, 0] }, 'Đen chỉ biết ô bị ăn');
    assert.strictEqual(count(B.state.board, 'r'), 0);
    // xe đen (8,0) ăn lại pháo
    B.send({ t: 'move', from: [8, 0], to: [7, 0] }); await sleep(150);
    assert.deepStrictEqual(B.state.captured.b, ['rC']);
    // nước bị quân ẩn chặn: xe đỏ (0,9) lên (0,2) bị tốt đen (0,3) chặn
    A.send({ t: 'move', from: [0, 9], to: [0, 2] }); await A.wait((m) => m.t === 'illegal');
    // đầu hàng
    A.send({ t: 'resign' });
    await A.wait((m) => m.t === 'gameover'); await sleep(100);
    assert.strictEqual(A.state.status, 'over'); assert.strictEqual(A.state.result.winner, 'b'); assert.strictEqual(A.state.result.reason, 'resign');
    assert.strictEqual(count(A.state.board, 'b'), 15, 'Hết ván lộ toàn bộ bàn');
    // ván mới (đổi màu)
    A.send({ t: 'rematch' }); B.send({ t: 'rematch' }); await sleep(200);
    assert.strictEqual(A.state.you, 'b'); assert.strictEqual(B.state.you, 'r'); assert.strictEqual(A.state.gameNo, 2);
    // cầu hoà
    B.send({ t: 'offerDraw' }); await sleep(100); assert.strictEqual(A.state.drawOffer, 'r');
    A.send({ t: 'acceptDraw' }); await sleep(150);
    assert.strictEqual(B.state.result.reason, 'agreed');
    console.log('✓ Phòng mù, ẩn quân, validate server, đầu hàng, ván mới, cầu hoà OK');

    // phòng thường + chiếu hết + đảo màu + reconnect
    const C = await client(), D = await client();
    C.send({ t: 'create', name: 'Cường', color: 'r', blind: false });
    const jc = await C.wait((m) => m.t === 'joined');
    C.send({ t: 'swap' }); await C.wait((m) => m.t === 'joined' && m.color === 'b');
    D.send({ t: 'join', code: jc.code }); const jd = await D.wait((m) => m.t === 'joined'); assert.strictEqual(jd.color, 'r');
    await sleep(100);
    assert.strictEqual(count(C.state.board, 'r'), 16, 'chế độ thường thấy hết');
    D.ws.close(); await sleep(150);
    assert.strictEqual(C.state.players.r.online, false);
    const D2 = await client(); D2.send({ t: 'resume', code: jc.code, token: jd.token });
    await D2.wait((m) => m.t === 'joined'); await sleep(100); assert.strictEqual(C.state.players.r.online, true);
    b = empty(); b[0][3] = 'bK'; b[9][5] = 'rK'; b[1][0] = 'rR'; b[5][8] = 'rR';
    D2.send({ t: 'debugSetBoard', board: b, turn: 'r' }); await sleep(100);
    D2.send({ t: 'move', from: [8, 5], to: [8, 0] });
    const go = await D2.wait((m) => m.t === 'gameover'); assert.match(go.msg, /THẮNG/);
    const gc = await C.wait((m) => m.t === 'gameover'); assert.match(gc.msg, /thua/);
    console.log('✓ Phòng thường, đảo màu, kết nối lại, chiếu hết OK');
    console.log('\nTẤT CẢ KIỂM THỬ ĐỀU QUA');
    process.exitCode = 0;
  } catch (e) { console.error('✗ LỖI:', e); process.exitCode = 1; }
  srv.kill(); process.exit();
})();
