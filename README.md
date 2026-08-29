# V-Connect

V-Connect là nền tảng học trực tuyến dùng Node.js, Express, Handlebars và MongoDB. Người học có thể khám phá khóa học, theo dõi tiến độ, ghi chú và tiếp tục bài đang học; người tạo nội dung có khu vực quản lý riêng.

## Chạy trên máy cá nhân

Yêu cầu: Node.js 20+ và MongoDB.

```bash
npm ci
cp .env.example .env
npm run build
npm run dev
```

Điền tối thiểu `MONGODB_URI`, `JWT_SECRET` và `CSRF_SECRET` trong `.env`. Không commit tệp `.env` hoặc khóa bí mật lên GitHub.

## Kiểm tra trước khi triển khai

```bash
npm test
npm audit --omit=dev
```

`npm test` build CSS, kiểm tra cú pháp JavaScript và biên dịch thử toàn bộ template Handlebars.

## Cấu hình production

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check: `/healthz`
- Readiness check: `/readyz`
- Runtime: đặt `NODE_ENV=production`
- Secrets bắt buộc: `MONGODB_URI`, `JWT_SECRET`, `CSRF_SECRET`
- CORS: đặt `CORS_ORIGINS` thành domain HTTPS thật của ứng dụng; không dùng `*` ở production

Ứng dụng chỉ bắt đầu nhận request sau khi kết nối MongoDB thành công và hỗ trợ tắt tiến trình an toàn trên nền tảng hosting.

## Tạo tài khoản quản trị đầu tiên

Sau khi cấu hình các biến `ADMIN_NAME`, `ADMIN_USERNAME`, `ADMIN_EMAIL` và `ADMIN_PASSWORD`:

```bash
npm run create-admin
```
