const express = require('express')
const axios = require('axios')
const multer = require('multer')
const FormData = require('form-data')
const jwt = require('jsonwebtoken')
const Diagnosis = require('../models/Diagnosis')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

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

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'Image is required in field "image"' })
    return
  }
  
  const auth_user = get_auth_user(req)
  if (!auth_user) {
    res.status(401).json({ message: 'Unauthorized' })
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
    let diagnosis_record = null
    try {
      diagnosis_record = new Diagnosis({
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
    
    // Return ML response with diagnosis ID if saved
    const response_data = { ...ml_resp.data }
    if (diagnosis_record && diagnosis_record._id) {
      response_data.diagnosisId = diagnosis_record._id.toString()
    }
    
    res.json(response_data)
  } catch (err) {
    const status = err && err.response && err.response.status ? err.response.status : null
    const data = err && err.response && err.response.data ? err.response.data : null
    const safe_message = status === 404 ? 'ML endpoint not found' : status === 415 ? 'Unsupported image type' : status === 429 ? 'ML service rate-limited' : status ? `ML service error (${status})` : 'Network error contacting ML service'
    res.status(502).json({ message: 'Diagnosis failed', detail: safe_message, upstream: data })
  }
})

module.exports = router
