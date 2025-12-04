import axios from 'axios'
import { getToken } from './authService'

const from_env =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  process.env.REACT_APP_API_BASE_URL

const is_localhost = typeof window !== 'undefined' && window.location.hostname === 'localhost'
const is_vercel = typeof window !== 'undefined' && /\.vercel\.app$/.test(window.location.hostname)

const api_base =
  from_env || (is_localhost ? 'http://localhost:5000' : (is_vercel ? '' : 'https://sproj-p08-2.onrender.com'))

const chat_api = axios.create({
  baseURL: api_base + '/api/chat',
  headers: { 'Content-Type': 'application/json' }
})

export async function send_chat_message({ diagnosis, messages }) {
  const token = getToken()
  if (!token) {
    throw new Error('You must be logged in to use the assistant')
  }

  if (!diagnosis || !diagnosis.diagnosis) {
    throw new Error('No diagnosis found to discuss')
  }

  try {
    const response = await chat_api.post(
      '/',
      { diagnosis, messages },
      {
        headers: {
          Authorization: 'Bearer ' + token
        }
      }
    )

    const data = response.data || {}
    const text =
      data.reply ||
      data.message ||
      data.answer ||
      data.text ||
      ''

    if (!text) {
      throw new Error('Assistant returned an empty response')
    }

    return {
      content: text,
      raw: data
    }
  } catch (error) {
    const message =
      (error &&
        error.response &&
        error.response.data &&
        (error.response.data.message || error.response.data.error)) ||
      error.message ||
      'Assistant request failed'
    throw new Error(message)
  }
}

const chatService = {
  send_chat_message
}

export default chatService
