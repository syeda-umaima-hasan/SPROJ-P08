const express = require('express')
const jwt = require('jsonwebtoken')
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

    let limit = parseInt(req.query.limit) || 50
    if (isNaN(limit) || limit <= 0) {
      limit = 50
    }
    if (limit > 50) {
      limit = 50
    }
    
    let skip = parseInt(req.query.skip) || 0
    if (isNaN(skip) || skip < 0) {
      skip = 0
    }

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
    res.status(500).json({ message: 'Request failed' })
  }
})

// Get a specific diagnosis by ID
router.get('/:id', async (req, res) => {
  try {
    const auth_user = get_auth_user(req)
    if (!auth_user) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const id_pattern = /^[0-9a-fA-F]{24}$/
    if (!id_pattern.test(req.params.id)) {
      return res.status(400).json({ message: 'Invalid diagnosis ID format' })
    }

    const diagnosis = await Diagnosis.findOne({
      _id: req.params.id,
      user_id: auth_user.userId
    }).select('-__v').lean()

    if (!diagnosis) {
      return res.status(404).json({ message: 'Diagnosis not found' })
    }

    res.json(diagnosis)
  } catch (error) {
    console.error('Error fetching diagnosis:', error.message || error)
    res.status(500).json({ message: 'Request failed' })
  }
})

module.exports = router
