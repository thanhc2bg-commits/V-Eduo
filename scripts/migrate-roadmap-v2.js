require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connect } = require('../src/config/db');
const Roadmap = require('../src/app/models/Roadmap');
const Course = require('../src/app/models/Course');

const LOG_FILE = path.join(__dirname, 'migration-roadmap-v2-log.json');
const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 200);

function inferVisibility(roadmap) {
    if (
        roadmap.visibility === 'public' ||
        roadmap.visibility === 'private' ||
        roadmap.visibility === 'draft'
    ) {
        return roadmap.visibility;
    }
    return roadmap.isPublic ? 'public' : 'private';
}

async function migrateRoadmaps(log) {
    const cursor = Roadmap.findWithDeleted({}).cursor();
    const roadmapOps = [];
    let scanned = 0;

    for await (const roadmap of cursor) {
        scanned += 1;
        const nextVisibility = inferVisibility(roadmap);
        const nextIsPublic = nextVisibility === 'public';

        const shouldUpdate =
            roadmap.visibility !== nextVisibility ||
            roadmap.isPublic !== nextIsPublic ||
            roadmap.category === undefined ||
            roadmap.difficulty === undefined ||
            roadmap.coverImage === undefined;

        if (!shouldUpdate) {
            log.roadmaps.skipped += 1;
            continue;
        }

        roadmapOps.push({
            updateOne: {
                filter: { _id: roadmap._id },
                update: {
                    $set: {
                        visibility: nextVisibility,
                        isPublic: nextIsPublic,
                        category: roadmap.category || '',
                        difficulty: roadmap.difficulty || '',
                        coverImage: roadmap.coverImage || '',
                    },
                },
            },
        });

        if (roadmapOps.length >= BATCH_SIZE) {
            const result = await Roadmap.bulkWrite(roadmapOps);
            log.roadmaps.updated += result.modifiedCount || 0;
            roadmapOps.length = 0;
        }
    }

    if (roadmapOps.length > 0) {
        const result = await Roadmap.bulkWrite(roadmapOps);
        log.roadmaps.updated += result.modifiedCount || 0;
    }

    log.roadmaps.scanned = scanned;
}

async function migrateCourseOrder(log) {
    const cursor = Roadmap.findWithDeleted({}).select('_id').cursor();
    let roadmapScanned = 0;

    for await (const roadmap of cursor) {
        roadmapScanned += 1;
        const courses = await Course.findWithDeleted({ roadmapId: roadmap._id })
            .sort({ createdAt: 1 })
            .select('_id roadmapOrder');

        if (courses.length === 0) continue;

        const orderOps = [];
        courses.forEach((course, index) => {
            if (course.roadmapOrder !== index) {
                orderOps.push({
                    updateOne: {
                        filter: { _id: course._id },
                        update: { $set: { roadmapOrder: index } },
                    },
                });
            } else {
                log.courses.skipped += 1;
            }
        });

        if (orderOps.length > 0) {
            const result = await Course.bulkWrite(orderOps);
            log.courses.updated += result.modifiedCount || 0;
        }
        log.courses.scanned += courses.length;
    }

    log.courses.roadmapsScanned = roadmapScanned;

    const orphanResult = await Course.updateMany(
        {
            $or: [{ roadmapId: null }, { roadmapId: { $exists: false } }],
            roadmapOrder: { $ne: null },
        },
        { $set: { roadmapOrder: null } },
    );
    log.courses.orphansReset = orphanResult.modifiedCount || 0;
}

async function main() {
    await connect();

    const log = {
        timestamp: new Date().toISOString(),
        batchSize: BATCH_SIZE,
        roadmaps: {
            scanned: 0,
            updated: 0,
            skipped: 0,
        },
        courses: {
            roadmapsScanned: 0,
            scanned: 0,
            updated: 0,
            skipped: 0,
            orphansReset: 0,
        },
        errors: [],
    };

    try {
        await migrateRoadmaps(log);
        await migrateCourseOrder(log);
    } catch (error) {
        log.errors.push({
            message: error.message,
            stack: error.stack,
        });
        throw error;
    } finally {
        fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
        await mongoose.disconnect();
    }

    console.log('=== MIGRATION ROADMAP V2 ===');
    console.log(`Roadmaps scanned: ${log.roadmaps.scanned}`);
    console.log(`Roadmaps updated: ${log.roadmaps.updated}`);
    console.log(`Roadmaps skipped: ${log.roadmaps.skipped}`);
    console.log(`Courses scanned: ${log.courses.scanned}`);
    console.log(`Courses updated (order): ${log.courses.updated}`);
    console.log(`Courses skipped: ${log.courses.skipped}`);
    console.log(`Orphan orders reset: ${log.courses.orphansReset}`);
    console.log(`Log file: ${LOG_FILE}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Migration roadmap v2 failed:', err.message);
        process.exit(1);
    });
