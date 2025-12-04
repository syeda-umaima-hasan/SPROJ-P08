const express = require('express')
const jwt = require('jsonwebtoken')
const OpenAI = require('openai')

const router = express.Router()

const openai_client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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

function build_system_prompt(diagnosis_payload, auth_user) {
  const lines = []

  lines.push(
    'You are AgriQual, a helpful assistant for wheat farmers in Pakistan. ' +
      'Use simple, clear language. Focus on practical field advice that small farmers can follow.'
  )

  if (auth_user && auth_user.email) {
    lines.push('The current authenticated user email is: ' + auth_user.email + '.')
  }

  if (diagnosis_payload && typeof diagnosis_payload === 'object') {
    const diagnosis_label = diagnosis_payload.diagnosis || 'unknown'
    const confidence_value =
      typeof diagnosis_payload.confidence === 'number'
        ? (diagnosis_payload.confidence * 100).toFixed(1) + '%'
        : 'unknown'

    lines.push(
      'The latest image analysis result for this user is as follows. ' +
        'You must treat this as a best-effort automated estimate, not a perfect ground truth.'
    )
    lines.push('Primary diagnosis: ' + diagnosis_label + '.')
    lines.push('Model confidence: ' + confidence_value + '.')

    if (Array.isArray(diagnosis_payload.recommendations) && diagnosis_payload.recommendations.length > 0) {
      const recommendations_text = diagnosis_payload.recommendations.join(' • ')
      lines.push('Model recommendations: ' + recommendations_text + '.')
    }

    if (Array.isArray(diagnosis_payload.alternatives) && diagnosis_payload.alternatives.length > 0) {
      const mapped_alternatives = diagnosis_payload.alternatives
        .map(function (alternative_item) {
          const label = alternative_item && alternative_item.label ? String(alternative_item.label) : 'unknown'
          if (typeof alternative_item.confidence === 'number') {
            const alternative_confidence = (alternative_item.confidence * 100).toFixed(1) + '%'
            return label + ' (' + alternative_confidence + ')'
          }
          return label
        })
        .join(' • ')
      lines.push('Alternative diagnoses considered by the model: ' + mapped_alternatives + '.')
    }
  } else {
    lines.push(
      'There is no structured diagnosis payload for this conversation. ' +
        'Answer as a general crop health assistant for wheat in Pakistan.'
    )
  }

  lines.push(
    'Always explain that the model can be wrong and that farmers should confirm important decisions with a local ' +
      'agronomist or extension worker. Avoid giving very precise chemical doses unless the farmer specifically asks; ' +
      'keep advice generic and safety focused. If you are unsure, say so clearly.'
  )

  return lines.join(' ')
}

function normalize_messages(raw_messages) {
  if (!Array.isArray(raw_messages)) {
    return []
  }

  const normalized = []

  raw_messages.forEach(function (raw_item) {
    if (!raw_item) {
      return
    }

    const role_value = raw_item.role === 'assistant' ? 'assistant' : 'user'
    const content_value = raw_item.content != null ? String(raw_item.content) : ''

    if (content_value.trim().length === 0) {
      return
    }

    normalized.push({
      role: role_value,
      content: content_value
    })
  })

  return normalized
}

router.post('/', async function (request, response) {
  try {
    const auth_user = get_auth_user(request)
    if (!auth_user) {
      response.status(401).json({ message: 'Unauthorized' })
      return
    }

    if (!process.env.OPENAI_API_KEY) {
      response.status(501).json({
        message: 'Chat service not configured',
        detail: 'Set OPENAI_API_KEY in the backend environment'
      })
      return
    }

    const request_body = request.body || {}
    const raw_messages = request_body.messages || []
    const diagnosis_payload = request_body.diagnosis || null
    const single_message = request_body.message || null

    let chat_messages = normalize_messages(raw_messages)

    if (chat_messages.length === 0 && single_message) {
      const single_text = String(single_message)
      if (single_text.trim().length > 0) {
        chat_messages.push({
          role: 'user',
          content: single_text.trim()
        })
      }
    }

    if (chat_messages.length === 0) {
      response.status(400).json({ message: 'At least one user message is required' })
      return
    }

    const system_prompt = build_system_prompt(diagnosis_payload, auth_user)

    const model_name = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

    const all_messages = [
      {
        role: 'system',
        content: system_prompt
      }
    ].concat(chat_messages)

    const completion = await openai_client.chat.completions.create({
      model: model_name,
      messages: all_messages,
      temperature: 0.4,
      max_tokens: 512
    })

    const first_choice = completion && completion.choices && completion.choices[0] ? completion.choices[0] : null
    const assistant_message =
      first_choice && first_choice.message && first_choice.message.content
        ? String(first_choice.message.content)
        : ''

    if (!assistant_message) {
      response.status(502).json({ message: 'Empty response from AI service' })
      return
    }

    const usage_block = completion && completion.usage ? completion.usage : null
    if (usage_block) {
      console.log('OpenAI chat usage:', usage_block)
    }

    response.json({
      reply: assistant_message
    })
  } catch (error) {
    const error_message = error && error.message ? error.message : error
    console.error('Chat route error:', error_message)
    response.status(502).json({
      message: 'Chatbot request failed',
      detail: 'Upstream AI error or network issue'
    })
  }
})

module.exports = router
