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
      trim: true,
      maxlength: 200
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000
    },
    status: {
      type: String,
      enum: ['not addressed', 'addressed'],
      default: 'not addressed'
    },
    ip_address: {
      type: String
    },
    user_agent: {
      type: String
    }
  },
  {
    timestamps: true
  }
)

module.exports = mongoose.model('Complaint', complaint_schema)
