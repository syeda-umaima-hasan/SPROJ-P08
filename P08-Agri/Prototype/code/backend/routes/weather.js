// backend/routes/weather.js
const express = require('express')
const fetch = require('node-fetch')
const { getOpenAIClient } = require('../lib/openaiClient')

const router = express.Router()

function build_baseline_advice(today, current) {
  const advice = []

  const precip = typeof today.precipitation_mm === 'number' ? today.precipitation_mm : 0
  const tmax = typeof today.tmax_c === 'number' ? today.tmax_c : null
  const tmin = typeof today.tmin_c === 'number' ? today.tmin_c : null
  const uv = typeof today.uv_index_max === 'number' ? today.uv_index_max : null
  const wind = typeof current.wind_speed_kmh === 'number' ? current.wind_speed_kmh : null

  if (precip === 0) {
    advice.push(
      'No significant rain today: if soil is dry, plan irrigation early morning or late evening.'
    )
  } else if (precip < 5) {
    advice.push(
      'Light rain expected: avoid over-irrigation and check field for water pooling.'
    )
  } else {
    advice.push(
      'Heavy rain expected: delay irrigation and ensure drainage channels are clear.'
    )
  }

  if (typeof wind === 'number') {
    if (wind < 10) {
      advice.push(
        'Calmer winds: if spraying is needed, this is a suitable window.'
      )
    } else if (wind < 20) {
      advice.push(
        'Moderate winds: be cautious with spraying, use drift-reducing nozzles.'
      )
    } else {
      advice.push(
        'Strong winds: avoid spraying and secure any loose materials in the field.'
      )
    }
  }

  if (typeof uv === 'number') {
    if (uv >= 7) {
      advice.push(
        'High UV index: avoid mid-day field work and protect exposed skin.'
      )
    } else if (uv >= 4) {
      advice.push(
        'Moderate UV index: prefer morning and late-afternoon work hours.'
      )
    }
  }

  if (typeof tmax === 'number' && typeof tmin === 'number') {
    const avg = (tmax + tmin) / 2
    if (avg < 10) {
      advice.push(
        'Cool conditions: monitor crops for slow growth and consider adjusting irrigation frequency.'
      )
    } else if (avg > 30) {
      advice.push(
        'Hot conditions: irrigate during cooler hours and watch for heat stress symptoms.'
      )
    }
  }

  if (advice.length === 0) {
    advice.push(
      'Conditions look normal: continue routine field monitoring and standard agronomic practices.'
    )
  }

  return advice
}

async function build_llm_advice(payload) {
  const has_key = !!process.env.OPENAI_API_KEY
  if (!has_key) {
    return 'AI advisory is temporarily disabled because the server is not configured with an OpenAI API key. Please rely on the bullet-point recommendations for now.'
  }

  try {
    const client = getOpenAIClient()

    const { city, latitude, longitude, current, today } = payload

    const inputText = `
You are an expert Pakistani agronomy advisor specialising in wheat and smallholder farms.

Here is the current weather context for a farmer:
- Location: ${city || 'Unknown'} (lat ${latitude}, lon ${longitude})
- Current temperature: ${current.temperature_c} °C
- Current wind speed: ${current.wind_speed_kmh} km/h

Today's forecast:
- Max temperature: ${today.tmax_c} °C
- Min temperature: ${today.tmin_c} °C
- Precipitation: ${today.precipitation_mm} mm
- UV index (max): ${today.uv_index_max}
- Max wind gusts: ${today.wind_gust_max_kmh} km/h

Give a clear, practical, farmer-friendly advisory for **today only**, focused on wheat in Punjab, Pakistan. 
Structure the answer as:

1. Short summary of today’s conditions in one or two sentences.
2. "What you should do today" – 3–6 concrete action points (irrigation, spraying, field work, labour planning).
3. "What to avoid" – 2–4 things to NOT do today (e.g. avoid spraying in high wind, avoid irrigation before heavy rain).
4. Any special warnings if heat, cold, wind or heavy rain are significant.

Keep it under 250 words, simple language, no emojis, and no bullet points inside bullet points.
`.trim()

    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: inputText
    })

    const firstOutput = response.output && response.output[0]
    const firstContent = firstOutput && firstOutput.content && firstOutput.content[0]
    const text = firstContent && firstContent.text

    if (typeof text === 'string' && text.trim().length > 0) {
      return text.trim()
    }

    return 'AI assistant could not generate a detailed advisory. Please follow the basic recommendations shown above.'
  } catch (error) {
    console.error('LLM weather advisory error:', error.message || error)
    return 'AI advisory is temporarily unavailable due to a server error. Please follow the basic recommendations shown above and try again later.'
  }
}

router.get('/', async function (req, res) {
  const lat_param = req.query.lat
  const lon_param = req.query.lon

  const latitude = parseFloat(lat_param)
  const longitude = parseFloat(lon_param)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({
      ok: false,
      message: 'Missing or invalid lat/lon query parameters'
    })
  }

  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}` +
      '&current_weather=true' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,wind_speed_10m_max' +
      '&timezone=auto'

    const weather_res = await fetch(url)
    if (!weather_res.ok) {
      const text = await weather_res.text().catch(() => '')
      console.error('Weather API error:', weather_res.status, text)
      return res.status(502).json({
        ok: false,
        message: 'Upstream weather API failed',
        status: weather_res.status
      })
    }

    const data = await weather_res.json()

    const current_temp = data.current_weather && data.current_weather.temperature
    const current_wind = data.current_weather && data.current_weather.windspeed

    const today = {
      precipitation_mm:
        data.daily &&
        Array.isArray(data.daily.precipitation_sum) &&
        data.daily.precipitation_sum[0] != null
          ? Number(data.daily.precipitation_sum[0])
          : 0,
      tmax_c:
        data.daily &&
        Array.isArray(data.daily.temperature_2m_max) &&
        data.daily.temperature_2m_max[0] != null
          ? Number(data.daily.temperature_2m_max[0])
          : null,
      tmin_c:
        data.daily &&
        Array.isArray(data.daily.temperature_2m_min) &&
        data.daily.temperature_2m_min[0] != null
          ? Number(data.daily.temperature_2m_min[0])
          : null,
      uv_index_max:
        data.daily &&
        Array.isArray(data.daily.uv_index_max) &&
        data.daily.uv_index_max[0] != null
          ? Number(data.daily.uv_index_max[0])
          : null,
      wind_gust_max_kmh:
        data.daily &&
        Array.isArray(data.daily.wind_speed_10m_max) &&
        data.daily.wind_speed_10m_max[0] != null
          ? Number(data.daily.wind_speed_10m_max[0])
          : null
    }

    const current = {
      temperature_c: typeof current_temp === 'number' ? current_temp : null,
      wind_speed_kmh: typeof current_wind === 'number' ? current_wind : null
    }

    const city =
      data.timezone || `Field location (${latitude.toFixed(3)}, ${longitude.toFixed(3)})`

    const baseline_advice = build_baseline_advice(today, current)

    const payload_for_llm = {
      city,
      latitude,
      longitude,
      current,
      today
    }

    const llm_advice = await build_llm_advice(payload_for_llm)

    const response_payload = {
      city,
      latitude,
      longitude,
      current,
      today,
      advice: baseline_advice,
      llm_advice
    }

    res.json(response_payload)
  } catch (error) {
    console.error('Weather route error:', error.message || error)
    res.status(500).json({
      ok: false,
      message: 'Failed to fetch weather',
      error: error.message || String(error)
    })
  }
})

module.exports = router
