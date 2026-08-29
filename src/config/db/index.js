const mongoose = require('mongoose');

async function connect() {
    try {
        const uri =
            process.env.MONGODB_URI ||
            'mongodb://localhost:27017/V-connect-dev';
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
}

module.exports = { connect };
