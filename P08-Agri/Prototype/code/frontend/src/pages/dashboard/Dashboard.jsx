import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetch_weather_by_coords } from '../../services/weatherService'
import { diagnose_image } from '../../services/diagnoseService'
import { send_complaint } from '../../services/helpService'
import { changePassword } from '../../services/authService'
import { send_chat_message } from '../../services/chatService'

function Dashboard() {
  const navigate = useNavigate()
  const user_json = localStorage.getItem('user') || '{}'
  const user = JSON.parse(user_json)

  const [is_getting_weather, set_is_getting_weather] = useState(false)
  const [weather_error, set_weather_error] = useState('')
  const [weather_data, set_weather_data] = useState(null)

  const [selected_file, set_selected_file] = useState(null)
  const [preview_url, set_preview_url] = useState('')
  const [is_uploading, set_is_uploading] = useState(false)
  const [diagnose_error, set_diagnose_error] = useState('')
  const [diagnose_result, set_diagnose_result] = useState(null)
  const file_input_ref = useRef(null)

  const [is_help_open, set_is_help_open] = useState(false)
  const [help_subject, set_help_subject] = useState('')
  const [help_message, set_help_message] = useState('')
  const [help_error_text, set_help_error_text] = useState('')
  const [help_success_text, set_help_success_text] = useState('')
  const [is_sending_help, set_is_sending_help] = useState(false)

  const [is_profile_menu_open, set_is_profile_menu_open] = useState(false)
  const [is_change_password_open, set_is_change_password_open] = useState(false)
  const [old_password_first, set_old_password_first] = useState('')
  const [old_password_second, set_old_password_second] = useState('')
  const [new_password, set_new_password] = useState('')
  const [cp_error_text, set_cp_error_text] = useState('')
  const [cp_success_text, set_cp_success_text] = useState('')
  const [is_changing_password, set_is_changing_password] = useState(false)

  const [is_chat_open, set_is_chat_open] = useState(false)
  const [chat_messages, set_chat_messages] = useState([])
  const [chat_input, set_chat_input] = useState('')
  const [is_sending_chat, set_is_sending_chat] = useState(false)
  const [chat_error_text, set_chat_error_text] = useState('')

  function handle_logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  function get_browser_location() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation is not available'))
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latitude = pos.coords.latitude
          const longitude = pos.coords.longitude
          resolve({ latitude, longitude })
        },
        () => {
          reject(new Error('Location permission denied or unavailable'))
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      )
    })
  }

  async function handle_get_weather() {
    if (is_getting_weather) {
      return
    }
    set_weather_error('')
    set_is_getting_weather(true)
    set_weather_data(null)
    try {
      const { latitude, longitude } = await get_browser_location()
      const data = await fetch_weather_by_coords(latitude, longitude)
      set_weather_data(data)
    } catch (err) {
      const msg = typeof err === 'string' ? err : (err && err.message ? err.message : 'Failed to get weather')
      set_weather_error(msg)
    } finally {
      set_is_getting_weather(false)
    }
  }

  function handle_click_upload_button() {
    if (file_input_ref.current) {
      file_input_ref.current.click()
    }
  }

  function handle_file_change(e) {
    const file = e.target.files && e.target.files[0]
    if (file) {
      set_selected_file(file)
      set_preview_url(URL.createObjectURL(file))
      set_diagnose_result(null)
      set_diagnose_error('')
      set_is_chat_open(false)
      set_chat_messages([])
      set_chat_input('')
      set_chat_error_text('')
    }
  }

  async function handle_analyze_click() {
    if (!selected_file) {
      set_diagnose_error('Please select an image')
      return
    }
    set_is_uploading(true)
    set_diagnose_error('')
    set_diagnose_result(null)
    set_is_chat_open(false)
    set_chat_messages([])
    set_chat_input('')
    set_chat_error_text('')
    try {
      const data = await diagnose_image(selected_file)
      set_diagnose_result(data)
    } catch (err) {
      const message = err && err.message ? err.message : 'Analysis failed'
      set_diagnose_error(message)
    } finally {
      set_is_uploading(false)
    }
  }

  useEffect(() => {
    if (diagnose_result) {
      const confidence =
        typeof diagnose_result.confidence === 'number'
          ? (diagnose_result.confidence * 100).toFixed(1)
          : 'unknown'

      const intro_message = {
        role: 'assistant',
        content:
          `I have analyzed the image. The diagnosis is "${diagnose_result.diagnosis}" ` +
          (confidence !== 'unknown' ? `with about ${confidence}% confidence. ` : '') +
          'You can ask follow-up questions about this result, suggested actions, or quality inspection concerns.'
      }

      set_is_chat_open(true)
      set_chat_messages([intro_message])
      set_chat_input('')
      set_chat_error_text('')
    } else {
      set_is_chat_open(false)
      set_chat_messages([])
      set_chat_input('')
      set_chat_error_text('')
    }
  }, [diagnose_result])

  function open_help_modal() {
    set_help_subject('')
    set_help_message('')
    set_help_error_text('')
    set_help_success_text('')
    set_is_sending_help(false)
    set_is_help_open(true)
  }

  function close_help_modal() {
    if (is_sending_help) {
      return
    }
    set_is_help_open(false)
  }

  function handle_help_subject_change(e) {
    set_help_subject(e.target.value)
    if (help_error_text) {
      set_help_error_text('')
    }
    if (help_success_text) {
      set_help_success_text('')
    }
  }

  function handle_help_message_change(e) {
    set_help_message(e.target.value)
    if (help_error_text) {
      set_help_error_text('')
    }
    if (help_success_text) {
      set_help_success_text('')
    }
  }

  async function handle_help_submit(e) {
    e.preventDefault()
    if (is_sending_help) {
      return
    }

    const subject_trimmed = help_subject.trim()
    const message_trimmed = help_message.trim()

    if (!subject_trimmed || !message_trimmed) {
      set_help_error_text('Subject and message are required')
      return
    }

    set_is_sending_help(true)
    set_help_error_text('')
    set_help_success_text('')

    try {
      await send_complaint({ subject: subject_trimmed, message: message_trimmed })
      set_help_success_text('Your message has been sent successfully')
      set_help_subject('')
      set_help_message('')
    } catch (error) {
      const message = error && error.message ? error.message : 'Failed to send help request'
      set_help_error_text(message)
    } finally {
      set_is_sending_help(false)
    }
  }

  function toggle_profile_menu() {
    set_is_profile_menu_open((prev) => !prev)
  }

  function open_change_password_modal() {
    set_is_profile_menu_open(false)
    set_old_password_first('')
    set_old_password_second('')
    set_new_password('')
    set_cp_error_text('')
    set_cp_success_text('')
    set_is_changing_password(false)
    set_is_change_password_open(true)
  }

  function close_change_password_modal() {
    if (is_changing_password) {
      return
    }
    set_is_change_password_open(false)
  }

  function handle_old_password_first_change(e) {
    set_old_password_first(e.target.value)
    if (cp_error_text) {
      set_cp_error_text('')
    }
    if (cp_success_text) {
      set_cp_success_text('')
    }
  }

  function handle_old_password_second_change(e) {
    set_old_password_second(e.target.value)
    if (cp_error_text) {
      set_cp_error_text('')
    }
    if (cp_success_text) {
      set_cp_success_text('')
    }
  }

  function handle_new_password_change(e) {
    set_new_password(e.target.value)
    if (cp_error_text) {
      set_cp_error_text('')
    }
    if (cp_success_text) {
      set_cp_success_text('')
    }
  }

  async function handle_change_password_submit(e) {
    e.preventDefault()
    if (is_changing_password) {
      return
    }

    const old1 = old_password_first
    const old2 = old_password_second
    const new_pass = new_password

    if (!old1 || !old2 || !new_pass) {
      set_cp_error_text('All fields are required')
      return
    }

    if (old1 !== old2) {
      set_cp_error_text('Old password entries do not match')
      return
    }

    if (new_pass.length < 8) {
      set_cp_error_text('New password must be at least 8 characters long')
      return
    }

    set_is_changing_password(true)
    set_cp_error_text('')
    set_cp_success_text('')

    try {
      await changePassword({ oldPassword: old1, newPassword: new_pass })
      set_cp_success_text('Your password has been changed successfully')
      set_old_password_first('')
      set_old_password_second('')
      set_new_password('')
    } catch (error) {
      const message = error && error.message ? error.message : 'Failed to change password'
      set_cp_error_text(message)
    } finally {
      set_is_changing_password(false)
    }
  }

  function handle_chat_input_change(e) {
    set_chat_input(e.target.value)
    if (chat_error_text) {
      set_chat_error_text('')
    }
  }

  async function handle_chat_submit(e) {
    e.preventDefault()
    if (is_sending_chat) {
      return
    }
    const trimmed = chat_input.trim()
    if (!trimmed) {
      return
    }
    if (!diagnose_result) {
      set_chat_error_text('Please run a diagnosis first.')
      return
    }

    const user_message = { role: 'user', content: trimmed }
    const next_messages = [...chat_messages, user_message]

    set_chat_messages(next_messages)
    set_chat_input('')
    set_is_sending_chat(true)
    set_chat_error_text('')

    try {
      const result = await send_chat_message({
        diagnosis: diagnose_result,
        messages: next_messages
      })

      const assistant_message = { role: 'assistant', content: result.content }
      set_chat_messages((prev) => [...prev, assistant_message])
    } catch (error) {
      const message = error && error.message ? error.message : 'Failed to contact assistant'
      set_chat_error_text(message)
    } finally {
      set_is_sending_chat(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">AgriQual Dashboard</h1>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handle_get_weather}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-60"
              disabled={is_getting_weather}
            >
              {is_getting_weather ? 'Getting weather...' : 'Get Weather update'}
            </button>
            <input
              ref={file_input_ref}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handle_file_change}
            />
            <button
              type="button"
              onClick={handle_click_upload_button}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-600"
            >
              Upload a Picture
            </button>
            <button
              type="button"
              onClick={open_help_modal}
              className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
              Help
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={toggle_profile_menu}
                className="flex items-center text-sm text-gray-600 hover:text-gray-800 focus:outline-none"
              >
                <span>
                  Welcome, <span className="font-medium">{user.name || 'User'}</span>
                </span>
                <svg
                  className="w-4 h-4 ml-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {is_profile_menu_open && (
                <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                  <button
                    type="button"
                    onClick={open_change_password_modal}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Change Password
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handle_logout}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {weather_error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {weather_error}
          </div>
        )}

        {weather_data && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Weather Update</h2>
              <p className="text-sm text-gray-600">
                {weather_data.city} • {weather_data.current.temperature_c}°C • Wind{' '}
                {weather_data.current.wind_speed_kmh} km/h
              </p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600">Max Temp</p>
                <p className="text-2xl font-semibold text-gray-900">{weather_data.today.tmax_c}°C</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600">Min Temp</p>
                <p className="text-2xl font-semibold text-gray-900">{weather_data.today.tmin_c}°C</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600">Precipitation</p>
                <p className="text-2xl font-semibold text-gray-900">{weather_data.today.precipitation_mm} mm</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600">UV Index</p>
                <p className="text-2xl font-semibold text-gray-900">{weather_data.today.uv_index_max}</p>
              </div>
            </div>
            <div className="px-6 pb-6">
              <h3 className="text-md font-semibold text-gray-900 mb-3">Farmer Advice</h3>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                {weather_data.advice.map((item, idx) => (
                  <li key={idx} className="text-sm">
                    {item}
                  </li>
                ))}
              </ul>
            {weather_data.llm_advice && (
              <div className="mt-6 bg-green-50 border border-green-100 rounded-xl p-5">
                <h4 className="text-lg font-semibold text-green-900">
                  More Detailed Explanations
                </h4>
                <p className="text-xs text-green-700 mt-1 mb-3">
                  Generated by the AI assistant from today&apos;s weather conditions.
                </p>
                <div className="text-sm text-green-900 whitespace-pre-line leading-relaxed space-y-2">
                  {weather_data.llm_advice}
                </div>
              </div>
            )}


            </div>
          </div>
        )}

        {selected_file && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Image Diagnosis</h2>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handle_analyze_click}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-60"
                  disabled={is_uploading}
                >
                  {is_uploading ? 'Analyzing...' : 'Analyze'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    set_selected_file(null)
                    set_preview_url('')
                    set_diagnose_result(null)
                    set_diagnose_error('')
                    set_is_chat_open(false)
                    set_chat_messages([])
                    set_chat_input('')
                    set_chat_error_text('')
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-900 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>{preview_url && <img src={preview_url} alt="preview" className="w-full rounded-lg shadow" />}</div>
              <div>
                {diagnose_error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                    {diagnose_error}
                  </div>
                )}
                {diagnose_result && (
                  <div className="space-y-3">
                    <div className="text-lg">
                      Diagnosis:{' '}
                      <span className="font-semibold capitalize">{diagnose_result.diagnosis}</span>
                    </div>
                    <div>
                      Confidence:{' '}
                      {typeof diagnose_result.confidence === 'number'
                        ? (diagnose_result.confidence * 100).toFixed(1) + '%'
                        : 'N/A'}
                    </div>
                    {Array.isArray(diagnose_result.recommendations) &&
                      diagnose_result.recommendations.length > 0 && (
                        <div>
                          <div className="font-medium">Recommendations</div>
                          <ul className="list-disc pl-6">
                            {diagnose_result.recommendations.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    {Array.isArray(diagnose_result.alternatives) &&
                      diagnose_result.alternatives.length > 0 && (
                        <div>
                          <div className="font-medium">Alternatives</div>
                          <ul className="list-disc pl-6">
                            {diagnose_result.alternatives.map((a, i) => (
                              <li key={i} className="capitalize">
                                {a.label} • {(a.confidence * 100).toFixed(1)}%
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    <div className="text-sm text-gray-600">
                      Processing time: {diagnose_result.processing_ms} ms
                    </div>
                  </div>
                )}
                {!diagnose_result && !diagnose_error && (
                  <p className="text-sm text-gray-600">Click Analyze to run the image through the model.</p>
                )}

                {is_chat_open && (
                  <div className="mt-6 border-t pt-4">
                    <h3 className="text-md font-semibold text-gray-900 mb-2">Chat with AgriQual Assistant</h3>
                    <div className="h-64 bg-gray-50 rounded-md p-3 overflow-y-auto mb-3">
                      {chat_messages.length === 0 && (
                        <p className="text-sm text-gray-500">
                          Ask follow-up questions about this diagnosis or inspection recommendations.
                        </p>
                      )}
                      {chat_messages.map((msg, index) => (
                        <div
                          key={index}
                          className={`mb-2 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                              msg.role === 'user'
                                ? 'bg-green-600 text-white'
                                : 'bg-white border border-gray-200 text-gray-900'
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      ))}
                    </div>

                    {chat_error_text && (
                      <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                        {chat_error_text}
                      </div>
                    )}

                    <form className="flex gap-2" onSubmit={handle_chat_submit}>
                      <input
                        type="text"
                        value={chat_input}
                        onChange={handle_chat_input_change}
                        disabled={is_sending_chat}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 text-sm"
                        placeholder="Ask a question about this diagnosis..."
                      />
                      <button
                        type="submit"
                        disabled={is_sending_chat || !chat_input.trim()}
                        className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60 text-sm flex items-center justify-center"
                      >
                        {is_sending_chat ? 'Sending...' : 'Send'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded-full">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">Total Inspections</p>
                <p className="text-2xl font-semibold text-gray-900">24</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded-full">
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">Pending</p>
                <p className="text-2xl font-semibold text-gray-900">8</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="p-3 bg-yellow-100 rounded-full">
                <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm text-gray-600">Farms Registered</p>
                <p className="text-2xl font-semibold text-gray-900">12</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          </div>
          <div className="divide-y divide-gray-200">
            <div className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Inspection completed for Farm #A123</p>
                  <p className="text-xs text-gray-500">2 hours ago</p>
                </div>
              </div>
              <span className="px-2 py-1 text-xs font-medium text-green-800 bg-green-100 rounded">Passed</span>
            </div>
            <div className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                <div>
                  <p className="text-sm font-medium text-gray-900">New farm registration pending review</p>
                  <p className="text-xs text-gray-500">5 hours ago</p>
                </div>
              </div>
              <span className="px-2 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded">Pending</span>
            </div>
            <div className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Report generated for Q3 2024</p>
                  <p className="text-xs text-gray-500">1 day ago</p>
                </div>
              </div>
              <span className="px-2 py-1 text-xs font-medium text-yellow-800 bg-yellow-100 rounded">Review</span>
            </div>
          </div>
        </div>
      </main>

      {is_help_open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 p-6 relative">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Need help?</h2>
              <button
                type="button"
                onClick={close_help_modal}
                className="text-gray-500 hover:text-gray-700"
                disabled={is_sending_help}
              >
                ✕
              </button>
            </div>

            {help_success_text && (
              <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded">
                <svg
                  className="w-5 h-5 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">{help_success_text}</span>
              </div>
            )}

            {help_error_text && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                {help_error_text}
              </div>
            )}

            <form className="space-y-4" onSubmit={handle_help_submit}>
              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="help_subject">
                  Subject
                </label>
                <input
                  id="help_subject"
                  type="text"
                  value={help_subject}
                  onChange={handle_help_subject_change}
                  disabled={is_sending_help}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100"
                  placeholder="Briefly describe your issue"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="help_message">
                  Message
                </label>
                <textarea
                  id="help_message"
                  rows={4}
                  value={help_message}
                  onChange={handle_help_message_change}
                  disabled={is_sending_help}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100"
                  placeholder="Tell us what you need help with"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={close_help_modal}
                  disabled={is_sending_help}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-60"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={is_sending_help}
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60 flex items-center justify-center"
                >
                  {is_sending_help && (
                    <svg
                      className="animate-spin h-5 w-5 mr-2 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      ></path>
                    </svg>
                  )}
                  {is_sending_help ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {is_change_password_open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 p-6 relative">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
              <button
                type="button"
                onClick={close_change_password_modal}
                className="text-gray-500 hover:text-gray-700"
                disabled={is_changing_password}
              >
                ✕
              </button>
            </div>

            {cp_success_text && (
              <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded">
                <svg
                  className="w-5 h-5 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">{cp_success_text}</span>
              </div>
            )}

            {cp_error_text && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                {cp_error_text}
              </div>
            )}

            <form className="space-y-4" onSubmit={handle_change_password_submit}>
              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="old_password_1">
                  Old password
                </label>
                <input
                  id="old_password_1"
                  type="password"
                  value={old_password_first}
                  onChange={handle_old_password_first_change}
                  disabled={is_changing_password}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100"
                  placeholder="Enter your current password"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="old_password_2">
                  Confirm old password
                </label>
                <input
                  id="old_password_2"
                  type="password"
                  value={old_password_second}
                  onChange={handle_old_password_second_change}
                  disabled={is_changing_password}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100"
                  placeholder="Re-enter your current password"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="new_password">
                  New password
                </label>
                <input
                  id="new_password"
                  type="password"
                  value={new_password}
                  onChange={handle_new_password_change}
                  disabled={is_changing_password}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100"
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={close_change_password_modal}
                  disabled={is_changing_password}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={is_changing_password}
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60 flex items-center justify-center"
                >
                  {is_changing_password && (
                    <svg
                      className="animate-spin h-5 w-5 mr-2 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      ></path>
                    </svg>
                  )}
                  {is_changing_password ? 'Changing...' : 'Change password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
