const express = require('express');
const { generateChatResponse } = require('../services/geminiChatService');
const Diagnosis = require('../models/Diagnosis');
const jwt = require('jsonwebtoken');

const router = express.Router();

/**
 * Get authenticated user from request
 */
function get_auth_user(request) {
  const auth_header = request.headers.authorization || '';
  if (!auth_header.startsWith('Bearer ')) {
    return null;
  }
  const token = auth_header.slice(7);
  if (!token) {
    return null;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * POST /api/chat
 * Send a question about a wheat diagnosis
 * 
 * Body: {
 *   question: string (required),
 *   diagnosisId: string (required)
 * }
 */
router.post('/', async (req, res) => {
  try {
    // Check authentication
    const auth_user = get_auth_user(req);
    if (!auth_user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Please log in to use the chatbot' 
      });
    }

    const { question, diagnosisId } = req.body;

    // Validate input
    if (!question || !question.trim()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        message: 'Question is required' 
      });
    }

    if (!diagnosisId) {
      return res.status(400).json({ 
        error: 'Validation failed',
        message: 'Diagnosis ID is required. Please analyze an image first.' 
      });
    }

    // Fetch diagnosis from database
    let diagnosis;
    try {
      diagnosis = await Diagnosis.findById(diagnosisId);
    } catch (dbError) {
      console.error('Database error fetching diagnosis:', dbError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Failed to fetch diagnosis. Please try again.'
      });
    }

    if (!diagnosis) {
      return res.status(404).json({
        error: 'Diagnosis not found',
        message: 'Diagnosis not found. Please analyze an image first.'
      });
    }

    // Verify the diagnosis belongs to the user (optional security check)
    if (diagnosis.user_id && diagnosis.user_id.toString() !== auth_user.userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this diagnosis.'
      });
    }

    // Build diagnosis context
    const diagnosisContext = {
      diagnosis: diagnosis.diagnosis,
      confidence: diagnosis.confidence,
      alternatives: diagnosis.alternatives || [],
      recommendations: diagnosis.recommendations || []
    };

    // Generate response using Gemini
    let answer;
    try {
      answer = await generateChatResponse(question.trim(), diagnosisContext);
    } catch (geminiError) {
      console.error('Gemini chat error:', geminiError);
      return res.status(500).json({
        error: 'Chat service error',
        message: geminiError.message || 'Failed to generate response. Please try again.'
      });
    }

    // Return response
    res.json({
      answer,
      diagnosis: {
        condition: diagnosisContext.diagnosis,
        confidence: diagnosisContext.confidence
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat route error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred. Please try again.'
    });
  }
});

module.exports = router;

