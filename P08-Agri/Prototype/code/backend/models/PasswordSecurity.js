const mongoose = require('mongoose')

const passwordSecuritySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      unique: true
    },
    failedAttempts: {
      type: Number,
      default: 0
    },
    lockUntil: {
      type: Date,
      default: null
    },
    lastAttemptAt: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'password_security_states',
    timestamps: true
  }
)

module.exports = mongoose.model('PasswordSecurity', passwordSecuritySchema)
