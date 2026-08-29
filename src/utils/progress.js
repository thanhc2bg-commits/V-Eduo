const Video = require('../app/models/Video');

// Đếm tổng số video của tất cả module thuộc course — 1 query duy nhất.
// Lưu ý: aggregate() KHÔNG bị mongoose-delete override → phải lọc thủ công
// `deleted: { $ne: true }` cho cả Video và Module (bản 2.2).
async function getTotalVideosForCourse(courseId) {
    const result = await Video.aggregate([
        {
            $lookup: {
                from: 'modules',
                localField: 'moduleId',
                foreignField: '_id',
                as: 'module',
            },
        },
        { $unwind: '$module' },
        {
            $match: {
                'module.courseId': courseId,
                deleted: { $ne: true },
                'module.deleted': { $ne: true },
            },
        },
        { $count: 'total' },
    ]);
    return result.length > 0 ? result[0].total : 0;
}

module.exports = { getTotalVideosForCourse };
