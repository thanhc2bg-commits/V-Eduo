---
name: uxtest
description: >-
  Đóng vai một người dùng khó tính, ghét công nghệ để tìm và phân loại các điểm
  nghẽn về UX (UX pain points) trên hệ thống.
---

# uxtest (Adversarial UX Test)

Đóng vai người dùng tồi tệ nhất cho sản phẩm — người ghét công nghệ, không muốn dùng phần mềm của bạn và sẽ tìm mọi lý do để phàn nàn. Sau đó, áp dụng "bộ lọc thực dụng" để tách biệt các vấn đề UX thực sự cần sửa chữa khỏi những lời cằn nhằn vô nghĩa.

## Usage

Sử dụng skill này khi cần kiểm thử giao diện (Front-end), luồng người dùng (user flow) của một tính năng mới hoặc một trang web.

Câu lệnh gợi ý:
- "test UX [URL]"
- "Đóng vai một [loại persona] hay cằn nhằn và test [tên app/tính năng]"

## Steps

1. **Xác định Persona (Chân dung người dùng):** Nếu người dùng không cung cấp, hãy tự tạo một Persona khó tính (Ví dụ: lớn tuổi, ít am hiểu công nghệ, thích làm theo cách thủ công cũ). Trình bày rõ bối cảnh và mục tiêu duy nhất của họ khi dùng app.
2. **Nhập vai và Trải nghiệm:** Hoàn toàn nhập vai vào Persona. Đi qua các luồng công việc cốt lõi (Core workflows) để hoàn thành mục tiêu. Ghi nhận lại số lần click, các thuật ngữ gây bối rối, các lỗi hiển thị hoặc bất cứ thứ gì làm Persona muốn bỏ cuộc.
3. **The Rant (Phản hồi đóng vai):** Viết báo cáo theo đúng giọng điệu bực dọc của Persona. Chia thành: THE GOOD (Điểm tốt hiếm hoi), THE BAD (Lỗi UX thật sự), THE UGLY (Lỗi nghiêm trọng khiến họ bỏ đi) và SPECIFIC COMPLAINTS (Phàn nàn chi tiết kèm trích dẫn lời Persona).
4. **The Pragmatism Filter (Bộ lọc thực dụng - Bắt buộc):** Thoát vai Persona và đánh giá các phàn nàn dưới góc độ phát triển sản phẩm:
   - RED: Lỗi UX thật sự ảnh hưởng đến mọi người dùng -> Cần sửa.
   - YELLOW: Vấn đề có thật nhưng chỉ xảy ra với user cá biệt -> Lưu ý thêm.
   - WHITE: Cằn nhằn do ghét công nghệ -> Bỏ qua, không tạo task.
   - GREEN: Yêu cầu tính năng mới tiềm năng -> Cân nhắc.
5. **Tạo Tickets:** Viết danh sách các ticket/task ngắn gọn, rõ ràng (chỉ dành cho các mục RED và GREEN), bao gồm vấn đề cốt lõi và đề xuất hướng giải quyết.
6. **Báo cáo tổng kết:** Trình bày kết quả theo thứ tự: Persona Rant -> Đánh giá từ Bộ lọc thực dụng -> Danh sách Tickets.