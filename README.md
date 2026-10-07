# Cờ Tướng Online · Cờ Úp

Game cờ tướng chạy trên trình duyệt: chơi online qua mã phòng (WebSocket), chơi 2 người 1 máy, có **cờ tướng thường** và **cờ úp** (quân xáo trộn, úp mặt).

## Cách chạy

```bash
cd /workspace/xiangqi-online
npm install      # chỉ cần lần đầu (thư viện ws)
npm start        # hoặc: node server.js
```

Mở trình duyệt: **http://localhost:3847** (đổi cổng: `PORT=4000 npm start`).

Chơi với người khác cùng mạng LAN: mở `http://<IP-máy-chủ>:3847`.

## Cách chơi

- **Tạo phòng**: nhập tên → chọn màu (Đỏ / Đen / Ngẫu nhiên) và chế độ (Thường / Cờ úp) → *Tạo phòng*. Gửi **mã phòng 5 ký tự** hoặc link mời (nút 🔗) cho bạn.
- **Vào phòng**: nhập mã → *Vào phòng*. Ván bắt đầu ngay, Đỏ đi trước.
- Bấm vào quân để xem nước đi (chấm xanh), bấm ô đích để đi.
- **Đảo màu**: chủ phòng đổi màu khi chưa ai đi. **Ván mới** sau khi hết ván sẽ tự đổi màu.
- **Cầu hoà / Đầu hàng / Xoay bàn / Trò chuyện**.
- Mất mạng hay tải lại trang (F5) sẽ tự vào lại đúng phòng, đúng màu.
- **Chơi 2 người 1 máy**: thường hoặc cờ úp, có nút *Đi lại*.

### Cờ úp
- Bàn cờ xếp như cờ tướng thường. Chỉ **Tướng** mỗi bên để ngửa ở vị trí gốc; 15 quân còn lại của mỗi bên được **xáo trộn ngẫu nhiên** vào 15 vị trí xuất phát của bên đó và **úp mặt** (thấy màu, không thấy là quân gì – cả hai người đều không biết).
- Quân úp đi theo **quân gốc của vị trí nó đang đứng**: ô Xe đi như Xe, ô Pháo đi như Pháo (ăn phải có ngòi), ô Mã như Mã (bị cản chân), ô Tượng như Tượng, ô Sĩ như Sĩ (trong cung), ô Tốt như Tốt chưa qua sông.
- Quân úp chỉ đi úp **một lần**: đi xong là **lật ngửa** (có hiệu ứng lật) và từ đó đi theo quân thật. Ký hiệu nước đi ghi kèm quân vừa lật, VD `P2.7 (Tượng)`.
- Quân đã lật đi theo luật thường, **trừ Sĩ và Tượng được đi khắp bàn** (qua sông, ra khỏi cung; Tượng vẫn bị chặn mắt). Tốt chưa qua sông chỉ tiến, qua sông được đi ngang. Tướng vẫn ở trong cung, vẫn cấm lộ mặt tướng. Sĩ/Tượng đã lật cũng có thể chiếu Tướng.
- Ăn quân úp thì quân đó lộ danh tính (hiện ở “… đã ăn”). Chiếu hết, hết nước đi, các luật hoà như cờ thường.
- **Chống gian lận**: danh tính quân úp chỉ nằm trên máy chủ; cả hai người chơi chỉ nhận được “quân úp màu X ở ô Y” cho tới khi quân được lật / bị ăn (không thể soi code để biết trước). Máy chủ kiểm tra mọi nước đi. Hết ván, các quân còn úp được lộ ra (hiện mờ).
- Chế độ 2 người 1 máy cũng có cờ úp: giao diện chỉ hiển thị quân úp dưới dạng mặt lưng cho tới khi lật.

## Luật đã cài đặt
Cờ thường: đầy đủ nước đi 7 loại quân, chân mã, mắt tượng, tượng không qua sông, sĩ/tướng trong cung, tốt qua sông đi ngang, pháo ăn cách 1 quân, **cấm lộ mặt tướng**, không được tự để bị chiếu, **chiếu hết**, **hết nước đi = thua**. Hoà: đồng ý hoà, lặp thế cờ 3 lần, 60 nước mỗi bên không ăn quân, hai bên hết quân tấn công. Ký hiệu nước đi kiểu Việt Nam (`P2-5`, `M8.7`, `Xt/1`…).

## Kiểm thử
`npm test` – kiểm tra luật (perft 44/1920/79666), luật cờ úp (xáo trộn hợp lệ, quân úp đi theo vị trí, lật khi đi, ăn quân úp lộ danh tính, Sĩ/Tượng đã lật qua sông, client tính đúng nước đi dù không biết danh tính) và luồng online (tạo/vào phòng, không lộ danh tính quân úp qua mạng, chiếu hết, đầu hàng, cầu hoà, đảo màu, kết nối lại).

## Cấu trúc
- `server.js` – HTTP tĩnh + WebSocket, quản lý phòng (bộ nhớ RAM, không DB).
- `public/rules.js` – luật cờ (thường + cờ úp), dùng chung server & trình duyệt.
- `public/index.html`, `style.css`, `app.js` – giao diện.

## Giới hạn
- Chưa có luật cấm “trường chiếu / trường bắt” (chiếu dai) theo luật thi đấu – chỉ xử hoà khi lặp thế 3 lần.
- Không có đồng hồ thi đấu; phòng lưu trong RAM (khởi động lại server là mất phòng).
- Không có chế độ khán giả, không có máy (AI).
- Cờ úp chơi cùng máy: danh tính quân úp nằm trong bộ nhớ trình duyệt (ẩn khỏi giao diện, nhưng người rành code vẫn xem được) – muốn chống gian lận tuyệt đối hãy chơi online.
