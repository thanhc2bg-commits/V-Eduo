const Certificate = require('../app/models/Certificate');
const Activity = require('../app/models/Activity');

// Phát chứng chỉ cho user khi hoàn thành khóa học.
// - Idempotent: nếu certificate đã tồn tại (userId + courseId) → trả bản cũ, không tạo mới.
// - Race condition: 2 request đồng thời đều pass findOne → unique index { userId, courseId }
//   bắt 1 trong 2 lỗi 11000 → catch → trả bản đã tồn tại.
// - Lỗi ghi Activity KHÔNG hủy việc phát certificate (activity là phụ).
async function issueCertificate(userId, courseId) {
    try {
        // Idempotent: tránh phát trùng nếu race condition
        const existing = await Certificate.findOne({ userId, courseId });
        if (existing) return existing;

        const certificate = await Certificate.create({ userId, courseId });

        try {
            await Activity.create({
                userId,
                type: 'certificate_issued',
                courseId,
                metadata: { certificateId: certificate.certificateId },
            });
        } catch (activityErr) {
            console.error(
                'Lỗi ghi activity certificate_issued (bỏ qua, không ảnh hưởng certificate):',
                activityErr.message,
            );
        }

        return certificate;
    } catch (err) {
        // unique index bắt race → lấy lại bản đã có
        if (err.code === 11000) {
            return Certificate.findOne({ userId, courseId });
        }
        throw err;
    }
}

module.exports = { issueCertificate };
