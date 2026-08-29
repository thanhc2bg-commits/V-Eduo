const mongoose = require('mongoose');

async function main() {
    await mongoose.connect('mongodb://localhost:27017/V-connect-dev');
    const db = mongoose.connection.db;

    console.log('=== KỊCH BẢN 1: Course mới nhất ===');
    const course = await db.collection('courses').find().sort({ createdAt: -1 }).limit(1).toArray();
    console.log(JSON.stringify(course, null, 2));

    console.log('\n=== KỊCH BẢN 1: Video dans le module de ce course ===');
    const module = await db.collection('modules').findOne({ courseId: course[0]._id });
    const videos = await db.collection('videos').find({ moduleId: module._id }).toArray();
    console.log('Nombre de vidéos:', videos.length);

    console.log('\n=== KỊCH BẢN 3: Video X (dS1Nv_1W8bb) ===');
    const shared = await db.collection('videos').find({ youtubeId: 'dS1Nv_1W8bb' }).toArray();
    console.log(JSON.stringify(shared, null, 2));

    await mongoose.disconnect();
}

main().catch((e) => {
    console.error('Erreur:', e.message);
    process.exit(1);
});