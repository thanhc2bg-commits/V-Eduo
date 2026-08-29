/**
 * escape-html.js — Hàm escape HTML dùng chung cho toàn bộ AJAX chèn nội dung
 * người dùng (note, review) vào DOM. BẮT BUỘC dùng hàm này thay vì `.html()`
 * trực tiếp với biến chứa nội dung người dùng (bản 2.1 — chống XSS).
 *
 * Load TRƯỚC mọi script AJAX khác (trong view có chèn nội dung người dùng).
 */
function escapeHtml(str) {
    return $('<div>')
        .text(str == null ? '' : String(str))
        .html();
}
