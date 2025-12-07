const express = require('express')
const axios = require('axios')
const multer = require('multer')
const FormData = require('form-data')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const Diagnosis = require('../models/Diagnosis')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

const diagnose_limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per window
  message: { message: 'Too many diagnosis requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

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
    console.error('JWT verification failed:', error.message)
    return null
  }
}

function get_ml_service_url() {
  const url = process.env.ML_SERVICE_URL || ''
  if (typeof url === 'string' && url.trim().length > 0) {
    return url.trim().replace(/\/+$/, '')
  }
  return ''
}

function validate_image_file(file) {
  if (!file) {
    return { valid: false, message: 'Image is required in field "image"' }
  }
  
  const max_size = 10 * 1024 * 1024
  if (file.size > max_size) {
    return { valid: false, message: 'Image size exceeds 10MB limit' }
  }
  
  const allowed_types = ['image/jpeg', 'image/jpg', 'image/png']
  if (!allowed_types.includes(file.mimetype)) {
    return { valid: false, message: 'Invalid image type. Only JPG and PNG are allowed' }
  }
  
  return { valid: true }
}

function get_error_message(status) {
  if (status === 404) return 'ML service unavailable'
  if (status === 415) return 'Unsupported image format'
  if (status === 429) return 'Service temporarily busy'
  return 'Diagnosis request failed'
}

router.post('/', diagnose_limiter, upload.single('image'), async (req, res) => {
  // Priority 1: Check authentication FIRST
  const auth_user = get_auth_user(req)
  if (!auth_user) {
    res.status(401).json({ message: 'Unauthorized' })
    return
  }
  
  // Priority 2: Validate image
  const validation = validate_image_file(req.file)
  if (!validation.valid) {
    res.status(400).json({ message: validation.message })
    return
  }
  
  const ml_base = get_ml_service_url()
  if (!ml_base) {
    res.status(501).json({ message: 'ML service not configured', detail: 'Set ML_SERVICE_URL in the backend environment' })
    return
  }
  try {
    const form = new FormData()
    const filename = req.file.originalname || 'uploaded.jpg'
    const content_type = req.file.mimetype || 'image/jpeg'
    form.append('image', req.file.buffer, { filename, contentType: content_type })
    const url = `${ml_base}/api/diagnose`
    const ml_resp = await axios.post(url, form, { headers: form.getHeaders(), timeout: 30000 })
    if (!ml_resp?.data) {
      res.status(502).json({ message: 'Empty response from ML service' })
      return
    }
    
    // Save diagnosis to database
    try {
      const diagnosis_record = new Diagnosis({
        user_id: auth_user.userId,
        diagnosis: ml_resp.data.diagnosis,
        confidence: ml_resp.data.confidence,
        alternatives: ml_resp.data.alternatives || [],
        recommendations: ml_resp.data.recommendations || [],
        processing_ms: ml_resp.data.processing_ms
      })
      await diagnosis_record.save()
    } catch (error_) {
      console.error('Failed to save diagnosis to database:', error_.message || error_)
      // Continue even if saving fails - user still gets result
    }
    
    res.json(ml_resp.data)
  } catch (err) {
    // Priority 3: Log detailed error but return generic message
    console.error('Diagnosis error:', err.message || err)
    const status = err?.response?.status ?? null
    const safe_message = get_error_message(status)
    res.status(502).json({ message: safe_message })
  }
})

module.exports = router
