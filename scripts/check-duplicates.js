const { MongoClient } = require('mongodb');

async function main() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/V-connect-dev';
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const result = await db.collection('videos').aggregate([
            { $group: { _id: { youtubeId: "$youtubeId", moduleId: "$moduleId" }, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } }
        ]).toArray();
        console.log('Duplicate check result:');
        console.log(JSON.stringify(result, null, 2));
        if (result.length === 0) {
            console.log('✅ No duplicates found. Safe to proceed.');
        } else {
            console.log('⚠️ Duplicates found! Do NOT restart server.');
        }
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    } finally {
        await client.close();
    }
}

main();
