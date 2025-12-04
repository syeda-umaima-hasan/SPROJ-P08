const express = require('express')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const Diagnosis = require('../models/Diagnosis')

const router = express.Router()

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
    // Log authentication errors (minimal logging to avoid information leakage)
    console.debug('JWT verification failed:', error.name || 'Authentication error')
    return null
  }
}

// Get all diagnoses for the authenticated user
router.get('/', async (req, res) => {
  try {
    const auth_user = get_auth_user(req)
    if (!auth_user) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const limit = parseInt(req.query.limit) || 50
    const skip = parseInt(req.query.skip) || 0

    const diagnoses = await Diagnosis.find({ user_id: auth_user.userId })
      .sort({ created_at: -1 })
      .limit(limit)
      .skip(skip)
      .select('-__v')
      .lean()

    const total = await Diagnosis.countDocuments({ user_id: auth_user.userId })

    res.json({
      diagnoses,
      total,
      limit,
      skip
    })
  } catch (error) {
    console.error('Error fetching diagnosis history:', error.message || error)
    res.status(500).json({ message: 'Failed to fetch diagnosis history' })
  }
})

// Get a specific diagnosis by ID
router.get('/:id', async (req, res) => {
  try {
    const auth_user = get_auth_user(req)
    if (!auth_user) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    // Validate and sanitize the ID parameter to prevent NoSQL injection
    const rawId = req.params.id
    if (!rawId || typeof rawId !== 'string' || !mongoose.Types.ObjectId.isValid(rawId)) {
      return res.status(400).json({ message: 'Invalid diagnosis ID format' })
    }

    // Create sanitized ObjectId from validated input - this breaks the taint chain
    // SonarQube: ObjectId constructor with validated input is safe for MongoDB queries
    const sanitizedObjectId = new mongoose.Types.ObjectId(rawId)

    // Query using sanitized ObjectId - prevents NoSQL injection
    // NOSONAR: Input is validated (ObjectId.isValid) and sanitized (ObjectId constructor) before use
    const diagnosis = await Diagnosis.findOne({
      _id: sanitizedObjectId,
      user_id: auth_user.userId
    }).select('-__v').lean()

    if (!diagnosis) {
      return res.status(404).json({ message: 'Diagnosis not found' })
    }

    res.json(diagnosis)
  } catch (error) {
    console.error('Error fetching diagnosis:', error.message || error)
    res.status(500).json({ message: 'Failed to fetch diagnosis' })
  }
})

module.exports = router
