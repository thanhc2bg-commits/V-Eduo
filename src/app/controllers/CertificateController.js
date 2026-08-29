const Certificate = require('../models/Certificate');
const Course = require('../models/Course');
const User = require('../models/User');

class CertificateController {
    // [GET] /certificates/:certificateId
    // Trang chứng chỉ — public, không cần đăng nhập (để học viên chia sẻ).
    // KHÔNG có route POST tạo certificate — chỉ server tự phát qua issueCertificate()
    // sau khi xác minh hoàn thành 100% (chống giả mạo).
    async show(req, res, next) {
        try {
            const certificate = await Certificate.findOne({
                certificateId: req.params.certificateId,
            });
            if (!certificate) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Chứng chỉ không tồn tại',
                });
            }

            // Giai đoạn 2: nếu isPublic === false → chỉ owner đăng nhập xem được.
            // Certificate cũ (giai đoạn 1, không có field isPublic) → undefined → coi là public.
            if (certificate.isPublic === false) {
                const isOwner =
                    req.user && certificate.userId.equals(req.user.id);
                if (!isOwner) {
                    return res.status(403).render('errors/403', {
                        layout: false,
                        error: 'Bạn không có quyền xem chứng chỉ này',
                        user: req.user,
                    });
                }
            }

            // Lấy thông tin user + course để render chứng chỉ
            const user = await User.findById(certificate.userId).select('name');
            const course = await Course.findById(certificate.courseId);

            if (!user || !course) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Chứng chỉ không tồn tại',
                });
            }

            res.render('certificates/show', {
                layout: false,
                title: 'Chứng chỉ hoàn thành',
                certificateId: certificate.certificateId,
                userName: user.name,
                courseName: course.name,
                issuedAt: certificate.createdAt,
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new CertificateController();
