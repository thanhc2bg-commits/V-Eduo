// checkOwnership — kiểm tra quyền sở hữu tài nguyên.
// Factory: checkOwnership(Model) trả về (req, res, next) => {...}
// - Admin luôn được phép (giữ đúng behavior cũ)
// - User chỉ được phép nếu là người tạo (createdBy khớp req.user.id)
// - Gắn document tìm được vào req.resource để controller không phải query lại
function checkOwnership(Model) {
    return async (req, res, next) => {
        try {
            const doc = await Model.findById(req.params.id);

            // Không tìm thấy document → trang 404
            if (!doc) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy tài nguyên',
                });
            }

            // Admin full quyền — giữ đúng behavior cũ
            if (req.user && req.user.role === 'admin') {
                req.resource = doc;
                return next();
            }

            // User: chỉ được phép nếu là người tạo (createdBy khớp req.user.id)
            // Dùng .equals() để so sánh ObjectId đúng cách (không dùng === trực tiếp)
            const isOwner =
                doc.createdBy && req.user && doc.createdBy.equals(req.user.id);

            if (!isOwner) {
                const wantsJson =
                    req.path.startsWith('/courses/playlist') ||
                    (req.headers.accept &&
                        req.headers.accept.includes('application/json'));

                if (wantsJson) {
                    return res
                        .status(403)
                        .json({ error: 'Không có quyền truy cập' });
                }
                // User đã đăng nhập nhưng không sở hữu → trang 403 riêng
                return res.status(403).render('errors/403', {
                    layout: false,
                    error: 'Bạn không có quyền truy cập trang này',
                    user: req.user,
                });
            }

            // Khớp → gắn document vào req.resource và cho qua
            req.resource = doc;
            next();
        } catch (err) {
            next(err);
        }
    };
}

module.exports = { checkOwnership };
