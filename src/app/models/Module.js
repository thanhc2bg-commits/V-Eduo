const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Module = new Schema(
    {
        name: {
            type: String,
            maxLength: 255,
            required: [true, 'Tên module không được để trống'],
            trim: true,
            validate: {
                validator: (value) => value.trim().length > 0,
                message: 'Tên module không được để trống',
            },
        },
        courseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true,
        },
        order: { type: Number, default: 0 },
    },
    {
        timestamps: true,
    },
);

module.exports = mongoose.model('Module', Module);
