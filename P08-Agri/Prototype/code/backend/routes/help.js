// backend/routes/help.js
const express = require('express')
const jwt = require('jsonwebtoken')
const Complaint = require('../models/Complaint')
const User = require('../models/User')
const { send_help_email } = require('../email_service')

const router = express.Router()

const HELP_WINDOW_MS = 5 * 60 * 1000
const HELP_MAX_REQUESTS = 5
const HELP_BLOCK_MS = 15 * 60 * 1000

const help_rate_state = new Map()

function get_auth_payload(request) {
  const auth_header = request.headers.authorization || ''
  if (!auth_header.startsWith('Bearer ')) {
    return null
  }
  const token = auth_header.slice(7)
  if (!token) {
    return null
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    return payload || null
  } catch (error) {
    return null
  }
}

function get_rate_key(request, user_id) {
  const ip = request.ip || request.connection?.remoteAddress || 'unknown'
  if (user_id) {
    return String(user_id) + '|' + ip
  }
  return 'anon|' + ip
}

function check_rate_limit(request, user_id) {
  const now = Date.now()
  const key = get_rate_key(request, user_id)
  let entry = help_rate_state.get(key)

  if (!entry) {
    entry = {
      count: 0,
      window_start: now,
      blocked_until: 0
    }
  }

  if (entry.blocked_until && entry.blocked_until > now) {
    const remaining_ms = entry.blocked_until - now
    const retry_after_seconds = Math.ceil(remaining_ms / 1000)
    return {
      allowed: false,
      retry_after_seconds
    }
  }

  if (now - entry.window_start > HELP_WINDOW_MS) {
    entry.count = 0
    entry.window_start = now
  }

  entry.count += 1

  if (entry.count > HELP_MAX_REQUESTS) {
    entry.blocked_until = now + HELP_BLOCK_MS
    help_rate_state.set(key, entry)
    return {
      allowed: false,
      retry_after_seconds: Math.ceil(HELP_BLOCK_MS / 1000)
    }
  }

  help_rate_state.set(key, entry)

  return {
    allowed: true,
    retry_after_seconds: 0
  }
}

function sanitize_text(input, max_length) {
  if (!input) {
    return ''
  }
  let value = String(input)
  value = value.replace(/[\u0000-\u001F\u007F]+/g, ' ')
  value = value.replace(/<\s*script[^>]*>.*?<\s*\/\s*script\s*>/gi, '')
  if (value.length > max_length) {
    value = value.slice(0, max_length)
  }
  return value.trim()
}

router.post('/complaints', async function (request, response) {
  try {
    const payload = get_auth_payload(request)
    if (!payload) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    const user_id =
      payload.userId ||
      payload.id ||
      payload._id ||
      payload.sub ||
      null

    let user_email =
      payload.email ||
      payload.userEmail ||
      ''

    if (!user_id) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    if (!user_email) {
      const db_user = await User.findById(user_id).select('email')
      if (!db_user || !db_user.email) {
        return response.status(401).json({ message: 'Unauthorized' })
      }
      user_email = db_user.email
    }

    const rate_result = check_rate_limit(request, user_id)
    if (!rate_result.allowed) {
      return response.status(429).json({
        message: 'Too many help requests. Please wait before trying again.',
        retryAfterSeconds: rate_result.retry_after_seconds
      })
    }

    const subject_raw = request.body && request.body.subject ? request.body.subject : ''
    const message_raw = request.body && request.body.message ? request.body.message : ''

    const subject = sanitize_text(subject_raw, 200)
    const message = sanitize_text(message_raw, 5000)

    if (!subject && !message) {
      return response.status(400).json({ message: 'Subject and message are required' })
    }

    if (!subject) {
      return response.status(400).json({ message: 'Subject is required' })
    }

    if (!message) {
      return response.status(400).json({ message: 'Message is required' })
    }

    const complaint = new Complaint({
      userEmail: String(user_email || '').trim().toLowerCase(),
      userId: user_id,
      subject,
      message,
      status: 'not addressed'
    })

    await complaint.save()

    await send_help_email({
      subject,
      message,
      userEmail: complaint.userEmail
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
