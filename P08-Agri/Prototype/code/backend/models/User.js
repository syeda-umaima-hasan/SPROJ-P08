const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    phone: {
      type: String
    },

    role: {
      type: String,
      default: 'farmer'
    },

    // Legacy password field (NO LONGER REQUIRED)
    // kept only so old accounts that still have `password` continue to work
    password: {
      type: String,
      required: false
    },

    // New hashed password field (what we actually use now)
    password_hash: {
      type: String,
      required: false
    },

    // Email verification
    email_verified: {
      type: Boolean,
      default: false
    },

    // OTP for registration / verification
    pending_otp_hash: {
      type: String
    },

    pending_otp_expires_at: {
      type: Date
    },

    // Login security
    failed_login_attempts: {
      type: Number,
      default: 0
    },

    lock_until: {
      type: Date
    }
  },
  {
    timestamps: true
  }
)

// Ensure unique emails
userSchema.index({ email: 1 }, { unique: true })

const User = mongoose.model('User', userSchema)

module.exports = User
