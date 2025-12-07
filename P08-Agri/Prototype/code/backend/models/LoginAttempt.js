const mongoose = require('mongoose')

const login_attempt_schema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    ip_address: {
      type: String
    },
    user_agent: {
      type: String
    },
    success: {
      type: Boolean,
      required: true
    },
    reason: {
      type: String
    }
  },
  {
    timestamps: true
  }
)

const LoginAttempt = mongoose.model('LoginAttempt', login_attempt_schema)

module.exports = LoginAttempt
