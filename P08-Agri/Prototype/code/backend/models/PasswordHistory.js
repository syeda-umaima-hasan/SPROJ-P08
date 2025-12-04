const mongoose = require('mongoose')

const passwordHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      index: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    collection: 'password_histories'
  }
)

passwordHistorySchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model('PasswordHistory', passwordHistorySchema)
