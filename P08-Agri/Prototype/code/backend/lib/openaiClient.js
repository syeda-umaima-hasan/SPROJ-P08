const OpenAI = require('openai')

const api_key =
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_KEY ||
  process.env.OPENAI_API_TOKEN

console.log('[OpenAI] api key present?', Boolean(api_key))

let openai_client = null

if (api_key) {
  try {
    openai_client = new OpenAI({ apiKey: api_key })
    console.log('[OpenAI] client created successfully')
  } catch (error) {
    console.error('[OpenAI] failed to create client:', error.message || error)
  }
} else {
  console.warn('[OpenAI] no API key found; LLM weather advice disabled')
}

async function get_weather_llm_advice(payload) {
  if (!openai_client) {
    const msg = 'OpenAI client is null (likely no API key on server)'
    console.warn('[OpenAI]', msg)
    return { text: null, error: msg }
  }

  try {
    const city = payload.city || 'the user location'
    const current = payload.current || {}
    const today = payload.today || {}
    const advice = Array.isArray(payload.advice) ? payload.advice : []

    const system_message =
      'You are an expert Pakistani agronomy assistant. ' +
      'You receive structured weather data and must give practical, localized crop advice for small and medium farmers. ' +
      'Write in clear, simple English bullets, focusing on what to do and what to avoid today and in the next 24 hours.'

    const user_message =
      'Location: ' +
      city +
      '\n' +
      'Current conditions:\n' +
      '- Temperature: ' +
      current.temperature_c +
      '°C\n' +
      '- Wind speed: ' +
      current.wind_speed_kmh +
      ' km/h\n' +
      '\n' +
      'Today forecast:\n' +
      '- Max temp: ' +
      today.tmax_c +
      '°C\n' +
      '- Min temp: ' +
      today.tmin_c +
      '°C\n' +
      '- Precipitation: ' +
      today.precipitation_mm +
      ' mm\n' +
      '- Max UV index: ' +
      today.uv_index_max +
      '\n' +
      '\n' +
      'Baseline rule-based advice from the app:\n' +
      advice.map((x, i) => String(i + 1) + '. ' + x).join('\n') +
      '\n' +
      '\n' +
      'Using all this, give a detailed but concise advisory for crop care today and the next 24 hours. ' +
      'Use short paragraphs and bullet points. Start with a one line summary, then give 3–7 specific actions to take, ' +
      'and 3–5 things to avoid. Focus on irrigation, spraying, fertilizer, and disease risk.'

    console.log('[OpenAI] calling model gpt-4o-mini for weather advice')

    const response = await openai_client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system_message },
        { role: 'user', content: user_message }
      ],
      max_tokens: 400,
      temperature: 0.5
    })

    const content =
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content

    if (!content) {
      const msg = 'Empty content returned from OpenAI weather advice call'
      console.warn('[OpenAI]', msg)
      return { text: null, error: msg }
    }

    console.log('[OpenAI] weather advice generated successfully')
    return { text: String(content).trim(), error: null }
  } catch (error) {
    const status = error && error.status
    const detail =
      (error &&
        error.response &&
        error.response.data &&
        (error.response.data.message || error.response.data.error)) ||
      error.message ||
      String(error)

    console.error('[OpenAI] error while generating weather advice. status=', status, 'detail=', detail)
    return { text: null, error: 'status=' + status + ' detail=' + detail }
  }
}

module.exports = {
  get_weather_llm_advice
}
