/**
 * youtube-autofill.js — Tự điền tên khóa học + xem trước thumbnail
 * từ ID/link video YouTube thông qua oEmbed API (miễn phí, không cần API key).
 *
 * Chỉ dùng cho trang Thêm khóa học (courses/create.hbs).
 * Chạy theo hành động thật của user (gõ/paste/blur/bấm nút),
 * KHÔNG tự trigger khi trang load.
 */
$(document).ready(function () {
    var $videoIdInput = $('#youtubeId');
    var $nameInput = $('#name');
    var $btnAutofill = $('#btn-autofill');
    var $previewBox = $('#video-preview');
    var $errorBox = $('#video-error');

    // Placeholder gốc để khôi phục sau khi loading
    var originalPlaceholder = $nameInput.attr('placeholder') || '';

    // requestId đơn giản: chỉ áp dụng response mới nhất
    var currentRequestId = 0;
    // Timeout debounce cho input/paste
    var debounceTimer = null;

    // Regex ID video YouTube (đúng 11 ký tự [A-Za-z0-9_-])
    var ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

    /**
     * Parse ID video từ input: ID thuần, link watch?v=, link youtu.be
     * Trả về ID hợp lệ 11 ký tự, hoặc null.
     */
    function parseYouTubeId(raw) {
        if (!raw) return null;
        var value = String(raw).trim();
        // Dạng ID thuần
        if (ID_REGEX.test(value)) return value;
        // Dạng https://www.youtube.com/watch?v=XXXX
        var watch = value.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (watch) return watch[1];
        // Dạng https://youtu.be/XXXX
        var short = value.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (short) return short[1];
        return null;
    }

    /**
     * Lấy tiêu đề + thumbnail video từ oEmbed.
     * Chỉ áp dụng kết quả nếu id === currentRequestId (request mới nhất).
     */
    function fetchVideoInfo(videoId) {
        var id = ++currentRequestId;

        setLoading(true);
        clearError();

        var oembedUrl =
            'https://www.youtube.com/oembed?url=' +
            encodeURIComponent('https://www.youtube.com/watch?v=' + videoId) +
            '&format=json';

        $.ajax({
            url: oembedUrl,
            dataType: 'json',
            success: function (data) {
                if (id !== currentRequestId) return; // request cũ, bỏ qua

                // 1. Tự điền tên — CHỈ khi ô name đang trống (không ghi đè)
                if (!$nameInput.val().trim()) {
                    $nameInput.val(data.title || '');
                }

                // 2. Hiện thumbnail preview (dùng img element, an toàn không XSS)
                showThumbnail(data.thumbnail_url);
                setLoading(false);
            },
            error: function (xhr) {
                if (id !== currentRequestId) return;

                clearThumbnail();
                if (xhr.status === 0) {
                    // Không có response = lỗi mạng/CORS/offline, không phải do YouTube từ chối
                    showError(
                        'Không thể kết nối mạng. Vui lòng kiểm tra kết nối và thử lại.',
                    );
                } else if (xhr.status === 400 || xhr.status === 404) {
                    // Video private / đã xóa / không tồn tại (oEmbed trả 400 hoặc 404)
                    showError(
                        'Không tìm thấy video này (có thể đã bị xóa hoặc ở chế độ riêng tư).',
                    );
                } else {
                    showError(
                        'Có lỗi xảy ra khi lấy thông tin video. Vui lòng thử lại.',
                    );
                }
                setLoading(false);
            },
        });
    }

    /**
     * Tự động dò video từ ô input.
     */
    function autofill() {
        var raw = $videoIdInput.val();
        var videoId = parseYouTubeId(raw);

        clearError();
        clearThumbnail();

        if (!videoId) {
            // Không có ID hợp lệ → không gọi API, hủy mọi request đang pending
            currentRequestId++;
            setLoading(false);
            if (raw && raw.trim()) {
                showError(
                    'ID video không hợp lệ. Vui lòng nhập đúng 11 ký tự hoặc link YouTube.',
                );
            }
            return;
        }

        fetchVideoInfo(videoId);
    }

    /**
     * Bật/tắt trạng thái loading.
     */
    function setLoading(isLoading) {
        if (isLoading) {
            // Chỉ đổi placeholder khi ô name đang trống (không làm mất text user nhập)
            if (!$nameInput.val().trim()) {
                $nameInput.attr('placeholder', 'Đang lấy tên...');
            }
            $btnAutofill.prop('disabled', true);
            $btnAutofill.text('Đang tải...');
        } else {
            $nameInput.attr('placeholder', originalPlaceholder);
            $btnAutofill.prop('disabled', false);
            $btnAutofill.text('Tự điền');
        }
    }

    /**
     * Hiện thumbnail preview — dùng createElement('img') để an toàn (không innerHTML).
     */
    function showThumbnail(url) {
        if (!url) return;
        $previewBox.empty();
        var img = document.createElement('img');
        img.src = url;
        img.alt = 'Video thumbnail';
        img.className = 'img-fluid rounded mt-2';
        img.style.maxWidth = '200px';
        $previewBox.append(img);
    }

    function clearThumbnail() {
        $previewBox.empty();
    }

    /**
     * Hiện lỗi — dùng .text() để an toàn (không innerHTML).
     */
    function showError(msg) {
        $errorBox.text(msg);
    }

    function clearError() {
        $errorBox.text('');
    }

    // --- Sự kiện: chỉ theo hành động thật của user, KHÔNG chạy khi load ---

    // 1. Gõ / paste → debounce 500ms (trải nghiệm mượt, không spam API)
    $videoIdInput.on('input paste', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(autofill, 500);
    });

    // 2. Rời khỏi ô ID Video → dò ngay
    $videoIdInput.on('blur', autofill);

    // 3. Nút "Tự điền" — hủy debounce đang chờ rồi dò ngay
    $btnAutofill.on('click', function (e) {
        e.preventDefault();
        clearTimeout(debounceTimer);
        autofill();
    });
});
