# Cờ Tướng Online · Cờ Úp

Game cờ tướng chạy trên trình duyệt: chơi online qua mã phòng (WebSocket), **chơi với máy** (3 mức độ), chơi 2 người 1 máy, có **cờ tướng thường** và **cờ úp** (quân xáo trộn, úp mặt).

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

### Chơi với máy
- Ở sảnh, mục **🤖 Chơi với máy**: chọn chế độ (Thường / Cờ úp), độ khó (**Dễ / Trung bình / Khó**) và màu quân (Đỏ / Đen / Ngẫu nhiên) → *Bắt đầu*. Cầm Đen thì máy đi trước (Đỏ luôn đi trước).
- Trong ván: *Đi lại* (lùi nước của máy + nước của bạn), *💡 Gợi ý* (máy mức Trung bình đề xuất một nước, tô vàng trên bàn), *Đầu hàng*, *Ván mới* (giữ nguyên cài đặt; chọn Ngẫu nhiên thì bốc lại màu), *Xoay bàn*.
- Máy chạy **ngay trong trình duyệt, trong Web Worker** (`public/ai-worker.js`) nên giao diện không bị đơ khi máy nghĩ (hiện “🤖 Máy đang nghĩ…”), và máy chủ không phải tính gì – gói Render miễn phí không tốn thêm tài nguyên. Dưới ô trạng thái có dòng nhỏ cho biết máy đã tính sâu bao nhiêu nước.
- Độ khó:
  - **Dễ**: chỉ nhìn 1 nước (+ xét các nước ăn quân tiếp theo), cộng nhiễu ngẫu nhiên lớn và ~15% số nước đi bừa – hợp cho người mới.
  - **Trung bình**: tìm kiếm alpha-beta sâu 4 nước (+ quiescence, gia hạn khi bị chiếu), tối đa 0,8 giây.
  - **Khó**: iterative deepening, tối đa ~1,5 giây mỗi nước (thường 0,7–1,5 giây, sâu 9–13 nước), bảng chuyển vị Zobrist, null-move, LMR, sắp xếp nước (TT / MVV-LVA / killer / history), bảng điểm vị trí cho từng loại quân.
  - Trung bình/Khó có sách khai cuộc nhỏ cho nước đầu (cờ thường) để các ván không giống hệt nhau. Máy tránh/tìm hoà do lặp thế dựa trên lịch sử ván.
- **Cờ úp với máy – công bằng**: máy **không biết** quân úp nào là quân gì, kể cả quân của chính nó. Máy chỉ nhận bàn cờ đã che (`rC?` = quân úp Đỏ đứng ở ô Pháo), giá trị một quân úp được tính bằng **trung bình giá trị các quân chưa lộ** của bên đó (15 quân ban đầu − quân đã lật − quân đã bị ăn), và chỉ dùng danh tính thật sau khi quân đã lật trên bàn. Trong cây tìm kiếm, quân úp vừa đi được coi là “đã lật nhưng chưa biết” (giữ giá trị kỳ vọng, không tính nước đi tiếp của nó). Có kiểm thử: hai thế cờ chỉ khác danh tính quân úp luôn cho cùng một nước đi.
  - Lưu ý: khi chơi với máy, ván cờ chạy hoàn toàn trên trình duyệt, nên danh tính quân úp nằm trong bộ nhớ trình duyệt (luồng giao diện, không gửi cho máy). Người rành code vẫn có thể soi được, và *Đi lại* sau khi lật quân sẽ cho bạn biết quân đó là gì – đây là chế độ luyện tập, muốn chống gian lận tuyệt đối hãy chơi online.

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
`npm test` – kiểm tra luật (perft 44/1920/79666), máy (bộ sinh nước của máy khớp luật; luôn đi nước hợp lệ ở cả 3 mức trên nhiều thế cờ ngẫu nhiên thường + cờ úp; Trung bình/Khó luôn thấy chiếu bí 1 nước; cờ úp: hai thế chỉ khác danh tính quân úp cho cùng nước đi với cùng seed; Khó dừng đúng giới hạn thời gian), luật cờ úp (xáo trộn hợp lệ, quân úp đi theo vị trí, lật khi đi, ăn quân úp lộ danh tính, Sĩ/Tượng đã lật qua sông, client tính đúng nước đi dù không biết danh tính) và luồng online (tạo/vào phòng, không lộ danh tính quân úp qua mạng, chiếu hết, đầu hàng, cầu hoà, đảo màu, kết nối lại).

## Cấu trúc
- `server.js` – HTTP tĩnh + WebSocket, quản lý phòng (bộ nhớ RAM, không DB).
- `public/rules.js` – luật cờ (thường + cờ úp), dùng chung server & trình duyệt.
- `public/ai.js` – máy chơi cờ (tìm kiếm alpha-beta), chạy được trong Web Worker và Node; `public/ai-worker.js` – Web Worker.
- `public/index.html`, `style.css`, `app.js` – giao diện.

## Giới hạn
- Chưa có luật cấm “trường chiếu / trường bắt” (chiếu dai) theo luật thi đấu – chỉ xử hoà khi lặp thế 3 lần.
- Không có đồng hồ thi đấu; phòng lưu trong RAM (khởi động lại server là mất phòng).
- Không có chế độ khán giả.
- Máy là engine tự viết, đơn giản (không có sách khai cuộc lớn, không có cơ sở dữ liệu tàn cuộc, đánh giá thế cờ chỉ gồm giá trị quân + vị trí): mức Khó đủ mạnh với người chơi phong trào nhưng còn kém xa các engine chuyên nghiệp (Pikafish…). Thời gian nghĩ phụ thuộc tốc độ máy của người chơi.
- Cờ úp: máy không đoán quân úp sau khi lật trong cây tìm kiếm (coi là quân chưa biết, không đi tiếp), nên tính toán ở cờ úp nông và “may rủi” hơn cờ thường.
- Cờ úp chơi cùng máy: danh tính quân úp nằm trong bộ nhớ trình duyệt (ẩn khỏi giao diện, nhưng người rành code vẫn xem được) – muốn chống gian lận tuyệt đối hãy chơi online.
