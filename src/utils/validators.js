/**
 * Bộ validators dùng chung cho toàn bộ ứng dụng.
 * Mỗi hàm trả về { ok, error } — nếu ok=false thì error là message lỗi.
 */

// Regex kiểm tra email cơ bản
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Regex YouTube video ID (đúng 11 ký tự [A-Za-z0-9_-])
const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Validate dữ liệu đăng ký.
 */
function validateRegister(body) {
    const { name, username, email, password } = body || {};

    if (!name || !String(name).trim()) {
        return { ok: false, error: 'Vui lòng nhập họ tên' };
    }
    if (!username || !String(username).trim()) {
        return { ok: false, error: 'Vui lòng nhập tên đăng nhập' };
    }
    if (String(username).trim().length < 3) {
        return { ok: false, error: 'Tên đăng nhập phải có ít nhất 3 ký tự' };
    }
    if (!email || !String(email).trim()) {
        return { ok: false, error: 'Vui lòng nhập email' };
    }
    if (!EMAIL_REGEX.test(String(email).trim())) {
        return { ok: false, error: 'Email không đúng định dạng' };
    }
    if (!password) {
        return { ok: false, error: 'Vui lòng nhập mật khẩu' };
    }
    if (String(password).length < 8) {
        return { ok: false, error: 'Mật khẩu phải có ít nhất 8 ký tự' };
    }

    return { ok: true };
}

/**
 * Validate dữ liệu đăng nhập.
 */
function validateLogin(body) {
    const { identifier, password } = body || {};

    if (!identifier || !String(identifier).trim()) {
        return { ok: false, error: 'Vui lòng điền tên đăng nhập và mật khẩu' };
    }
    if (!password) {
        return { ok: false, error: 'Vui lòng điền tên đăng nhập và mật khẩu' };
    }

    return { ok: true };
}

/**
 * Validate dữ liệu tạo/cập nhật khóa học.
 * - name: bắt buộc, không rỗng sau trim
 * - videoid: bắt buộc, phải đúng 11 ký tự YouTube ID (nếu có gửi lên)
 */
function validateCourse(body, isUpdate = false) {
    const { name, videoid } = body || {};

    if (!isUpdate) {
        // CREATE: bắt buộc có name + videoid
        if (!name || !String(name).trim()) {
            return { ok: false, error: 'Tên khóa học không được để trống' };
        }
        if (!videoid || !String(videoid).trim()) {
            return { ok: false, error: 'ID Video không được để trống' };
        }
        if (!YOUTUBE_ID_REGEX.test(String(videoid).trim())) {
            return {
                ok: false,
                error: 'ID Video không hợp lệ (phải đúng 11 ký tự)',
            };
        }
    } else {
        // UPDATE: nếu có gửi name, name không rỗng
        if (name !== undefined) {
            if (!String(name).trim()) {
                return {
                    ok: false,
                    error: 'Tên khóa học không được để trống',
                };
            }
        }
        // Nếu có gửi videoid, validate định dạng
        if (videoid !== undefined && String(videoid).trim()) {
            if (!YOUTUBE_ID_REGEX.test(String(videoid).trim())) {
                return {
                    ok: false,
                    error: 'ID Video không hợp lệ (phải đúng 11 ký tự)',
                };
            }
        }
    }

    return { ok: true };
}

/**
 * Validate tham số đầu vào cho playlist fetch.
 */
function validatePlaylistFetch(body) {
    const { playlist } = body || {};
    if (!playlist || !String(playlist).trim()) {
        return { ok: false, error: 'Vui lòng nhập link hoặc ID playlist' };
    }
    return { ok: true };
}

module.exports = {
    validateRegister,
    validateLogin,
    validateCourse,
    validatePlaylistFetch,
    YOUTUBE_ID_REGEX,
};
