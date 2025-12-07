import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { get_diagnosis_history } from '../../services/historyService'

function formatDate(dateString) {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function getConfidenceColor(confidence) {
  if (confidence >= 0.8) return 'text-green-600'
  if (confidence >= 0.6) return 'text-yellow-600'
  return 'text-red-600'
}

function getConfidenceBg(confidence) {
  if (confidence >= 0.8) return 'bg-green-100'
  if (confidence >= 0.6) return 'bg-yellow-100'
  return 'bg-red-100'
}

function getConfidenceBarColor(confidence) {
  if (confidence >= 0.8) return 'bg-green-600'
  if (confidence >= 0.6) return 'bg-yellow-600'
  return 'bg-red-600'
}

function DiagnosticHistory() {
  const navigate = useNavigate()
  const [diagnoses, set_diagnoses] = useState([])
  const [is_loading, set_is_loading] = useState(true)
  const [error, set_error] = useState('')
  const [total, set_total] = useState(0)
  const [selected_diagnosis, set_selected_diagnosis] = useState(null)
  const [is_detail_modal_open, set_is_detail_modal_open] = useState(false)

  useEffect(() => {
    load_history()
  }, [])

  async function load_history() {
    set_is_loading(true)
    set_error('')
    try {
      const data = await get_diagnosis_history(50, 0)
      set_diagnoses(data.diagnoses || [])
      set_total(data.total || 0)
    } catch (err) {
      set_error(err.message || 'Failed to load diagnosis history')
    } finally {
      set_is_loading(false)
    }
  }

  function handle_back_to_dashboard() {
    navigate('/farmer-dashboard')
  }

  function handle_view_details(diagnosis) {
    set_selected_diagnosis(diagnosis)
    set_is_detail_modal_open(true)
  }

  function close_detail_modal() {
    set_is_detail_modal_open(false)
    set_selected_diagnosis(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={handle_back_to_dashboard}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Diagnostic History</h1>
            </div>
            <div className="text-sm text-gray-600">
              {total > 0 && <span>{total} total diagnoses</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {is_loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <p className="text-red-800">{error}</p>
            </div>
          </div>
        )}

        {!is_loading && !error && diagnoses.length === 0 && (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-lg font-medium text-gray-900">No diagnostic history</h3>
            <p className="mt-1 text-sm text-gray-500">Start by analyzing some crop images!</p>
            <button
              onClick={handle_back_to_dashboard}
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {!is_loading && !error && diagnoses.length > 0 && (
          <div className="space-y-4">
            {diagnoses.map((diagnosis) => (
              <div
                key={diagnosis._id}
                role="button"
                tabIndex={0}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => handle_view_details(diagnosis)}
                onKeyDown={(e) => e.key === 'Enter' && handle_view_details(diagnosis)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{diagnosis.diagnosis}</h3>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getConfidenceBg(diagnosis.confidence)} ${getConfidenceColor(diagnosis.confidence)}`}>
                        {(diagnosis.confidence * 100).toFixed(1)}% confident
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{formatDate(diagnosis.created_at)}</p>
                    {diagnosis.recommendations && diagnosis.recommendations.length > 0 && (
                      <div className="mt-3">
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">Top recommendation:</span> {diagnosis.recommendations[0]}
                        </p>
                      </div>
                    )}
                  </div>
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {is_detail_modal_open && selected_diagnosis && (
        <div 
          role="dialog" 
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto" 
          onClick={close_detail_modal}
          onKeyDown={(e) => e.key === 'Escape' && close_detail_modal()}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div
              role="document"
              className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-2xl font-bold text-gray-900">Diagnosis Details</h3>
                  <button
                    onClick={close_detail_modal}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="block text-sm font-medium text-gray-700 mb-1">Diagnosis</div>
                    <p className="text-lg font-semibold text-gray-900">{selected_diagnosis.diagnosis}</p>
                  </div>

                  <div>
                    <div className="block text-sm font-medium text-gray-700 mb-1">Confidence</div>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-3">
                        <div
                          className={`h-3 rounded-full ${getConfidenceBarColor(selected_diagnosis.confidence)}`}
                          style={{ width: `${selected_diagnosis.confidence * 100}%` }}
                        ></div>
                      </div>
                      <span className={`text-sm font-medium ${getConfidenceColor(selected_diagnosis.confidence)}`}>
                        {(selected_diagnosis.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="block text-sm font-medium text-gray-700 mb-1">Date</div>
                    <p className="text-gray-900">{formatDate(selected_diagnosis.created_at)}</p>
                  </div>

                  {selected_diagnosis.alternatives && selected_diagnosis.alternatives.length > 0 && (
                    <div>
                      <div className="block text-sm font-medium text-gray-700 mb-2">Alternative Diagnoses</div>
                      <div className="space-y-2">
                        {selected_diagnosis.alternatives.map((alt, index) => (
                          <div key={alt.label || `alt-${index}`} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                            <span className="text-gray-900">{alt.label}</span>
                            <span className="text-sm text-gray-600">{(alt.confidence * 100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selected_diagnosis.recommendations && selected_diagnosis.recommendations.length > 0 && (
                    <div>
                      <div className="block text-sm font-medium text-gray-700 mb-2">Recommendations</div>
                      <ul className="space-y-2">
                        {selected_diagnosis.recommendations.map((rec, index) => (
                          <li key={`rec-${index}-${rec.substring(0, 20)}`} className="flex items-start">
                            <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-gray-900">{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selected_diagnosis.processing_ms && (
                    <div className="text-xs text-gray-500">
                      Processing time: {selected_diagnosis.processing_ms}ms
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  onClick={close_detail_modal}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DiagnosticHistory
