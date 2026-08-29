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

    // CSRF token từ meta tag (được render bởi server)
    var csrfToken = $('meta[name="csrf-token"]').attr('content') || '';
    function csrfHeaders() {
        return {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken,
        };
    }

    var MAX_VIDEOS = 200; // khớp với MAX_VIDEOS_PER_BATCH server
    var REQUEST_TIMEOUT = 120000; // 120s — tạo Course + insert N video có thể lâu
    var MAX_RETRIES = 3; // số lần thử lại tối đa khi lỗi mạng tạm thời
    var videos = []; // danh sách video hiện tại từ playlist

    function showError(msg) {
        $errorBox.text(msg);
    }
    function clearError() {
        $errorBox.text('').removeClass('text-warning').addClass('text-danger');
    }
    function showProgress(msg) {
        $progress.text(msg);
    }
    function clearProgress() {
        $progress.text('');
    }

    /**
     * Fetch wrapper có timeout + retry.
     * - timeout: hủy request nếu server không phản hồi đúng hạn.
     * - retry: thử lại khi lỗi mạng tạm thời (network error, 5xx, timeout).
     * Trả về { ok, status, data } — KHÔNG throw lỗi mạng để dễ xử lý.
     */
    async function fetchWithRetry(url, options, retries) {
        var attempt = 0;
        while (true) {
            var controller = new AbortController();
            var timer = setTimeout(function () {
                controller.abort();
            }, REQUEST_TIMEOUT);

            try {
                var res = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                });
                clearTimeout(timer);

                var data = null;
                try {
                    data = await res.json();
                } catch (e) {
                    // Response không phải JSON — lấy text để debug
                    var text = await res.text();
                    data = {
                        error: text || 'Phản hồi không hợp lệ từ máy chủ',
                    };
                }

                // Thành công hoặc lỗi 4xx (không nên retry) → trả về ngay
                if (res.ok || (res.status >= 400 && res.status < 500)) {
                    return { ok: res.ok, status: res.status, data: data };
                }

                // Lỗi 5xx → retry
                if (attempt >= retries) {
                    return { ok: false, status: res.status, data: data };
                }
            } catch (err) {
                clearTimeout(timer);
                // Lỗi mạng / timeout / abort → retry
                if (attempt >= retries) {
                    return {
                        ok: false,
                        status: 0,
                        data: {
                            error:
                                err.name === 'AbortError'
                                    ? 'Hết thời gian chờ phản hồi từ máy chủ'
                                    : 'Không thể kết nối tới máy chủ',
                        },
                    };
                }
            }

            attempt++;
            // Backoff: 500ms, 1s, 2s...
            await new Promise(function (resolve) {
                setTimeout(resolve, 500 * Math.pow(2, attempt - 1));
            });
        }
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
            // Chặn double-click: nếu nút đã disable (request trước đang chạy) thì bỏ qua
            if ($btnAdd.prop('disabled')) return;

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

            // Disable ngay lập tức (đồng bộ, trước khi submitAll chạy async)
            // để chặn click thứ 2 lọt qua trong lúc chờ request đầu hoàn tất.
            $btnAdd.prop('disabled', true);
            submitAll(selected, $btnAdd);
        });
    }

    /**
     * Gửi TOÀN BỘ video đã chọn trong 1 request duy nhất.
     * Backend tạo 1 Course + 1 Module + N Video, trả về JSON kết quả.
     */
    async function submitAll(selected, $btn) {
        clearError();
        clearProgress();
        $summary.empty();
        $btnFetch.prop('disabled', true);
        $preview.find('input[type=checkbox]').prop('disabled', true);

        var totalSuccess = 0;
        var totalDuplicate = 0;
        var totalErrors = 0;
        var errorDetails = [];

        showProgress('Đang thêm ' + selected.length + ' video...');

        var result = await fetchWithRetry(
            '/courses/playlist/store',
            {
                method: 'POST',
                headers: csrfHeaders(),
                body: JSON.stringify({ items: selected }),
            },
            MAX_RETRIES,
        );

        if (result.ok) {
            var data = result.data || {};
            totalSuccess = Array.isArray(data.success)
                ? data.success.length
                : 0;
            totalDuplicate = Array.isArray(data.duplicate)
                ? data.duplicate.length
                : 0;
            (data.errors || []).forEach(function (e) {
                errorDetails.push(e.title + ' — ' + e.reason);
            });
        } else {
            totalErrors = selected.length;
            var msg =
                (result.data && result.data.error) ||
                'Lỗi không xác định (HTTP ' + result.status + ')';
            errorDetails.push(msg);
        }

        clearProgress();
        $btnFetch.prop('disabled', false);
        $preview.find('input[type=checkbox]').prop('disabled', false);
        if ($btn) $btn.prop('disabled', false);

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
                headers: csrfHeaders(),
                body: JSON.stringify({ playlist: playlist }),
            });
            var data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Lỗi không xác định');
            }
            videos = data.videos || [];
            renderPreview();

            if (data.truncated) {
                $errorBox
                    .removeClass('text-danger')
                    .addClass('text-warning')
                    .text(
                        'Playlist có nhiều hơn ' +
                            MAX_VIDEOS +
                            ' video — chỉ lấy được ' +
                            videos.length +
                            ' video đầu tiên. Vui lòng chia nhỏ playlist nếu muốn lấy đủ.',
                    );
            } else {
                $errorBox.removeClass('text-warning').addClass('text-danger');
            }
        } catch (e) {
            showError(e.message);
            $preview.empty();
        } finally {
            $btnFetch.prop('disabled', false);
            $btnFetch.text('Lấy danh sách');
        }
    });
});
