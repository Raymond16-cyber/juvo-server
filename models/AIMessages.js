import mongoose from 'mongoose';

const AIMessagesSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    response: {
        type: String,
        required: true,
        
    }
}, { 
    timestamps: true });

const AIMessages = mongoose.model('AIMessages', AIMessagesSchema);

export default AIMessages;