const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const User = require('../models/User')

const router = express.Router()

// ====== Security-related config ======
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h'
const LOGIN_MAX_FAILED_ATTEMPTS = Number.parseInt(process.env.LOGIN_MAX_FAILED_ATTEMPTS || '5', 10)
const LOGIN_LOCKOUT_MINUTES = Number.parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10)

// ====== Mail transport for OTP emails ======
let mailTransporter = null

if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  })
} else {
  console.warn('[Auth] SMTP is not fully configured; OTP emails may not be sent.')
}

async function sendOtpEmail(email, otp) {
  console.log('[Auth] Generated OTP for', email, '=>', otp)

  if (!mailTransporter) {
    console.warn('[Auth] No SMTP transporter configured. OTP will not be emailed.')
    return
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER

  const mailOptions = {
    from,
    to: email,
    subject: 'Your AgriQual verification code',
    text: `Your verification code is: ${otp}\n\nIt will expire in 10 minutes.`,
    html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It will expire in 10 minutes.</p>`
  }

  try {
    await mailTransporter.sendMail(mailOptions)
    console.log('[Auth] OTP email sent to', email)
  } catch (error) {
    const message = error && error.message ? error.message : error
    console.error('[Auth] Failed to send OTP email:', message)
    // We still keep the OTP stored; frontend can use debug_otp in non-production
  }
}

// ====== Helpers ======
function normalizeEmail(email) {
  if (!email) {
    return ''
  }
  return String(email).trim().toLowerCase()
}

function validateEmail(email) {
  const value = normalizeEmail(email)
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(value)
}

function validatePasswordStrength(password) {
  if (typeof password !== 'string') {
    return 'Password is required'
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters long'
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number'
  }
  return null
}

function createTokenForUser(user) {
  const payload = {
    sub: user._id.toString(),
    role: user.role || 'farmer'
  }

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })

  return token
}

function getLockoutSeconds(lockUntil) {
  if (!lockUntil) {
    return 0
  }
  const now = Date.now()
  const diffMs = lockUntil.getTime() - now
  if (diffMs <= 0) {
    return 0
  }
  return Math.round(diffMs / 1000)
}

// ====== Registration with OTP ======
// POST /api/auth/register-otp
router.post('/register-otp', async function (request, response) {
  try {
    const { name, email, phone, password, role } = request.body || {}

    const normalizedEmail = normalizeEmail(email)

    if (!name || !String(name).trim()) {
      return response.status(400).json({ message: 'Name is required' })
    }

    if (!validateEmail(normalizedEmail)) {
      return response.status(400).json({ message: 'Valid email is required' })
    }

    const passwordError = validatePasswordStrength(password)
    if (passwordError) {
      return response.status(400).json({ message: passwordError })
    }

    let user = await User.findOne({ email: normalizedEmail })

    if (user && user.email_verified === true) {
      return response
        .status(400)
        .json({ message: 'An account with this email already exists' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    if (!user) {
      user = new User({
        name: String(name).trim(),
        email: normalizedEmail,
        phone: phone || null,
        role: role || 'farmer',
        password_hash: passwordHash,
        email_verified: false
      })
    } else {
      user.name = String(name).trim()
      user.phone = phone || user.phone || null
      user.role = role || user.role || 'farmer'
      user.password_hash = passwordHash
      user.email_verified = false
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000))
    const otpHash = await bcrypt.hash(otp, 10)

    user.pending_otp_hash = otpHash
    user.pending_otp_expires_at = new Date(Date.now() + 10 * 60 * 1000)
    user.failed_login_attempts = 0
    user.lock_until = null

    await user.save()

    await sendOtpEmail(normalizedEmail, otp)

    const payload = {
      ok: true,
      message: 'Verification code has been sent to your email'
    }

    if (process.env.NODE_ENV !== 'production') {
      payload.debug_otp = otp
    }

    return response.json(payload)
  } catch (error) {
    const message = error && error.message ? error.message : error
    console.error('[Auth] /register-otp error:', message)
    return response.status(500).json({ message: 'Registration failed' })
  }
})

// ====== Verify OTP ======
// POST /api/auth/verify-otp
router.post('/verify-otp', async function (request, response) {
  try {
    const { email, otp } = request.body || {}

    const normalizedEmail = normalizeEmail(email)
    const code = String(otp || '').trim()

    if (!validateEmail(normalizedEmail)) {
      return response.status(400).json({ message: 'Valid email is required' })
    }

    if (!code || code.length < 4) {
      return response.status(400).json({ message: 'OTP code is required' })
    }

    const user = await User.findOne({ email: normalizedEmail })

    if (!user || !user.pending_otp_hash || !user.pending_otp_expires_at) {
      return response.status(400).json({ message: 'Invalid or expired verification code' })
    }

    const now = new Date()
    if (user.pending_otp_expires_at <= now) {
      return response.status(400).json({ message: 'Verification code has expired' })
    }

    const isMatch = await bcrypt.compare(code, user.pending_otp_hash)
    if (isMatch !== true) {
      return response.status(400).json({ message: 'Invalid verification code' })
    }

    user.email_verified = true
    user.pending_otp_hash = undefined
    user.pending_otp_expires_at = undefined
    user.failed_login_attempts = 0
    user.lock_until = null

    await user.save()

    const token = createTokenForUser(user)

    const safeUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role || 'farmer'
    }

    return response.json({
      token,
      user: safeUser
    })
  } catch (error) {
    const message = error && error.message ? error.message : error
    console.error('[Auth] /verify-otp error:', message)
    return response.status(500).json({ message: 'OTP verification failed' })
  }
})

// ====== Login ======
// POST /api/auth/login
router.post('/login', async function (request, response) {
  try {
    const { email, password } = request.body || {}

    const normalizedEmail = normalizeEmail(email)

    if (!validateEmail(normalizedEmail)) {
      return response.status(400).json({ message: 'Valid email is required' })
    }

    if (!password || typeof password !== 'string') {
      return response.status(400).json({ message: 'Password is required' })
    }

    const user = await User.findOne({ email: normalizedEmail })

    const baseLog = {
      email: normalizedEmail,
      ip: request.ip,
      time: new Date().toISOString()
    }

    if (!user) {
      console.log('[Auth][login] failed (no such user):', baseLog)
      return response.status(401).json({ message: 'Invalid email or password' })
    }

    const now = new Date()

    if (user.lock_until && user.lock_until > now) {
      const secondsLeft = getLockoutSeconds(user.lock_until)
      console.log('[Auth][login] locked out:', {
        ...baseLog,
        lockedUntil: user.lock_until.toISOString(),
        secondsLeft
      })

      return response.status(429).json({
        message: 'Too many failed login attempts. Your account is temporarily locked.',
        retryAfterSeconds: secondsLeft
      })
    }

    const storedHash = user.password_hash || user.password
    if (!storedHash) {
      console.log('[Auth][login] failed (no password hash):', baseLog)
      return response.status(401).json({ message: 'Invalid email or password' })
    }

    const isMatch = await bcrypt.compare(password, storedHash)

    if (!isMatch) {
      user.failed_login_attempts = (user.failed_login_attempts || 0) + 1

      if (user.failed_login_attempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
        user.lock_until = new Date(
          now.getTime() + LOGIN_LOCKOUT_MINUTES * 60 * 1000
        )
      }

      await user.save()

      if (user.lock_until && user.lock_until > now) {
        const secondsLeft = getLockoutSeconds(user.lock_until)
        console.log('[Auth][login] account locked due to repeated failures:', {
          ...baseLog,
          failedAttempts: user.failed_login_attempts,
          lockUntil: user.lock_until.toISOString(),
          secondsLeft
        })

        return response.status(429).json({
          message: 'Too many failed login attempts. Your account is temporarily locked.',
          retryAfterSeconds: secondsLeft
        })
      }

      console.log('[Auth][login] failed (wrong password):', {
        ...baseLog,
        failedAttempts: user.failed_login_attempts
      })

      return response.status(401).json({ message: 'Invalid email or password' })
    }

    user.failed_login_attempts = 0
    user.lock_until = null
    await user.save()

    const token = createTokenForUser(user)

    const safeUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role || 'farmer'
    }

    console.log('[Auth][login] success:', baseLog)

    return response.json({
      token,
      user: safeUser
    })
  } catch (error) {
    const message = error && error.message ? error.message : error
    console.error('[Auth] /login error:', message)
    return response.status(500).json({ message: 'Login failed' })
  }
})

// Optional legacy direct /register (without OTP) – kept for compatibility
router.post('/register', async function (request, response) {
  try {
    const { name, email, phone, password, role } = request.body || {}

    const normalizedEmail = normalizeEmail(email)

    if (!name || !String(name).trim()) {
      return response.status(400).json({ message: 'Name is required' })
    }

    if (!validateEmail(normalizedEmail)) {
      return response.status(400).json({ message: 'Valid email is required' })
    }

    const passwordError = validatePasswordStrength(password)
    if (passwordError) {
      return response.status(400).json({ message: passwordError })
    }

    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      return response.status(400).json({ message: 'An account with this email already exists' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const user = new User({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: phone || null,
      role: role || 'farmer',
      password_hash: passwordHash,
      email_verified: true,
      failed_login_attempts: 0,
      lock_until: null
    })

    await user.save()

    const token = createTokenForUser(user)

    const safeUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role || 'farmer'
    }

    return response.json({
      token,
      user: safeUser
    })
  } catch (error) {
    const message = error && error.message ? error.message : error
    console.error('[Auth] /register error:', message)
    return response.status(500).json({ message: 'Registration failed' })
  }
})

module.exports = router
