const express = require('express')
const axios = require('axios')
const multer = require('multer')
const FormData = require('form-data')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const Diagnosis = require('../models/Diagnosis')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

// Priority 4: Rate limiting - 10 requests per minute per IP
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

router.post('/', diagnose_limiter, upload.single('image'), async (req, res) => {
  // Priority 1: Check authentication FIRST
  const auth_user = get_auth_user(req)
  if (!auth_user) {
    res.status(401).json({ message: 'Unauthorized' })
    return
  }
  
  // Priority 2: Validate image is present
  if (!req.file) {
    res.status(400).json({ message: 'Image is required in field "image"' })
    return
  }
  
  // Priority 2: Validate file size (max 10MB)
  const max_size = 10 * 1024 * 1024
  if (req.file.size > max_size) {
    res.status(400).json({ message: 'Image size exceeds 10MB limit' })
    return
  }
  
  // Priority 2: Validate file type (only jpg, png)
  const allowed_types = ['image/jpeg', 'image/jpg', 'image/png']
  if (!allowed_types.includes(req.file.mimetype)) {
    res.status(400).json({ message: 'Invalid image type. Only JPG and PNG are allowed' })
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
    if (!ml_resp || !ml_resp.data) {
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
    } catch (db_err) {
      console.error('Failed to save diagnosis to database:', db_err.message || db_err)
      // Continue even if saving fails - user still gets result
    }
    
    res.json(ml_resp.data)
  } catch (err) {
    // Priority 3: Log detailed error but return generic message
    console.error('Diagnosis error:', err.message || err)
    const status = err && err.response && err.response.status ? err.response.status : null
    const safe_message = status === 404 ? 'ML service unavailable' : status === 415 ? 'Unsupported image format' : status === 429 ? 'Service temporarily busy' : 'Diagnosis request failed'
    res.status(502).json({ message: safe_message })
  }
})

module.exports = router
