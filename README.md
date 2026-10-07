# Cờ Tướng Online · Cờ Tướng Mù

Game cờ tướng chạy trên trình duyệt: chơi online qua mã phòng (WebSocket), chơi 2 người 1 máy, và **chế độ cờ mù** (chỉ thấy quân mình).

## Cách chạy

```bash
cd /workspace/xiangqi-online
npm install      # chỉ cần lần đầu (thư viện ws)
npm start        # hoặc: node server.js
```

Mở trình duyệt: **http://localhost:3847** (đổi cổng: `PORT=4000 npm start`).

Chơi với người khác cùng mạng LAN: mở `http://<IP-máy-chủ>:3847`.

## Cách chơi

- **Tạo phòng**: nhập tên → chọn màu (Đỏ / Đen / Ngẫu nhiên) và chế độ (Thường / Cờ mù) → *Tạo phòng*. Gửi **mã phòng 5 ký tự** hoặc link mời (nút 🔗) cho bạn.
- **Vào phòng**: nhập mã → *Vào phòng*. Ván bắt đầu ngay, Đỏ đi trước.
- Bấm vào quân để xem nước đi (chấm xanh), bấm ô đích để đi.
- **Đảo màu**: chủ phòng đổi màu khi chưa ai đi. **Ván mới** sau khi hết ván sẽ tự đổi màu.
- **Cầu hoà / Đầu hàng / Xoay bàn / Trò chuyện**.
- Mất mạng hay tải lại trang (F5) sẽ tự vào lại đúng phòng, đúng màu.
- **Chơi 2 người 1 máy**: thường hoặc mù (màn che khi đổi lượt), có nút *Đi lại*.

### Cờ mù
- Mỗi bên chỉ thấy quân của mình; quân đối phương bị ẩn **ngay từ máy chủ** (client không nhận dữ liệu quân địch → không thể soi code để gian lận).
- Quân địch chỉ lộ diện khi bị bắt (hiện ở “… đã ăn”). Ô quân mình bị ăn được đánh dấu ✕. Nước đi của đối phương hiện là `???`.
- Máy chủ kiểm tra mọi nước đi trên bàn thật: nếu bị quân ẩn chặn hoặc để Tướng bị chiếu → báo “không hợp lệ”, đi lại.
- Chuột phải / nhấn giữ vào ô trống để đặt dấu “?” ghi nhớ vị trí nghi có quân địch.
- Hết ván, toàn bộ bàn cờ được lộ ra.

## Luật đã cài đặt
Đầy đủ nước đi 7 loại quân, chân mã, mắt tượng, tượng không qua sông, sĩ/tướng trong cung, tốt qua sông đi ngang, pháo ăn cách 1 quân, **cấm lộ mặt tướng**, không được tự để bị chiếu, **chiếu hết**, **hết nước đi = thua**. Hoà: đồng ý hoà, lặp thế cờ 3 lần, 60 nước mỗi bên không ăn quân, hai bên hết quân tấn công. Ký hiệu nước đi kiểu Việt Nam (`P2-5`, `M8.7`, `Xt/1`…).

## Kiểm thử
`npm test` – kiểm tra luật (perft 44/1920/79666) và luồng online (tạo/vào phòng, ẩn quân, chiếu hết, đầu hàng, cầu hoà, đảo màu, kết nối lại).

## Cấu trúc
- `server.js` – HTTP tĩnh + WebSocket, quản lý phòng (bộ nhớ RAM, không DB).
- `public/rules.js` – luật cờ, dùng chung server & trình duyệt.
- `public/index.html`, `style.css`, `app.js` – giao diện.

## Giới hạn
- Chưa có luật cấm “trường chiếu / trường bắt” (chiếu dai) theo luật thi đấu – chỉ xử hoà khi lặp thế 3 lần.
- Không có đồng hồ thi đấu; phòng lưu trong RAM (khởi động lại server là mất phòng).
- Không có chế độ khán giả, không có máy (AI).
