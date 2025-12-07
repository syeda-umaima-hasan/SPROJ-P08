import axios from 'axios'

// Resolve backend base URL (works for CRA or Vite)
const fromEnv =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  process.env.REACT_APP_API_BASE_URL

const isLocalhost =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
const isVercel =
  typeof window !== 'undefined' && /\.vercel\.app$/.test(window.location.hostname)

const API_BASE =
  fromEnv ||
  (isLocalhost ? 'http://localhost:5000' : (isVercel ? '' : 'https://sproj-p08-2.onrender.com'))

const API_URL = `${API_BASE}/api/auth`

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' }
})

// ===== Direct register (no OTP) – kept for compatibility =====
export const register = async (userData) => {
  try {
    const response = await api.post('/register', userData)
    if (response.data?.token) {
      localStorage.setItem('token', response.data.token)
      localStorage.setItem('user', JSON.stringify(response.data.user))
    }
    return response.data
  } catch (error) {
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      'Registration failed'
    throw new Error(message)
  }
}

// ===== OTP-based register =====
export const registerWithOtp = async (userData) => {
  try {
    const response = await api.post('/register-otp', userData)
    // you can log debug_otp in dev if you want:
    if (response.data?.debug_otp && process.env.NODE_ENV !== 'production') {
      console.log('[Auth] Debug OTP (dev only):', response.data.debug_otp)
    }
    return response.data
  } catch (error) {
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      'Registration failed'
    throw new Error(message)
  }
}

export const verifyOtp = async ({ email, otp }) => {
  try {
    const response = await api.post('/verify-otp', { email, otp })
    if (response.data?.token) {
      localStorage.setItem('token', response.data.token)
      localStorage.setItem('user', JSON.stringify(response.data.user))
    }
    return response.data
  } catch (error) {
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      'OTP verification failed'
    throw new Error(message)
  }
}

// ===== Login =====
export const login = async (credentials) => {
  try {
    const response = await api.post('/login', credentials)
    if (response.data?.token) {
      localStorage.setItem('token', response.data.token)
      localStorage.setItem('user', JSON.stringify(response.data.user))
    }
    return response.data
  } catch (error) {
    let message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      'Login failed'

    // If backend indicates lockout (HTTP 429) with retryAfterSeconds, show a human-readable timer
    if (error?.response?.status === 429) {
      const rawSeconds = Number(error?.response?.data?.retryAfterSeconds)
      if (!Number.isNaN(rawSeconds) && rawSeconds > 0) {
        const minutes = Math.floor(rawSeconds / 60)
        const seconds = rawSeconds % 60

        let timePart = ''
        if (minutes > 0) {
          timePart += `${minutes} minute${minutes === 1 ? '' : 's'}`
        }
        if (seconds > 0) {
          if (timePart) {
            timePart += ' and '
          }
          timePart += `${seconds} second${seconds === 1 ? '' : 's'}`
        }
        if (!timePart) {
          timePart = `${rawSeconds} seconds`
        }

        message = `${message} You can try again in approximately ${timePart}.`
      }
    }

    throw new Error(message)
  }
}

// ===== Change password (when logged in) =====
export const getToken = () => localStorage.getItem('token')

export const changePassword = async ({ oldPassword, newPassword }) => {
  const token = getToken()
  if (!token) {
    throw new Error('You must be logged in to change your password')
  }

  try {
    const response = await axios.post(
      `${API_BASE}/api/account/change-password`,
      { oldPassword, newPassword },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        }
      }
    )
    return response.data
  } catch (error) {
    let message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      'Failed to change password'

    // If backend locked the user out, include human-readable time
    if (error?.response?.status === 429) {
      const rawSeconds = Number(error?.response?.data?.retryAfterSeconds)
      if (!Number.isNaN(rawSeconds) && rawSeconds > 0) {
        const minutes = Math.floor(rawSeconds / 60)
        const seconds = rawSeconds % 60

        let timePart = ''
        if (minutes > 0) {
          timePart += `${minutes} minute${minutes === 1 ? '' : 's'}`
        }
        if (seconds > 0) {
          if (timePart) {
            timePart += ' and '
          }
          timePart += `${seconds} second${seconds === 1 ? '' : 's'}`
        }
        if (!timePart) {
          timePart = `${rawSeconds} seconds`
        }

        message = `${message} You can try again in approximately ${timePart}.`
      }
    }

    throw new Error(message)
  }
}

// ===== Other helpers =====
export const logout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export const getCurrentUser = () => {
  const userStr = localStorage.getItem('user')
  return userStr ? JSON.parse(userStr) : null
}

export const isAuthenticated = () => !!getToken()

const authService = {
  register,
  registerWithOtp,
  verifyOtp,
  login,
  changePassword,
  logout,
  getCurrentUser,
  getToken,
  isAuthenticated
}

export default authService
