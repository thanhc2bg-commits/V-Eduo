/**
 * youtube.js — Tiện ích gọi YouTube Data API v3.
 * Dùng cho tính năng thêm nhiều video từ playlist.
 * Yêu cầu biến môi trường YOUTUBE_API_KEY trong .env
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const MAX_RESULTS_PER_PAGE = 50;
const MAX_VIDEOS_PER_BATCH = 200;

/**
 * Parse playlist ID từ input: ID thuần (PL...) hoặc link playlist.
 * Trả về playlistId hoặc null.
 */
function extractPlaylistId(input) {
    if (!input) return null;
    const value = String(input).trim();
    // Dạng ID thuần: PL... hoặc UU... / OL... (playlist)
    if (/^(PL|UU|OL|RD|FL)[a-zA-Z0-9_-]{10,}$/.test(value)) return value;
    // Dạng link: youtube.com/playlist?list=PL...
    const list = value.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (list) return list[1];
    return null;
}

/**
 * Gọi YouTube Data API v3 lấy toàn bộ video trong playlist.
 * - Phân trang đầy đủ (lặp nextPageToken tới khi hết).
 * - Lọc video hỏng (thiếu snippet, title "Deleted video"/"Private video")
 *   → đánh cờ available: false để UI không cho chọn.
 *
 * Trả về: { videos: [{ videoid, title, thumbnail, available }] }
 * Ném Error với message tiếng Việt cụ thể theo từng loại lỗi.
 */
async function fetchPlaylistVideos(playlistId, apiKey) {
    if (!apiKey) {
        throw new Error('Chưa cấu hình YOUTUBE_API_KEY trong file .env');
    }

    const videos = [];
    let pageToken = '';
    let totalFetched = 0;

    do {
        const params = new URLSearchParams({
            part: 'snippet',
            playlistId,
            maxResults: String(MAX_RESULTS_PER_PAGE),
            key: apiKey,
        });
        if (pageToken) params.set('pageToken', pageToken);

        const url = `${YOUTUBE_API_BASE}/playlistItems?${params.toString()}`;
        const res = await fetch(url);

        if (!res.ok) {
            let message = 'Có lỗi xảy ra khi lấy danh sách playlist';
            try {
                const data = await res.json();
                const reason =
                    data.error && data.error.errors && data.error.errors[0];
                if (res.status === 404) {
                    message =
                        'Không tìm thấy playlist (có thể riêng tư hoặc đã bị xóa)';
                } else if (res.status === 403) {
                    if (reason && reason.reason === 'quotaExceeded') {
                        message = 'Đã hết quota YouTube API, thử lại sau';
                    } else {
                        message =
                            'API key không hợp lệ, kiểm tra lại YOUTUBE_API_KEY';
                    }
                } else if (res.status === 400) {
                    message = 'Playlist ID không hợp lệ';
                }
            } catch (e) {
                // giữ message mặc định nếu không parse được JSON
            }
            throw new Error(message);
        }

        const data = await res.json();

        for (const item of data.items || []) {
            const snippet = item.snippet || {};
            const videoId = snippet.resourceId && snippet.resourceId.videoId;
            const title = (snippet.title || '').trim();

            // Lọc video hỏng: thiếu videoId, hoặc title là Deleted/Private video
            const isBroken =
                !videoId ||
                !title ||
                /^(Deleted video|Private video)$/i.test(title);

            videos.push({
                videoid: videoId || '',
                title: isBroken ? title || 'Video không khả dụng' : title,
                thumbnail:
                    (snippet.thumbnails &&
                        (snippet.thumbnails.medium ||
                            snippet.thumbnails.default) &&
                        (
                            snippet.thumbnails.medium ||
                            snippet.thumbnails.default
                        ).url) ||
                    '',
                available: !isBroken,
            });
        }

        totalFetched += (data.items || []).length;
        pageToken = data.nextPageToken || '';
    } while (pageToken && totalFetched < MAX_VIDEOS_PER_BATCH);

    return { videos };
}

module.exports = {
    extractPlaylistId,
    fetchPlaylistVideos,
    MAX_VIDEOS_PER_BATCH,
};
