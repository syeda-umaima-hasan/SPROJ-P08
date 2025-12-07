const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const User = require('../models/User')
const PasswordHistory = require('../models/PasswordHistory')
const PasswordSecurity = require('../models/PasswordSecurity')
const { send_password_change_email } = require('../email_service')

const router = express.Router()

// How many wrong attempts before lockout
const MAX_FAILED_ATTEMPTS = 5
// Lockout duration in minutes
const LOCKOUT_MINUTES = 15
// How many previous passwords to block reuse of
const PASSWORD_HISTORY_DEPTH = 5

function get_auth_user(request) {
  const auth_header = request.headers.authorization || ''
  console.log('[Account][auth-header]', auth_header)

  if (!auth_header.startsWith('Bearer ')) {
    console.warn('[Account][no-bearer-header]')
    return null
  }

  const token = auth_header.slice(7)
  if (!token) {
    console.warn('[Account][empty-token]')
    return null
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    console.log('[Account][jwt-payload]', payload)

    const user_id = payload.userId || payload.sub || payload.id || null
    const email = payload.email || payload.userEmail || null

    if (!user_id && !email) {
      console.warn('[Account][auth-payload-unusable]', payload)
      return null
    }

    return {
      userId: user_id,
      email: email
    }
  } catch (error) {
    console.error('[Account][jwt-verify-error]', error.message || error)
    if (error && error.stack) {
      console.error(error.stack)
    }
    return null
  }
}

function validate_new_password(password, user) {
  if (!password || typeof password !== 'string') {
    return 'New password is required'
  }

  const trimmed = password.trim()
  if (trimmed.length < 8) {
    return 'New password must be at least 8 characters long'
  }

  if (/\s/.test(trimmed)) {
    return 'New password cannot contain spaces'
  }

  const has_upper = /[A-Z]/.test(trimmed)
  const has_lower = /[a-z]/.test(trimmed)
  const has_digit = /\d/.test(trimmed)
  const has_symbol = /[^A-Za-z0-9]/.test(trimmed)
  const categories = [has_upper, has_lower, has_digit, has_symbol].filter(Boolean).length

  if (categories < 3) {
    return 'New password must include at least three of: uppercase letters, lowercase letters, numbers, and symbols'
  }

  const very_common = ['password', '12345678', 'qwerty', 'letmein', 'agriqual']
  if (very_common.includes(trimmed.toLowerCase())) {
    return 'New password is too common. Choose something harder to guess'
  }

  if (
    user?.email &&
    trimmed.toLowerCase().includes(String(user.email).split('@')[0].toLowerCase())
  ) {
    return 'New password must not contain your email username'
  }

  return null
}

async function get_or_create_security(user_id) {
  let doc = await PasswordSecurity.findOne({ userId: user_id })
  if (!doc) {
    doc = new PasswordSecurity({
      userId: user_id,
      failedAttempts: 0,
      lockUntil: null,
      lastAttemptAt: null
    })
    await doc.save()
  }
  return doc
}

async function check_lockout(security, now) {
  if (security.lockUntil && security.lockUntil > now) {
    const retry_after_sec = Math.ceil(
      (security.lockUntil.getTime() - now.getTime()) / 1000
    )
    return {
      locked: true,
      retryAfterSeconds: retry_after_sec
    }
  }
  return { locked: false }
}

async function handle_failed_attempt(security, now, user) {
  security.failedAttempts = (security.failedAttempts || 0) + 1
  security.lastAttemptAt = now

  if (security.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    security.lockUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000)
    console.warn(
      'Password change lockout:',
      user._id.toString(),
      'until',
      security.lockUntil.toISOString()
    )
  }

  await security.save()
}

async function check_password_history(user, new_password) {
  const recent_history = await PasswordHistory.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(PASSWORD_HISTORY_DEPTH)

  for (const entry of recent_history) {
    const reused = await bcrypt.compare(new_password, entry.passwordHash)
    if (reused) {
      return true // Password was reused
    }
  }
  return false // Password is new
}

function get_current_password_hash(user) {
  const current_hash = user.password_hash || user.password || null
  return current_hash
}

async function update_password(user, new_password, previous_hash, now) {
  if (previous_hash) {
    const history_entry = new PasswordHistory({
      userId: user._id,
      passwordHash: previous_hash,
      createdAt: now
    })
    await history_entry.save()
  }

  const salt_rounds = 10
  const new_hash = await bcrypt.hash(new_password, salt_rounds)

  user.password_hash = new_hash
  // Clear legacy field so we don't keep stale hashes around
  user.password = undefined

  await user.save()
}

router.post('/change-password', async function (request, response) {
  try {
    const auth_user = get_auth_user(request)
    console.log('[Account][change-password][auth_user]', auth_user)

    if (!auth_user) {
      return response.status(401).json({ message: 'Unauthorized' })
    }

    const old_password_raw = request.body?.oldPassword || ''
    const new_password_raw = request.body?.newPassword || ''

    const old_password = String(old_password_raw)
    const new_password = String(new_password_raw)

    if (!old_password || !new_password) {
      return response
        .status(400)
        .json({ message: 'Old password and new password are required' })
    }

    const user = await User.findById(auth_user.userId)
    if (!user) {
      return response.status(404).json({ message: 'User not found' })
    }

    console.log('[Account][user-found]', {
      id: user._id.toString(),
      email: user.email,
      hasPassword: !!(user.password_hash || user.password)
    })

    const security = await get_or_create_security(user._id)
    const now = new Date()

    const lockout_check = await check_lockout(security, now)
    if (lockout_check.locked) {
      return response.status(429).json({
        message: 'Too many incorrect password attempts. Please try again later.',
        retryAfterSeconds: lockout_check.retryAfterSeconds
      })
    }

    if (old_password === new_password) {
      return response
        .status(400)
        .json({ message: 'New password must be different from old password' })
    }

    const policy_error = validate_new_password(new_password, user)
    if (policy_error) {
      return response.status(400).json({ message: policy_error })
    }

    const current_hash = get_current_password_hash(user)

    if (!current_hash) {
      console.warn(
        '[Account][no-current-hash]',
        'User',
        user._id.toString(),
        'has no stored password'
      )
      return response.status(400).json({
        message:
          'This account does not have a password set yet. Please use "Forgot password" / reset flow.'
      })
    }

    const old_matches = await bcrypt.compare(old_password, current_hash)
    if (!old_matches) {
      await handle_failed_attempt(security, now, user)
      return response.status(400).json({ message: 'Old password is incorrect' })
    }

    security.failedAttempts = 0
    security.lockUntil = null
    security.lastAttemptAt = now
    await security.save()

    const same_as_current = await bcrypt.compare(new_password, current_hash)
    if (same_as_current) {
      return response
        .status(400)
        .json({ message: 'New password must be different from your current password' })
    }

    const password_reused = await check_password_history(user, new_password)
    if (password_reused) {
      return response
        .status(400)
        .json({ message: 'New password cannot reuse one of your recent passwords' })
    }

    await update_password(user, new_password, current_hash, now)

    const client_ip =
      request.headers['x-forwarded-for'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.ip

    console.log(
      'Password changed successfully for user',
      user._id.toString(),
      '(' + user.email + ')',
      'from IP',
      client_ip || 'unknown',
      'at',
      now.toISOString()
    )

    try {
      await send_password_change_email(user.email)
    } catch (email_error) {
      const emsg = email_error?.message || email_error
      console.error('Failed to send password change email:', emsg)
    }

    return response.json({ message: 'Password changed successfully' })
  } catch (error) {
    const msg = error?.message || error
    console.error('[Account][change-password-error]', msg)
    if (error && error.stack) {
      console.error(error.stack)
    }
    return response.status(500).json({ message: 'Server error' })
  }
})

module.exports = router
