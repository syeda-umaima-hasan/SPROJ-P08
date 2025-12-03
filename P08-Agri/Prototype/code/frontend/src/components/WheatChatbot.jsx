import React, { useState, useRef, useEffect } from 'react'
import { askQuestion } from '../services/chatService'

function WheatChatbot({ diagnosis, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Get diagnosis ID - try different possible fields
  const diagnosisId = diagnosis?.diagnosisId || diagnosis?._id || diagnosis?.id || null

  useEffect(() => {
    // Initialize with welcome message when diagnosis is available
    if (diagnosis && diagnosis.diagnosis) {
      const confidencePercent = diagnosis.confidence 
        ? (diagnosis.confidence * 100).toFixed(1) 
        : 'N/A'
      
      setMessages([{
        role: 'bot',
        content: `I've analyzed your wheat image. Diagnosis: **${diagnosis.diagnosis}** (${confidencePercent}% confidence). How can I help you today?`
      }])
    }
  }, [diagnosis])

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    // Focus input when component mounts
    inputRef.current?.focus()
  }, [])

  async function handleSend() {
    if (!input.trim() || isLoading) return

    if (!diagnosisId) {
      setError('Diagnosis ID not found. Please analyze the image again.')
      return
    }

    const userMessage = input.trim()
    setInput('')
    setError('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const response = await askQuestion(userMessage, diagnosisId)
      
      setMessages(prev => [...prev, { 
        role: 'bot', 
        content: response.answer 
      }])
    } catch (err) {
      const errorMsg = err && err.message ? err.message : 'Failed to get response. Please try again.'
      setError(errorMsg)
      setMessages(prev => [...prev, { 
        role: 'bot', 
        content: `Sorry, I encountered an error: ${errorMsg}`,
        isError: true
      }])
    } finally {
      setIsLoading(false)
    }
  }

  function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!diagnosis) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white rounded-lg shadow-2xl border border-gray-200 flex flex-col h-[600px] z-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 py-3 rounded-t-lg flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xl">💬</span>
          <h3 className="font-semibold">Wheat Crop Advisor</h3>
        </div>
        <button 
          onClick={onClose} 
          className="text-white hover:text-gray-200 transition-colors"
          aria-label="Close chatbot"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Diagnosis Summary */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-medium text-gray-700 mb-1">📊 Diagnosis Summary:</p>
        <p className="text-sm text-gray-900 font-medium">
          {diagnosis.diagnosis} 
          {diagnosis.confidence && (
            <span className="text-gray-600 ml-1">
              ({(diagnosis.confidence * 100).toFixed(1)}%)
            </span>
          )}
        </p>
        {diagnosis.recommendations && diagnosis.recommendations.length > 0 && (
          <p className="text-xs text-gray-600 mt-1">
            Recommendations: {diagnosis.recommendations.slice(0, 2).join(', ')}
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === 'user'
                  ? 'bg-green-600 text-white'
                  : msg.isError
                  ? 'bg-red-100 text-red-800 border border-red-300'
                  : 'bg-white text-gray-900 border border-gray-200'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-lg px-3 py-2 border border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 p-3 bg-white">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask a question about your diagnosis..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-600 text-sm"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Ask about treatment, prevention, or any questions about your crop diagnosis.
        </p>
      </div>
    </div>
  )
}

export default WheatChatbot

