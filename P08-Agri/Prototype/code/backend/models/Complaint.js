// backend/models/Complaint.js
const mongoose = require('mongoose')

const complaint_schema = new mongoose.Schema(
  {
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    subject: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['not addressed', 'addressed'],
      default: 'not addressed'
    }
  },
  {
    timestamps: true
  }
)

module.exports = mongoose.model('Complaint', complaint_schema)
