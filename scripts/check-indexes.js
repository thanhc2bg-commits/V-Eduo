const mongoose = require('mongoose');

async function main() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';
    try {
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;

        console.log('=== Indexes on videos collection ===');
        const indexes = await db.collection('videos').indexes();
        console.log(JSON.stringify(indexes, null, 2));

        console.log('\n=== Indexes on playlistcaches collection ===');
        const cacheIndexes = await db.collection('playlistcaches').indexes();
        console.log(JSON.stringify(cacheIndexes, null, 2));

        console.log('\n=== Done ===');
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

main();
