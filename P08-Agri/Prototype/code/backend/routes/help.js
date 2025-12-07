const express = require('express')
const jwt = require('jsonwebtoken')
const Complaint = require('../models/Complaint')
const { send_help_email } = require('../email_service')

const router = express.Router()

// ===== Rate limit config (per user) =====
const HELP_WINDOW_SECONDS =
  Number(process.env.HELP_TICKET_WINDOW_SECONDS) || 3600 // 1 hour
const HELP_MAX_PER_WINDOW =
  Number(process.env.HELP_TICKET_MAX_PER_WINDOW) || 5

// In-memory store: key = userId string, value = { count, windowStartMs }
const help_rate_store = new Map()

// ===== Read JWT from Authorization header =====
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
    console.error('[Help][jwt-verify-error]', error.message || error)
    return null
  }
}

// ===== Extract { user_id, email } from many possible payload shapes =====
function extract_identity(auth_user) {
  if (!auth_user || typeof auth_user !== 'object') {
    return null
  }

  // Some apps put stuff directly on payload, some under payload.user, etc.
  const candidates = [auth_user, auth_user.user, auth_user.data]

  let email = ''
  let user_id = ''

  for (const cand of candidates) {
    if (!cand || typeof cand !== 'object') {
      continue
    }

    if (!email && cand.email) {
      email = String(cand.email).trim().toLowerCase()
    }

    if (!user_id) {
      if (cand.userId) {
        user_id = String(cand.userId)
      } else if (cand._id) {
        user_id = String(cand._id)
      } else if (cand.id) {
        user_id = String(cand.id)
      }
    }
  }

  if (!email || !user_id) {
    return null
  }

  return { user_id, email }
}

// ===== Tiny text "sanitizer" (trim, collapse spaces, length cap) =====
function clean_text(value, max_len) {
  const str = typeof value === 'string' ? value : String(value || '')
  let trimmed = str.trim()
  trimmed = trimmed.replace(/\s+/g, ' ')
  if (max_len && trimmed.length > max_len) {
    trimmed = trimmed.slice(0, max_len)
  }
  return trimmed
}

// ===== Per-user rate limit =====
function check_help_rate_limit(user_id) {
  const now = Date.now()
  const window_ms = HELP_WINDOW_SECONDS * 1000
  const key = String(user_id)

  let entry = help_rate_store.get(key)
  if (!entry) {
    entry = { count: 0, windowStartMs: now }
    help_rate_store.set(key, entry)
  }

  const elapsed = now - entry.windowStartMs
  if (elapsed >= window_ms) {
    entry.count = 0
    entry.windowStartMs = now
  }

  entry.count += 1

  const remaining_ms = window_ms - (now - entry.windowStartMs)
  const retry_after_seconds = Math.max(1, Math.ceil(remaining_ms / 1000))

  console.log('[Help][rate-limit]', {
    user_id: key,
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

// ===== POST /api/help/complaints =====
router.post('/complaints', async function (request, response) {
  try {
    // 1) Require JWT
    const auth_user = get_auth_user(request)
    if (!auth_user) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    // 2) Extract identity (email + userId) from payload
    const identity = extract_identity(auth_user)
    if (!identity) {
      console.error('[Help][auth-payload-unusable]', auth_user)
      return response.status(401).json({ message: 'Unauthorized' })
    }

    const { user_id, email: user_email } = identity

    // 3) Rate-limit by user_id
    const rate_result = check_help_rate_limit(user_id)
    if (!rate_result.allowed) {
      return response.status(429).json({
        message:
          'You have reached the limit for help requests. Please try again later.',
        retryAfterSeconds: rate_result.retryAfterSeconds
      })
    }

    // 4) Validate + clean subject/message
    const subject_raw =
      (request.body && request.body.subject) ? request.body.subject : ''
    const message_raw =
      (request.body && request.body.message) ? request.body.message : ''

    const subject = clean_text(subject_raw, 200)
    const message = clean_text(message_raw, 4000)

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

    // 5) Store complaint (userEmail + userId are now guaranteed)
    const complaint = new Complaint({
      userEmail: user_email,
      userId: user_id,
      subject,
      message,
      status: 'not addressed'
    })

    await complaint.save()

    // 6) Fire support email (best-effort)
    try {
      await send_help_email({
        subject,
        message,
        userEmail: user_email
      })
    } catch (email_error) {
      console.error('[Help] Failed to send help email:', email_error)
      // Ticket is still stored in DB – we don't fail the request.
    }

    // 7) Success response (your frontend already handles this)
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
    console.error(
      'Help complaint error:',
      error && error.message ? error.message : error
    )
    return response.status(500).json({ message: 'Request failed' })
  }
})

module.exports = router
