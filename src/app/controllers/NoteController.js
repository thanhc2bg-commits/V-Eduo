const mongoose = require('mongoose');
const Module = require('../models/Module');
const Video = require('../models/Video');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Note = require('../models/Note');
const {
    mongooseToObject,
    multipleMongooseToObject,
} = require('../../utils/mongoose');

const MAX_NOTES_FREE = 20; // Gói free tối đa 20 ghi chú (pro không giới hạn)

// Helper: check quyền xem course — giống EnrollController.recordWatch().
// - Course public (isPublic: true) → cho phép tạo ghi chú (xem thử).
// - Course private (isPublic: false) → chỉ owner hoặc enrolled mới tạo được.
async function canViewCourse(user, course) {
    if (course.isPublic) return true;
    const isOwner = course.createdBy && course.createdBy.equals(user.id);
    if (isOwner) return true;
    const isEnrolled = await Enrollment.exists({
        userId: user.id,
        courseId: course._id,
    });
    return !!isEnrolled;
}

class NoteController {
    // [POST] /api/videos/:videoId/notes
    // 🔒 Check quyền xem course trước khi cho tạo note (bản 2.2 — giống recordWatch):
    // user chưa enroll hoặc course private/draft KHÔNG được tạo note qua API trực tiếp
    // (dù UI có ẩn panel — vẫn phải chặn phía server để nhất quán).
    async store(req, res, next) {
        try {
            const { content } = req.body;
            if (!content || !String(content).trim()) {
                return res
                    .status(400)
                    .json({ error: 'Nội dung ghi chú không được để trống' });
            }
            if (String(content).length > 5000) {
                return res
                    .status(400)
                    .json({ error: 'Ghi chú tối đa 5000 ký tự' });
            }

            // Xác nhận video + module + course tồn tại
            const video = await Video.findById(req.params.videoId);
            if (!video)
                return res.status(404).json({ error: 'Video không tồn tại' });
            const module = await Module.findById(video.moduleId);
            if (!module)
                return res.status(404).json({ error: 'Module không tồn tại' });
            const course = await Course.findById(module.courseId);
            if (!course)
                return res
                    .status(404)
                    .json({ error: 'Khóa học không tồn tại' });

            // 🔒 Check quyền xem course — giống recordWatch()
            if (!(await canViewCourse(req.user, course))) {
                return res
                    .status(403)
                    .json({
                        error: 'Bạn không có quyền tạo ghi chú cho khóa học này',
                    });
            }

            // Giới hạn note cho gói free (kế hoạch mục 3.2.1)
            const noteCount = await Note.countDocuments({
                userId: req.user.id,
            });
            if (req.user.plan !== 'pro' && noteCount >= MAX_NOTES_FREE) {
                return res.status(403).json({
                    error: 'Gói miễn phí giới hạn 20 ghi chú. Nâng cấp Pro để không giới hạn.',
                });
            }

            const note = await Note.create({
                userId: req.user.id,
                videoId: video._id,
                courseId: module.courseId,
                content: String(content).trim(),
            });

            res.status(201).json({ note: mongooseToObject(note) });
        } catch (err) {
            next(err);
        }
    }

    // [GET] /api/videos/:videoId/notes — CHỈ trả note của chính user
    // Không thêm check quyền xem course ở đây vì:
    // - Query đã lọc `userId: req.user.id` → KHÔNG lộ note của người khác.
    // - User chỉ có thể đọc note CHÍNH MÌNH cho video mà họ biết ID — không rò rỉ dữ liệu
    //   private của course sang người ngoài (khác với store() — tạo dữ liệu mới).
    //   Rủi ro thấp nhất, thêm check chỉ làm tăng số query không cần thiết.
    async index(req, res, next) {
        try {
            const notes = await Note.find({
                userId: req.user.id,
                videoId: req.params.videoId,
            })
                .sort({ createdAt: -1 })
                .limit(50); // giới hạn hiển thị 50 note/video/user (kế hoạch 6.3)

            res.json({ notes: multipleMongooseToObject(notes) });
        } catch (err) {
            next(err);
        }
    }

    // [PUT] /api/notes/:id
    // 🔒 BẮT BUỘC: filter gồm cả _id + userId trong CÙNG 1 lệnh (bản 2.1 — chống IDOR)
    // Không thêm check quyền xem course vì:
    // - Filter `{ _id, userId }` đảm bảo user chỉ sửa được note của CHÍNH MÌNH.
    // - Nếu user đã tạo note từ khi course còn public (hoặc trước khi bị đổi private),
    //   họ vẫn hợp lệ để sửa note của mình — chặn lại ở đây sẽ gây trải nghiệm tệ.
    // - Việc sửa note KHÔNG tạo dữ liệu mới lộ ra ngoài (khác store()).
    async update(req, res, next) {
        try {
            const { content } = req.body;
            if (!content || !String(content).trim()) {
                return res
                    .status(400)
                    .json({ error: 'Nội dung ghi chú không được để trống' });
            }
            if (String(content).length > 5000) {
                return res
                    .status(400)
                    .json({ error: 'Ghi chú tối đa 5000 ký tự' });
            }

            const note = await Note.findOneAndUpdate(
                { _id: req.params.id, userId: req.user.id },
                { $set: { content: String(content).trim() } },
                { new: true, runValidators: true },
            );

            if (!note) {
                // Trả 404 thay vì 403 — không tiết lộ note có tồn tại hay không
                return res.status(404).json({ error: 'Ghi chú không tồn tại' });
            }

            res.json({ note: mongooseToObject(note) });
        } catch (err) {
            next(err);
        }
    }

    // [DELETE] /api/notes/:id
    // 🔒 BẮT BUỘC: filter gồm cả _id + userId trong CÙNG 1 lệnh (bản 2.1 — chống IDOR)
    // Không thêm check quyền xem course — lý do giống update(): user chỉ xóa được note
    // của chính mình, không tạo dữ liệu mới lộ ra ngoài.
    async destroy(req, res, next) {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({ error: 'Note ID không hợp lệ' });
            }

            const note = await Note.findOneAndDelete({
                _id: req.params.id,
                userId: req.user.id,
            });

            if (!note) {
                return res.status(404).json({ error: 'Ghi chú không tồn tại' });
            }

            res.json({ message: 'Đã xóa ghi chú' });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new NoteController();
