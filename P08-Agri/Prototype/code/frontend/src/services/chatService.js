// src/services/chatService.js

// Resolve your backend base URL (works for CRA or Vite)
const fromEnv =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  process.env.REACT_APP_API_BASE_URL;

const isLocalhost = window.location.hostname === 'localhost'
const isVercel = /\.vercel\.app$/.test(window.location.hostname)
const API_BASE =
  fromEnv || (isLocalhost ? 'http://localhost:5000' : (isVercel ? '' : 'https://sproj-p08-2.onrender.com'));

/**
 * Ask a question about a wheat diagnosis
 * @param {string} question - The user's question
 * @param {string} diagnosisId - The ID of the diagnosis from the database
 * @returns {Promise<object>} - Response with answer and diagnosis info
 */
export async function askQuestion(question, diagnosisId) {
  if (!question || !question.trim()) {
    throw new Error('Question is required');
  }

  if (!diagnosisId) {
    throw new Error('Diagnosis ID is required');
  }

  const url = `${API_BASE}/api/chat`;
  
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question: question.trim(), diagnosisId })
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // keep data as null
  }

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || data.detail)) ||
      `Chat request failed (${res.status})`;
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }

  return data; // { answer, diagnosis: {...}, timestamp }
}

