const express = require('express')
const jwt = require('jsonwebtoken')
const sanitize_html = require('sanitize-html')
const Complaint = require('../models/Complaint')
const { send_help_email } = require('../email_service')

const router = express.Router()

// ===== Auth helper =====
function get_auth_user(request) {
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
    return payload
  } catch (error) {
    return null
  }
}

// ===== Simple in-memory rate limiting (per user + IP) =====
// You can tune these numbers if you like.
const RATE_LIMIT_MAX_REQUESTS = 5          // how many complaints allowed
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000 // per 10 minutes
const RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000  // block for 15 minutes after limit

// Map key: `${userId}|${ip}`
// value: { count, windowStart, blockedUntil }
const rate_state = new Map()

function check_rate_limit(user_id, ip) {
  const now = Date.now()
  const key = String(user_id || 'unknown') + '|' + String(ip || 'unknown')

  let state = rate_state.get(key)
  if (!state) {
    state = {
      count: 0,
      windowStart: now,
      blockedUntil: 0
    }
  }

  // Still blocked?
  if (state.blockedUntil && now < state.blockedUntil) {
    const retryAfterMs = state.blockedUntil - now
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
    return {
      blocked: true,
      retryAfterSeconds
    }
  }

  // New window?
  if (now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    state.windowStart = now
    state.count = 0
  }

  state.count += 1

  // Over the limit: block
  if (state.count > RATE_LIMIT_MAX_REQUESTS) {
    state.blockedUntil = now + RATE_LIMIT_BLOCK_MS
    const retryAfterSeconds = Math.max(1, Math.ceil(RATE_LIMIT_BLOCK_MS / 1000))
    rate_state.set(key, state)
    return {
      blocked: true,
      retryAfterSeconds
    }
  }

  rate_state.set(key, state)
  return {
    blocked: false,
    retryAfterSeconds: 0
  }
}

// ===== /api/help/complaints =====
router.post('/complaints', async function (request, response) {
  try {
    // 1) Auth required
    const auth_user = get_auth_user(request)
    if (!auth_user) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    const user_email = String(auth_user.email || '').trim()
    const user_id =
      auth_user.userId ||
      auth_user._id ||
      auth_user.id ||
      null

    if (!user_email || !user_id) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    // 2) Rate limit (per user + IP)
    const ip =
      request.ip ||
      (request.connection && request.connection.remoteAddress) ||
      ''

    const rl = check_rate_limit(user_id, ip)
    if (rl.blocked) {
      response.set('Retry-After', String(rl.retryAfterSeconds))
      return response.status(429).json({
        message:
          'You have reached the limit for help requests. Please wait before sending another message.',
        retryAfterSeconds: rl.retryAfterSeconds
      })
    }

    // 3) Raw input
    const subject_raw =
      request.body && request.body.subject ? request.body.subject : ''
    const message_raw =
      request.body && request.body.message ? request.body.message : ''

    let subject = String(subject_raw).trim()
    let message = String(message_raw).trim()

    // 4) Basic presence check (matches your existing front-end behavior)
    if (!subject || !message) {
      return response.status(400).json({
        message: 'Subject and message are required'
      })
    }

    // 5) Length checks (no giant or tiny spammy messages)
    if (subject.length < 3 || subject.length > 200) {
      return response.status(400).json({
        message: 'Subject must be between 3 and 200 characters'
      })
    }

    if (message.length < 10 || message.length > 2000) {
      return response.status(400).json({
        message: 'Message must be between 10 and 2000 characters'
      })
    }

    // 6) Sanitize to remove HTML/JS (store + email only safe text)
    const sanitize_options = {
      allowedTags: [],
      allowedAttributes: {}
    }

    const safe_subject = sanitize_html(subject, sanitize_options).trim()
    const safe_message = sanitize_html(message, sanitize_options).trim()

    if (!safe_subject || !safe_message) {
      return response.status(400).json({
        message: 'Subject and message are required'
      })
    }

    // 7) Create complaint in DB (linked to user)
    const complaint = new Complaint({
      userEmail: user_email,
      userId: user_id,
      subject: safe_subject,
      message: safe_message,
      status: 'not addressed'
    })

    await complaint.save()

    // 8) Minimal email to support (sanitized + optional ticket id)
    await send_help_email({
      ticketId: complaint._id.toString(),
      subject: safe_subject,
      message: safe_message,
      userEmail: user_email
    })

    // 9) Audit log (no sensitive content)
    console.log('[Help] Complaint created', {
      ticketId: complaint._id.toString(),
      userId: String(user_id),
      email: user_email,
      ip: ip,
      time: new Date().toISOString()
    })

    // 10) Generic, safe response (no echo of full text)
    return response.status(201).json({
      message: 'Complaint submitted successfully',
      complaintId: complaint._id,
      createdAt: complaint.createdAt
    })
  } catch (error) {
    console.error(
      'Help complaint error:',
      (error && error.message) || error
    )
    return response.status(500).json({ message: 'Request failed' })
  }
})

module.exports = router
