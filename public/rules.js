/* Luật cờ tướng – dùng chung cho server (Node) và trình duyệt.
 * Toạ độ: board[y][x], x = 0..8 (cột), y = 0..9 (hàng). y=0 là phía Đen (trên), y=9 là phía Đỏ (dưới).
 * Quân: chuỗi 2 ký tự: màu ('r' đỏ | 'b' đen) + loại:
 *   K Tướng, A Sĩ, B Tượng, R Xe, N Mã, C Pháo, P Tốt
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XQ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 9, H = 10;
  const other = (c) => (c === 'r' ? 'b' : 'r');
  const inBoard = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const inPalace = (c, x, y) => x >= 3 && x <= 5 && (c === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
  const ownSide = (c, y) => (c === 'r' ? y >= 5 : y <= 4);
  const fwd = (c) => (c === 'r' ? -1 : 1);

  function initialBoard() {
    const b = Array.from({ length: H }, () => Array(W).fill(null));
    const back = 'RNBAKABNR';
    for (let x = 0; x < W; x++) { b[0][x] = 'b' + back[x]; b[9][x] = 'r' + back[x]; }
    b[2][1] = b[2][7] = 'bC'; b[7][1] = b[7][7] = 'rC';
    for (let x = 0; x < W; x += 2) { b[3][x] = 'bP'; b[6][x] = 'rP'; }
    return b;
  }
  const cloneBoard = (b) => b.map((r) => r.slice());

  /* Nước đi "giả hợp lệ" (chưa xét tự chiếu / lộ mặt tướng) */
  function pseudoMoves(b, x, y) {
    const p = b[y][x]; if (!p) return [];
    const c = p[0], t = p[1], out = [];
    const canLand = (nx, ny) => inBoard(nx, ny) && (!b[ny][nx] || b[ny][nx][0] !== c);
    const push = (nx, ny) => { if (canLand(nx, ny)) out.push([nx, ny]); };
    const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    switch (t) {
      case 'K':
        for (const [dx, dy] of ORTH) { const nx = x + dx, ny = y + dy; if (inPalace(c, nx, ny)) push(nx, ny); }
        break;
      case 'A':
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (inPalace(c, nx, ny)) push(nx, ny); }
        break;
      case 'B':
        for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
          const nx = x + dx, ny = y + dy;
          if (inBoard(nx, ny) && ownSide(c, ny) && !b[y + dy / 2][x + dx / 2]) push(nx, ny);
        }
        break;
      case 'N':
        for (const [dx, dy, lx, ly] of [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (inBoard(nx, ny) && !b[y + ly][x + lx]) push(nx, ny);
        }
        break;
      case 'R':
        for (const [dx, dy] of ORTH) {
          let nx = x + dx, ny = y + dy;
          while (inBoard(nx, ny)) {
            if (!b[ny][nx]) out.push([nx, ny]);
            else { if (b[ny][nx][0] !== c) out.push([nx, ny]); break; }
            nx += dx; ny += dy;
          }
        }
        break;
      case 'C':
        for (const [dx, dy] of ORTH) {
          let nx = x + dx, ny = y + dy, jumped = false;
          while (inBoard(nx, ny)) {
            const q = b[ny][nx];
            if (!jumped) { if (!q) out.push([nx, ny]); else jumped = true; }
            else if (q) { if (q[0] !== c) out.push([nx, ny]); break; }
            nx += dx; ny += dy;
          }
        }
        break;
      case 'P': {
        push(x, y + fwd(c));
        if (!ownSide(c, y)) { push(x + 1, y); push(x - 1, y); }
        break;
      }
    }
    return out;
  }

  function findKing(b, c) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b[y][x] === c + 'K') return [x, y];
    return null;
  }

  function generalsFacing(b) {
    const r = findKing(b, 'r'), k = findKing(b, 'b');
    if (!r || !k || r[0] !== k[0]) return false;
    for (let y = k[1] + 1; y < r[1]; y++) if (b[y][r[0]]) return false;
    return true;
  }

  /* Bên c có đang bị chiếu không (gồm cả lộ mặt tướng) */
  function inCheck(b, c) {
    const kp = findKing(b, c); if (!kp) return true;
    if (generalsFacing(b)) return true;
    const o = other(c);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = b[y][x];
      if (p && p[0] === o && p[1] !== 'K' && p[1] !== 'A' && p[1] !== 'B') {
        for (const [mx, my] of pseudoMoves(b, x, y)) if (mx === kp[0] && my === kp[1]) return true;
      }
    }
    return false;
  }

  function applyMove(b, from, to) {
    const nb = cloneBoard(b);
    nb[to[1]][to[0]] = nb[from[1]][from[0]];
    nb[from[1]][from[0]] = null;
    return nb;
  }

  function legalMovesFrom(b, x, y) {
    const p = b[y][x]; if (!p) return [];
    return pseudoMoves(b, x, y).filter(([nx, ny]) => !inCheck(applyMove(b, [x, y], [nx, ny]), p[0]));
  }

  function allLegalMoves(b, c) {
    const res = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = b[y][x];
      if (p && p[0] === c) for (const to of legalMovesFrom(b, x, y)) res.push({ from: [x, y], to });
    }
    return res;
  }

  function isLegal(b, c, from, to) {
    const p = b[from[1]] && b[from[1]][from[0]];
    if (!p || p[0] !== c) return false;
    return legalMovesFrom(b, from[0], from[1]).some(([x, y]) => x === to[0] && y === to[1]);
  }

  /* Ô "có thể thử" ở chế độ mù: chỉ biết quân mình, quân địch ẩn.
   * Server sẽ quyết định nước có hợp lệ thật hay không. */
  function blindTargets(b, x, y) {
    const p = b[y][x]; if (!p) return [];
    if (p[1] !== 'C') return pseudoMoves(b, x, y);
    const c = p[0], out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = x + dx, ny = y + dy;
      while (inBoard(nx, ny)) { if (!b[ny][nx] || b[ny][nx][0] !== c) out.push([nx, ny]); nx += dx; ny += dy; }
    }
    return out;
  }

  /* ===== Ký hiệu nước đi kiểu Việt Nam: P2-5, M8.7, Xt/1 ... ===== */
  const VN_LETTER = { K: 'Tg', A: 'S', B: 'T', R: 'X', N: 'M', C: 'P', P: 'B' };
  const VN_NAME = { K: 'Tướng', A: 'Sĩ', B: 'Tượng', R: 'Xe', N: 'Mã', C: 'Pháo', P: 'Tốt' };
  const fileNo = (c, x) => (c === 'r' ? 9 - x : x + 1);
  function notation(b, from, to) {
    const p = b[from[1]][from[0]]; if (!p) return '?';
    const c = p[0], t = p[1];
    let id = VN_LETTER[t] + fileNo(c, from[0]);
    // nhiều quân cùng loại trên cùng cột
    const same = [];
    for (let y = 0; y < H; y++) if (b[y][from[0]] === p) same.push(y);
    if (same.length > 1 && t !== 'A' && t !== 'B') {
      same.sort((a, z) => (c === 'r' ? a - z : z - a)); // từ trước ra sau
      const idx = same.indexOf(from[1]);
      const tag = same.length === 2 ? (idx === 0 ? 't' : 's') : String(idx + 1);
      id = VN_LETTER[t] + tag;
    }
    const dy = to[1] - from[1];
    let op, num;
    if (dy === 0) { op = '-'; num = fileNo(c, to[0]); }
    else {
      const forward = (c === 'r' ? dy < 0 : dy > 0);
      op = forward ? '.' : '/';
      num = (t === 'A' || t === 'B' || t === 'N') ? fileNo(c, to[0]) : Math.abs(dy);
    }
    return id + op + num;
  }

  const boardKey = (b, turn) => turn + b.map((r) => r.map((p) => p || '..').join('')).join('');

  /* ===== Ván cờ ===== */
  class Game {
    constructor() { this.reset(); }
    reset() {
      this.board = initialBoard();
      this.turn = 'r';
      this.history = [];             // {side, from, to, piece, captured, text, check}
      this.captured = { r: [], b: [] }; // quân bị bên đó ĂN
      this.status = 'playing';       // playing | over
      this.result = null;            // {winner: 'r'|'b'|null, reason}
      this.noCapture = 0;
      this.positions = { [boardKey(this.board, 'r')]: 1 };
    }
    move(from, to, side) {
      if (this.status !== 'playing') return { ok: false, error: 'Ván cờ đã kết thúc' };
      if (side && side !== this.turn) return { ok: false, error: 'Chưa tới lượt bạn' };
      const valid = (a) => Array.isArray(a) && a.length === 2 && Number.isInteger(a[0]) && Number.isInteger(a[1]) && inBoard(a[0], a[1]);
      if (!valid(from) || !valid(to)) return { ok: false, error: 'Toạ độ không hợp lệ' };
      if (!isLegal(this.board, this.turn, from, to)) return { ok: false, error: 'Nước đi không hợp lệ' };
      const piece = this.board[from[1]][from[0]];
      const captured = this.board[to[1]][to[0]];
      const text = notation(this.board, from, to);
      this.board = applyMove(this.board, from, to);
      const mover = this.turn;
      if (captured) { this.captured[mover].push(captured); this.noCapture = 0; } else this.noCapture++;
      this.turn = other(mover);
      const check = inCheck(this.board, this.turn);
      const rec = { side: mover, from, to, piece, captured, text, check };
      this.history.push(rec);
      // kết thúc?
      const replies = allLegalMoves(this.board, this.turn);
      if (replies.length === 0) {
        this.end(mover, check ? 'checkmate' : 'stalemate');
      } else if (!hasAttackers(this.board)) {
        this.end(null, 'material');
      } else if (this.noCapture >= 120) {
        this.end(null, 'nocapture');
      } else {
        const key = boardKey(this.board, this.turn);
        this.positions[key] = (this.positions[key] || 0) + 1;
        if (this.positions[key] >= 3) this.end(null, 'repetition');
      }
      return { ok: true, move: rec };
    }
    end(winner, reason) { this.status = 'over'; this.result = { winner, reason }; }
    resign(side) { if (this.status === 'playing') this.end(other(side), 'resign'); }
    draw() { if (this.status === 'playing') this.end(null, 'agreed'); }
  }
  function hasAttackers(b) {
    for (const r of b) for (const p of r) if (p && 'RNCP'.includes(p[1])) return true;
    return false;
  }

  const REASON_VN = {
    checkmate: 'Chiếu bí', stalemate: 'Hết nước đi', resign: 'Đầu hàng', agreed: 'Hai bên đồng ý hoà',
    material: 'Không còn quân tấn công', nocapture: '60 nước mỗi bên không ăn quân', repetition: 'Lặp lại thế cờ 3 lần',
    timeout: 'Mất kết nối quá lâu',
  };

  return {
    W, H, other, inBoard, inPalace, initialBoard, cloneBoard, pseudoMoves, legalMovesFrom, allLegalMoves,
    isLegal, inCheck, generalsFacing, applyMove, findKing, notation, blindTargets, Game, VN_NAME, REASON_VN,
  };
});
