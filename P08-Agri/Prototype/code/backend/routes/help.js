const express = require('express')
const jwt = require('jsonwebtoken')
const Complaint = require('../models/Complaint')
const { send_help_email } = require('../email_service')

const router = express.Router()

const jwt_secret = process.env.JWT_SECRET || 'dev_jwt_secret_change_me'
const rate_limit_window_ms = 10 * 60 * 1000
const rate_limit_max_requests = 5

function get_auth_user(request) {
  const auth_header = request.headers.authorization || ''
  if (!auth_header.startsWith('Bearer ')) {
    return null
  }

  const token = auth_header.slice(7).trim()
  if (!token) {
    return null
  }

  try {
    const payload = jwt.verify(token, jwt_secret)
    return payload
  } catch (error) {
    return null
  }
}

router.post('/complaints', async function (request, response) {
  try {
    const auth_user = get_auth_user(request)
    if (!auth_user) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    const subject_raw = request.body && request.body.subject ? request.body.subject : ''
    const message_raw = request.body && request.body.message ? request.body.message : ''

    const subject_clean = String(subject_raw).trim().replace(/\s+/g, ' ')
    const message_clean = String(message_raw).trim()

    if (!subject_clean && !message_clean) {
      return response.status(400).json({ message: 'Subject and message are required' })
    }
    if (!subject_clean) {
      return response.status(400).json({ message: 'Subject is required' })
    }
    if (!message_clean) {
      return response.status(400).json({ message: 'Message is required' })
    }

    const subject = subject_clean.slice(0, 200)
    const message = message_clean.slice(0, 4000)

    const now = Date.now()
    const window_start = new Date(now - rate_limit_window_ms)

    const recent_count = await Complaint.countDocuments({
      userId: auth_user.userId,
      createdAt: { $gte: window_start }
    })

    if (recent_count >= rate_limit_max_requests) {
      const oldest_in_window = await Complaint.findOne({
        userId: auth_user.userId,
        createdAt: { $gte: window_start }
      })
        .sort({ createdAt: 1 })
        .lean()

      let retry_after_seconds = 60
      if (oldest_in_window && oldest_in_window.createdAt) {
        const block_expires_at =
          new Date(oldest_in_window.createdAt).getTime() + rate_limit_window_ms
        const remaining_ms = block_expires_at - now
        if (remaining_ms > 0) {
          retry_after_seconds = Math.ceil(remaining_ms / 1000)
        }
      }

      return response.status(429).json({
        message: 'Too many help requests. Please wait before trying again.',
        retryAfterSeconds: retry_after_seconds
      })
    }

    const complaint = new Complaint({
      userEmail: auth_user.email,
      userId: auth_user.userId,
      subject,
      message,
      status: 'not addressed'
    })

    await complaint.save()

    await send_help_email({
      subject,
      message,
      userEmail: auth_user.email
    })

    return response.status(201).json({
      message: 'Complaint submitted successfully',
      complaint: {
        id: complaint._id,
        userEmail: complaint.userEmail,
        subject: complaint.subject,
        message: complaint.message,
        status: complaint.status,
        createdAt: complaint.createdAt
      }
    })
  } catch (error) {
    console.error('Help complaint error:', error && error.message ? error.message : error)
    return response.status(500).json({ message: 'Request failed' })
  }
})

module.exports = router
