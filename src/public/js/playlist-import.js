/**
 * playlist-import.js — Thêm nhiều video từ playlist YouTube.
 * Chỉ dùng cho trang Thêm khóa học (courses/create.hbs).
 * KHÔNG đụng tới youtube-autofill.js (tính năng 1 video giữ nguyên).
 */
$(document).ready(function () {
    var $input = $('#playlist-input');
    var $btnFetch = $('#btn-fetch-playlist');
    var $errorBox = $('#playlist-error');
    var $preview = $('#playlist-preview');
    var $progress = $('#playlist-progress');
    var $summary = $('#playlist-summary');

    var MAX_VIDEOS = 200; // khớp với MAX_VIDEOS_PER_BATCH server
    var CONCURRENCY = 5; // khớp với concurrency server (client chia chunk để cập nhật tiến độ)
    var videos = []; // danh sách video hiện tại từ playlist

    function showError(msg) {
        $errorBox.text(msg);
    }
    function clearError() {
        $errorBox.text('');
    }
    function showProgress(msg) {
        $progress.text(msg);
    }
    function clearProgress() {
        $progress.text('');
    }

    /**
     * Render danh sách video dạng checkbox.
     * Video không khả dụng (deleted/private) hiện xám, không tick được.
     */
    function renderPreview() {
        $preview.empty();
        if (!videos.length) {
            $preview.html(
                '<div class="text-muted small">Playlist không có video nào.</div>',
            );
            return;
        }

        var $list = $('<div class="list-group"></div>');
        videos.forEach(function (video, index) {
            var $item = $(
                '<label class="list-group-item d-flex align-items-center gap-3 py-2"></label>',
            );
            var $checkbox = $(
                '<input type="checkbox" class="form-check-input m-0">',
            );
            $checkbox.attr('data-index', index);
            if (!video.available) {
                $checkbox.prop('disabled', true);
                $item.addClass('text-muted bg-light');
            }

            var $thumb = $(
                '<img class="rounded" style="width:80px;height:45px;object-fit:cover;">',
            );
            $thumb.attr(
                'src',
                video.thumbnail ||
                    'https://via.placeholder.com/80x45?text=No+Thumb',
            );
            $thumb.attr('alt', video.title);

            var $info = $('<div class="flex-grow-1"></div>');
            $info.append(
                $('<div class="small fw-semibold"></div>').text(video.title),
            );
            if (!video.available) {
                $info.append(
                    $('<div class="text-danger small"></div>').text(
                        'Không khả dụng (đã xóa hoặc riêng tư)',
                    ),
                );
            }

            $item.append($checkbox, $thumb, $info);
            $list.append($item);
        });

        $preview.append($list);

        // Nút submit
        var $btnAdd = $(
            '<button type="button" class="btn btn-success mt-3" id="btn-add-playlist">Thêm video đã chọn</button>',
        );
        $preview.append($btnAdd);

        $btnAdd.on('click', function () {
            var selected = [];
            $preview.find('input[type=checkbox]:checked').each(function () {
                var idx = $(this).attr('data-index');
                selected.push(videos[idx]);
            });

            if (!selected.length) {
                showError('Vui lòng chọn ít nhất 1 video.');
                return;
            }
            if (selected.length > MAX_VIDEOS) {
                showError('Tối đa ' + MAX_VIDEOS + ' video mỗi lần thêm.');
                return;
            }

            // Xác nhận trước khi submit (yêu cầu C)
            if (
                !confirm(
                    'Sẽ thêm ' + selected.length + ' video đã chọn, tiếp tục?',
                )
            ) {
                return;
            }

            submitBatch(selected);
        });
    }

    /**
     * Submit theo chunk CONCURRENCY để cập nhật tiến độ chính xác.
     */
    async function submitBatch(selected) {
        clearError();
        clearProgress();
        $summary.empty();
        $btnFetch.prop('disabled', true);
        $preview.find('input[type=checkbox]').prop('disabled', true);

        var totalSuccess = 0;
        var totalDuplicate = 0;
        var totalErrors = 0;
        var errorDetails = [];

        for (var i = 0; i < selected.length; i += CONCURRENCY) {
            var chunk = selected.slice(i, i + CONCURRENCY);
            showProgress(
                'Đang thêm ' +
                    Math.min(i + CONCURRENCY, selected.length) +
                    '/' +
                    selected.length +
                    '...',
            );

            try {
                var res = await fetch('/courses/playlist/store', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: chunk }),
                });
                var data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || 'Lỗi không xác định');
                }
                totalSuccess += data.success.length;
                totalDuplicate += data.duplicate.length;
                totalErrors += data.errors.length;
                data.errors.forEach(function (e) {
                    errorDetails.push(e.title + ' — ' + e.reason);
                });
            } catch (e) {
                totalErrors += chunk.length;
                chunk.forEach(function (v) {
                    errorDetails.push(v.title + ' — ' + e.message);
                });
            }
        }

        clearProgress();
        $btnFetch.prop('disabled', false);
        $preview.find('input[type=checkbox]').prop('disabled', false);

        // Tóm tắt kết quả
        var $box = $('<div class="alert"></div>');
        if (totalErrors === 0 && totalDuplicate === 0) {
            $box.addClass('alert-success');
            $box.text('Đã thêm thành công ' + totalSuccess + ' video.');
        } else {
            $box.addClass('alert-warning');
            var lines = [
                'Thành công: ' + totalSuccess,
                'Bỏ qua (trùng): ' + totalDuplicate,
                'Lỗi: ' + totalErrors,
            ];
            if (errorDetails.length) {
                lines.push('');
                lines.push('Chi tiết lỗi:');
                errorDetails.slice(0, 10).forEach(function (d) {
                    lines.push('• ' + d);
                });
                if (errorDetails.length > 10) {
                    lines.push(
                        '... và ' + (errorDetails.length - 10) + ' lỗi khác',
                    );
                }
            }
            $box.html(lines.join('<br>'));
        }
        $summary.append($box);
    }

    // Nút "Lấy danh sách"
    $btnFetch.on('click', async function () {
        var playlist = $input.val().trim();
        clearError();
        clearProgress();
        $summary.empty();

        if (!playlist) {
            showError('Vui lòng nhập link hoặc ID playlist.');
            return;
        }

        $btnFetch.prop('disabled', true);
        $btnFetch.text('Đang tải...');

        try {
            var res = await fetch('/courses/playlist/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlist: playlist }),
            });
            var data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Lỗi không xác định');
            }
            videos = data.videos || [];
            renderPreview();
        } catch (e) {
            showError(e.message);
            $preview.empty();
        } finally {
            $btnFetch.prop('disabled', false);
            $btnFetch.text('Lấy danh sách');
        }
    });
});
