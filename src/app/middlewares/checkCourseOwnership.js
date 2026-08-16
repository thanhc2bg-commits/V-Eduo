const Course = require('../models/Course');
const Module = require('../models/Module');

// checkCourseOwnership — kiểm tra quyền sở hữu tài nguyên thông qua Course cha.
// Factory: checkCourseOwnership({ resourceModel, resolveCourseId }) trả về (req, res, next) => {...}
//
// Vì Module và Video KHÔNG có field createdBy riêng, ownership phải truy ngược lên Course:
//   - Module: Module.courseId → Course.createdBy
//   - Video:  Video.moduleId → Module.courseId → Course.createdBy
//
// Tham số:
//   - resourceModel: Model của tài nguyên (Module hoặc Video)
//   - resolveCourseId: hàm nhận resource → trả về ObjectId của Course (hoặc null)
//       * Module:  (m) => m.courseId
//       * Video:   async (v) => { const mod = await Module.findById(v.moduleId); return mod && mod.courseId; }
//
// Hành vi:
//   - Admin luôn được phép (giữ đúng behavior cũ)
//   - User chỉ được phép nếu Course.createdBy khớp req.user.id (.equals() để so ObjectId)
//   - Gắn resource (Module/Video) vào req.resource — KHÔNG phải Course — để controller dùng
//   - Không tìm thấy resource/Course ở bất kỳ bước nào → 404
//   - Không sở hữu → 403 (JSON hoặc render theo pattern cũ)
function checkCourseOwnership({ resourceModel, resolveCourseId }) {
    return async (req, res, next) => {
        try {
            // 1. Tìm resource theo :id
            const resource = await resourceModel.findById(req.params.id);
            if (!resource) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy tài nguyên',
                });
            }

            // 2. Truy ngược lên Course cha
            const courseId = await resolveCourseId(resource);
            const course = courseId ? await Course.findById(courseId) : null;
            if (!course) {
                return res.status(404).render('errors/404', {
                    layout: false,
                    error: 'Không tìm thấy khóa học liên kết',
                });
            }

            // 3. Admin full quyền — giữ đúng behavior cũ
            if (req.user && req.user.role === 'admin') {
                req.resource = resource;
                return next();
            }

            // 4. User: chỉ được phép nếu là người tạo Course (.equals() so ObjectId đúng cách)
            const isOwner =
                course.createdBy &&
                req.user &&
                course.createdBy.equals(req.user.id);

            if (!isOwner) {
                const wantsJson =
                    (req.headers.accept &&
                        req.headers.accept.includes('application/json')) ||
                    req.path.startsWith('/courses/playlist');

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

            // 5. Khớp → gắn resource (Module/Video) vào req.resource và cho qua
            req.resource = resource;
            next();
        } catch (err) {
            next(err);
        }
    };
}

module.exports = { checkCourseOwnership };
