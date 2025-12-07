const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const User = require('../models/User')
const LoginAttempt = require('../models/LoginAttempt')

const router = express.Router()

const jwt_secret = process.env.JWT_SECRET || 'change_me_in_production'
const jwt_expires_in = process.env.JWT_EXPIRES_IN || '2h'

const max_failed_attempts = parseInt(process.env.LOGIN_MAX_FAILED_ATTEMPTS || '5', 10)
const lockout_minutes = parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10)

const failed_login_by_email = new Map()

function normalize_email(email) {
  if (typeof email !== 'string') {
    return ''
  }
  return email.trim().toLowerCase()
}

function validate_email_format(email) {
  const email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const is_valid = email_regex.test(email)
  return is_valid
}

function validate_password_strength(password) {
  if (typeof password !== 'string') {
    return 'Password is required'
  }

  if (password.length < 8) {
    return 'Password must be at least 8 characters long'
  }

  const has_uppercase = /[A-Z]/.test(password)
  const has_lowercase = /[a-z]/.test(password)
  const has_digit = /[0-9]/.test(password)
  const has_symbol = /[^A-Za-z0-9]/.test(password)

  if (!has_uppercase) {
    return 'Password must contain at least one uppercase letter'
  }

  if (!has_lowercase) {
    return 'Password must contain at least one lowercase letter'
  }

  if (!has_digit) {
    return 'Password must contain at least one number'
  }

  if (!has_symbol) {
    return 'Password must contain at least one special character'
  }

  return null
}

function sanitize_user(user) {
  return {
    id: user._id,
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role
  }
}

function create_jwt_for_user(user) {
  const payload = {
    sub: String(user._id),
    role: user.role
  }

  const token = jwt.sign(payload, jwt_secret, { expiresIn: jwt_expires_in })
  return token
}

function get_client_ip(request) {
  const forwarded_for = request.headers['x-forwarded-for']
  if (typeof forwarded_for === 'string' && forwarded_for.length > 0) {
    const parts = forwarded_for.split(',')
    if (parts.length > 0) {
      const first = parts[0].trim()
      if (first.length > 0) {
        return first
      }
    }
  }

  if (request.ip) {
    return request.ip
  }

  if (request.connection && request.connection.remoteAddress) {
    return request.connection.remoteAddress
  }

  return 'unknown'
}

function enforce_https_if_production(request, response, next) {
  const is_production = process.env.NODE_ENV === 'production'
  if (!is_production) {
    next()
    return
  }

  const x_forwarded_proto = request.headers['x-forwarded-proto']
  const is_secure = request.secure === true || x_forwarded_proto === 'https'

  if (is_secure) {
    next()
    return
  }

  response.status(400).json({
    message: 'HTTPS is required for this endpoint'
  })
}

function get_failed_record(email) {
  const key = normalize_email(email)
  const existing = failed_login_by_email.get(key)
  if (!existing) {
    const record = {
      failed_count: 0,
      locked_until: null
    }
    failed_login_by_email.set(key, record)
    return record
  }
  return existing
}

function get_lockout_seconds_remaining(record) {
  if (!record || !record.locked_until) {
    return 0
  }
  const now = Date.now()
  const diff_ms = record.locked_until.getTime() - now
  if (diff_ms <= 0) {
    return 0
  }
  const seconds = Math.ceil(diff_ms / 1000)
  return seconds
}

function is_email_locked(email) {
  const record = get_failed_record(email)
  const seconds_remaining = get_lockout_seconds_remaining(record)
  if (seconds_remaining > 0) {
    return {
      is_locked: true,
      retry_after_seconds: seconds_remaining
    }
  }
  return {
    is_locked: false,
    retry_after_seconds: 0
  }
}

function register_failed_login(email) {
  const record = get_failed_record(email)
  const now = Date.now()
  const is_currently_locked = get_lockout_seconds_remaining(record) > 0
  if (is_currently_locked) {
    const seconds_remaining = get_lockout_seconds_remaining(record)
    return {
      is_locked: true,
      retry_after_seconds: seconds_remaining
    }
  }

  record.failed_count += 1

  if (record.failed_count >= max_failed_attempts) {
    const lock_until = new Date(now + lockout_minutes * 60 * 1000)
    record.locked_until = lock_until
    record.failed_count = 0
    const seconds = get_lockout_seconds_remaining(record)
    return {
      is_locked: true,
      retry_after_seconds: seconds
    }
  }

  failed_login_by_email.set(normalize_email(email), record)
  return {
    is_locked: false,
    retry_after_seconds: 0
  }
}

function clear_failed_login(email) {
  const key = normalize_email(email)
  if (failed_login_by_email.has(key)) {
    failed_login_by_email.delete(key)
  }
}

async function log_login_attempt(options) {
  try {
    const payload = {
      email: normalize_email(options.email),
      ip_address: options.ip_address,
      user_agent: options.user_agent,
      success: options.success,
      reason: options.reason
    }

    if (options.user_id && mongoose.Types.ObjectId.isValid(String(options.user_id))) {
      payload.user_id = options.user_id
    }

    await LoginAttempt.create(payload)
  } catch (error) {
  }
}

router.post('/register-otp', enforce_https_if_production, async function (request, response) {
  try {
    const name = typeof request.body.name === 'string' ? request.body.name.trim() : ''
    const raw_email = typeof request.body.email === 'string' ? request.body.email : ''
    const email = normalize_email(raw_email)
    const phone = typeof request.body.phone === 'string' ? request.body.phone.trim() : ''
    const password = typeof request.body.password === 'string' ? request.body.password : ''
    const raw_role = typeof request.body.role === 'string' ? request.body.role.trim() : ''
    const allowed_roles = ['farmer', 'inspector']
    const role = allowed_roles.includes(raw_role) ? raw_role : 'farmer'

    if (name.length === 0 || name.length > 120) {
      response.status(400).json({ message: 'Name is required and must be at most 120 characters' })
      return
    }

    if (!validate_email_format(email)) {
      response.status(400).json({ message: 'A valid email address is required' })
      return
    }

    if (phone.length > 0 && phone.length > 40) {
      response.status(400).json({ message: 'Phone number is too long' })
      return
    }

    const password_error = validate_password_strength(password)
    if (password_error) {
      response.status(400).json({ message: password_error })
      return
    }

    const existing_user = await User.findOne({ email }).exec()
    if (existing_user) {
      response.status(400).json({ message: 'An account with this email already exists' })
      return
    }

    const password_hash = await bcrypt.hash(password, 12)

    const otp_code = String(Math.floor(100000 + Math.random() * 900000))
    const otp_expires_at = new Date(Date.now() + 10 * 60 * 1000)

    const otp_payload = {
      name,
      email,
      phone,
      role,
      password_hash,
      otp_code,
      otp_expires_at
    }

    const OtpModel =
      mongoose.models.SignupOtp ||
      mongoose.model(
        'SignupOtp',
        new mongoose.Schema(
          {
            name: String,
            email: { type: String, required: true, unique: true, lowercase: true, trim: true },
            phone: String,
            role: { type: String, default: 'farmer' },
            password_hash: { type: String, required: true },
            otp_code: { type: String, required: true },
            otp_expires_at: { type: Date, required: true }
          },
          { timestamps: true }
        )
      )

    await OtpModel.findOneAndUpdate({ email }, otp_payload, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }).exec()

    response.json({
      message: 'Verification code sent to your email address'
    })
  } catch (error) {
    response.status(500).json({
      message: 'Failed to start registration'
    })
  }
})

router.post('/verify-otp', enforce_https_if_production, async function (request, response) {
  try {
    const raw_email = typeof request.body.email === 'string' ? request.body.email : ''
    const email = normalize_email(raw_email)
    const otp_input = typeof request.body.otp === 'string' ? request.body.otp.trim() : ''

    if (!validate_email_format(email)) {
      response.status(400).json({ message: 'Invalid verification code or email' })
      return
    }

    if (otp_input.length < 4 || otp_input.length > 10) {
      response.status(400).json({ message: 'Invalid verification code or email' })
      return
    }

    const OtpModel =
      mongoose.models.SignupOtp ||
      mongoose.model(
        'SignupOtp',
        new mongoose.Schema(
          {
            name: String,
            email: { type: String, required: true, unique: true, lowercase: true, trim: true },
            phone: String,
            role: { type: String, default: 'farmer' },
            password_hash: { type: String, required: true },
            otp_code: { type: String, required: true },
            otp_expires_at: { type: Date, required: true }
          },
          { timestamps: true }
        )
      )

    const otp_record = await OtpModel.findOne({ email }).exec()
    if (!otp_record) {
      response.status(400).json({ message: 'Invalid or expired verification code' })
      return
    }

    const now = new Date()
    if (!otp_record.otp_expires_at || otp_record.otp_expires_at.getTime() < now.getTime()) {
      await OtpModel.deleteOne({ _id: otp_record._id }).exec()
      response.status(400).json({ message: 'Invalid or expired verification code' })
      return
    }

    if (otp_record.otp_code !== otp_input) {
      response.status(400).json({ message: 'Invalid or expired verification code' })
      return
    }

    let user = await User.findOne({ email }).exec()
    if (!user) {
      user = new User({
        name: otp_record.name,
        email: otp_record.email,
        phone: otp_record.phone,
        role: otp_record.role,
        password_hash: otp_record.password_hash
      })
    } else {
      user.name = otp_record.name
      user.phone = otp_record.phone
      user.role = otp_record.role
      user.password_hash = otp_record.password_hash
    }

    await user.save()
    await OtpModel.deleteOne({ _id: otp_record._id }).exec()

    const token = create_jwt_for_user(user)
    const safe_user = sanitize_user(user)

    response.json({
      token,
      user: safe_user
    })
  } catch (error) {
    response.status(500).json({
      message: 'Verification failed'
    })
  }
})

router.post('/login', enforce_https_if_production, async function (request, response) {
  const ip_address = get_client_ip(request)
  const user_agent = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : ''

  try {
    const raw_email = typeof request.body.email === 'string' ? request.body.email : ''
    const email = normalize_email(raw_email)
    const password = typeof request.body.password === 'string' ? request.body.password : ''

    if (!validate_email_format(email) || password.length === 0) {
      await log_login_attempt({
        email,
        user_id: null,
        ip_address,
        user_agent,
        success: false,
        reason: 'invalid_request'
      })
      response.status(400).json({ message: 'Invalid email or password' })
      return
    }

    const lock_status = is_email_locked(email)
    if (lock_status.is_locked) {
      await log_login_attempt({
        email,
        user_id: null,
        ip_address,
        user_agent,
        success: false,
        reason: 'account_locked'
      })
      const seconds = lock_status.retry_after_seconds
      const minutes_remaining = Math.ceil(seconds / 60)
      response.status(429).json({
        message: 'Too many failed login attempts. Please try again later.',
        retryAfterSeconds: seconds,
        retryAfterMinutes: minutes_remaining
      })
      return
    }

    const user = await User.findOne({ email }).exec()

    let stored_hash = null
    if (user && typeof user.password_hash === 'string' && user.password_hash.length > 0) {
      stored_hash = user.password_hash
    } else if (user && typeof user.password === 'string' && user.password.length > 0) {
      stored_hash = user.password
    }

    let password_matches = false

    if (user && stored_hash) {
      const looks_like_bcrypt =
        stored_hash.startsWith('$2a$') ||
        stored_hash.startsWith('$2b$') ||
        stored_hash.startsWith('$2y$')

      if (looks_like_bcrypt) {
        password_matches = await bcrypt.compare(password, stored_hash)
      } else {
        if (stored_hash === password) {
          password_matches = true
          const new_hash = await bcrypt.hash(password, 12)
          user.password_hash = new_hash
          user.password = undefined
          await user.save()
        }
      }
    }

    if (!user || !password_matches) {
      const lock_after_failure = register_failed_login(email)

      await log_login_attempt({
        email,
        user_id: user ? user._id : null,
        ip_address,
        user_agent,
        success: false,
        reason: lock_after_failure.is_locked ? 'lockout' : 'invalid_credentials'
      })

      if (lock_after_failure.is_locked) {
        const seconds = lock_after_failure.retry_after_seconds
        const minutes_remaining = Math.ceil(seconds / 60)
        response.status(429).json({
          message: 'Too many failed login attempts. Please try again later.',
          retryAfterSeconds: seconds,
          retryAfterMinutes: minutes_remaining
        })
        return
      }

      response.status(401).json({ message: 'Invalid email or password' })
      return
    }

    clear_failed_login(email)

    await log_login_attempt({
      email,
      user_id: user._id,
      ip_address,
      user_agent,
      success: true,
      reason: 'success'
    })

    const token = create_jwt_for_user(user)
    const safe_user = sanitize_user(user)

    response.json({
      token,
      user: safe_user
    })
  } catch (error) {
    await log_login_attempt({
      email: '',
      user_id: null,
      ip_address,
      user_agent,
      success: false,
      reason: 'server_error'
    })

    response.status(500).json({
      message: 'Login failed. Please try again.'
    })
  }
})

module.exports = router
