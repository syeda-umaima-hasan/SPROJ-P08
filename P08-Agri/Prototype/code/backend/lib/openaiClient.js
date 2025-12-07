const OpenAI = require('openai')

const api_key = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const base_url = process.env.OPENAI_BASE_URL

console.log('[OpenAI] Initialising client...')
console.log('[OpenAI] Model:', model)
console.log('[OpenAI] Base URL:', base_url || '(default)')
console.log('[OpenAI] API key present?', api_key ? 'YES' : 'NO')

let client = null

if (api_key) {
  const options = { apiKey: api_key }

  if (base_url) {
    options.baseURL = base_url
  }

  try {
    client = new OpenAI(options)
    console.log('[OpenAI] Client created successfully')
  } catch (error) {
    console.error(
      '[OpenAI] Failed to create client:',
      error?.message || error
    )
    client = null
  }
} else {
  console.warn(
    '[OpenAI] OPENAI_API_KEY is missing. LLM weather advice will be disabled and llm_advice will be null.'
  )
}

async function get_llm_weather_advice(context) {
  if (!client) {
    console.warn('[OpenAI] Client not available, returning null advice')
    return null
  }

  try {
    const {
      city,
      latitude,
      longitude,
      current,
      today,
      advice
    } = context || {}

    const system_message =
      'You are an agricultural expert helping small wheat farmers in Pakistan. ' +
      'You will receive structured weather data (temperature, rain, wind, UV index) ' +
      'and some simple bullet-point recommendations. Your job is to generate a detailed, ' +
      'farmer-friendly explanation of what they should do today. ' +
      'Write clearly, in simple English, in 2–4 short paragraphs and 5–10 bullet points. ' +
      'Focus on irrigation, spraying, fertilizer, and anything to avoid today. ' +
      'Do NOT ask questions back to the user. Just give advice.'

    const user_message =
      `Location: ${city || 'Unknown'} (lat=${latitude}, lon=${longitude})\n` +
      `Current weather:\n` +
      `- Temperature: ${current?.temperature_c}°C\n` +
      `- Wind speed: ${current?.wind_speed_kmh} km/h\n\n` +
      `Today forecast:\n` +
      `- Max temp: ${today?.tmax_c}°C\n` +
      `- Min temp: ${today?.tmin_c}°C\n` +
      `- Precipitation: ${today?.precipitation_mm} mm\n` +
      `- Max UV index: ${today?.uv_index_max}\n` +
      `- Max wind gust: ${today?.wind_gust_max_kmh} km/h\n\n` +
      `Baseline crop-care recommendations:\n` +
      (Array.isArray(advice) ? advice.map((item) => `- ${item}`).join('\n') : '') +
      '\n\nNow generate a detailed but concise explanation for the farmer. ' +
      'Start with a short summary, then actions to take, then things to avoid.'

    console.log('[OpenAI] Calling model for weather advice...')

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.6,
      max_tokens: 600,
      messages: [
        { role: 'system', content: system_message },
        { role: 'user', content: user_message }
      ]
    })

    const text =
      completion.choices?.[0]?.message?.content?.trim() || null

    console.log(
      '[OpenAI] Weather advice generated. Length:',
      text ? text.length : 0
    )

    return text
  } catch (error) {
    console.error(
      '[OpenAI] Error while generating weather advice:',
      error?.response?.data || error?.message || error
    )
    return null
  }
}

module.exports = {
  get_llm_weather_advice
}
