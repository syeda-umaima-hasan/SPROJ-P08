const express = require('express')
const jwt = require('jsonwebtoken')
const Complaint = require('../models/Complaint')
const { send_help_email } = require('../email_service')

const router = express.Router()

// ===== Rate-limit config (per user) =====
const HELP_WINDOW_SECONDS = Number(process.env.HELP_TICKET_WINDOW_SECONDS) || 3600 // 1 hour
const HELP_MAX_PER_WINDOW = Number(process.env.HELP_TICKET_MAX_PER_WINDOW) || 5

// Simple in-memory store:
// key = userId string
// value = { count, windowStartMs }
const help_rate_store = new Map()

// ===== Helper: read auth user from JWT =====
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

// ===== Helper: small text "sanitizer" (trim + length cap) =====
function clean_text(value, max_len) {
  const str = typeof value === 'string' ? value : String(value || '')
  let trimmed = str.trim()

  // Collapse whitespace
  trimmed = trimmed.replace(/\s+/g, ' ')

  // Enforce max length
  if (max_len && trimmed.length > max_len) {
    trimmed = trimmed.slice(0, max_len)
  }

  return trimmed
}

// ===== Helper: rate-limit check =====
function check_help_rate_limit(auth_user) {
  const now = Date.now()
  const window_ms = HELP_WINDOW_SECONDS * 1000

  // Prefer explicit userId, but fall back to other typical fields
  const user_id_raw = auth_user.userId || auth_user._id || auth_user.id
  const user_key = user_id_raw ? String(user_id_raw) : null

  // If somehow we don't have a user id, treat it as a generic "anonymous"
  const key = user_key || 'anonymous'

  let entry = help_rate_store.get(key)

  if (!entry) {
    entry = { count: 0, windowStartMs: now }
    help_rate_store.set(key, entry)
  }

  const elapsed = now - entry.windowStartMs

  // If window has passed, reset
  if (elapsed >= window_ms) {
    entry.count = 0
    entry.windowStartMs = now
  }

  entry.count += 1

  const remaining_ms = window_ms - (now - entry.windowStartMs)
  const retry_after_seconds = Math.max(1, Math.ceil(remaining_ms / 1000))

  // Debug log so you can see behaviour in Render logs
  console.log('[Help][rate-limit]', {
    key,
    count: entry.count,
    window_start_iso: new Date(entry.windowStartMs).toISOString(),
    now_iso: new Date(now).toISOString(),
    window_seconds: HELP_WINDOW_SECONDS
  })

  if (entry.count > HELP_MAX_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: retry_after_seconds
    }
  }

  return { allowed: true }
}

// ===== Route: submit support complaint =====
router.post('/complaints', async function (request, response) {
  try {
    // 1) Require auth
    const auth_user = get_auth_user(request)
    if (!auth_user) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    // 2) Rate-limit per user
    const rate_result = check_help_rate_limit(auth_user)
    if (!rate_result.allowed) {
      return response.status(429).json({
        message: 'You have reached the limit for help requests. Please try again later.',
        retryAfterSeconds: rate_result.retryAfterSeconds
      })
    }

    // 3) Validate + clean input
    const subject_raw = request.body && request.body.subject ? request.body.subject : ''
    const message_raw = request.body && request.body.message ? request.body.message : ''

    const subject = clean_text(subject_raw, 200)  // 200 chars cap is plenty for subject
    const message = clean_text(message_raw, 4000) // 4k chars cap for message

    if (!subject && !message) {
      return response
        .status(400)
        .json({ message: 'Subject and message are required' })
    }

    if (!subject) {
      return response.status(400).json({ message: 'Subject is required' })
    }

    if (!message) {
      return response.status(400).json({ message: 'Message is required' })
    }

    // 4) Resolve user identity from token
    const user_email =
      (auth_user.email && String(auth_user.email).trim().toLowerCase()) || ''

    const user_id = auth_user.userId || auth_user._id || auth_user.id || null

    if (!user_email || !user_id) {
      console.error('[Help] Invalid auth payload for complaint:', auth_user)
      return response.status(401).json({ message: 'Unauthorized' })
    }

    // 5) Store complaint in Mongo
    const complaint = new Complaint({
      userEmail: user_email,
      userId: user_id,
      subject,
      message,
      status: 'not addressed'
    })

    await complaint.save()

    // 6) Send email to support (errors are logged but do not break the API)
    try {
      await send_help_email({
        subject,
        message,
        userEmail: user_email
      })
    } catch (email_error) {
      console.error('[Help] Failed to send help email:', email_error)
      // We still continue; the ticket is stored in DB anyway.
    }

    // 7) Success response – this is what your frontend already expects
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
