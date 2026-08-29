const mongoose = require('mongoose');

async function main() {
    await mongoose.connect('mongodb://localhost:27017/V-connect-dev');
    const db = mongoose.connection.db;

    console.log('=== KỊCH BẢN 1: Course "SB1 Video 0" ===');
    const course = await db
        .collection('courses')
        .find({ name: 'SB1 Video 0' })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
    console.log(JSON.stringify(course, null, 2));

    console.log('\n=== KỊCH BẢN 1: Video trong module của course SB1 ===');
    const module = await db
        .collection('modules')
        .findOne({ courseId: course[0]._id });
    console.log('Module ID:', module._id);
    const videos = await db
        .collection('videos')
        .find({ moduleId: module._id })
        .toArray();
    console.log('Số video trong module:', videos.length);
    console.log('Kỳ vọng: 55');

    await mongoose.disconnect();
}

main().catch((e) => {
    console.error('Erreur:', e.message);
    process.exit(1);
});