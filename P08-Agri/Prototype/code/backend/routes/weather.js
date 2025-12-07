const express = require('express')
const router = express.Router()
const fetch = require('node-fetch')
const { get_weather_llm_advice } = require('../lib/openaiClient')

const WEATHER_API_KEY = process.env.WEATHER_API_KEY
const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'

function build_rule_based_advice(today) {
  const lines = []

  if (today.precipitation_mm === 0) {
    lines.push(
      'No significant rain today: if soil is dry, plan irrigation early morning or late evening.'
    )
  } else if (today.precipitation_mm > 0 && today.precipitation_mm < 10) {
    lines.push(
      'Light to moderate rain expected: avoid unnecessary irrigation and watch for water logging in low-lying areas.'
    )
  } else if (today.precipitation_mm >= 10) {
    lines.push(
      'Heavy rain expected: make sure drainage channels are clear and avoid irrigation or spraying today.'
    )
  }

  if (today.uv_index_max >= 7) {
    lines.push(
      'High UV index: avoid working in the field during peak afternoon hours and protect workers with caps and hydration.'
    )
  }

  if (today.wind_gust_max_kmh && today.wind_gust_max_kmh > 25) {
    lines.push(
      'Strong winds expected: avoid pesticide or herbicide spraying and secure loose materials in the field.'
    )
  } else {
    lines.push(
      'Calmer winds: if spraying is needed, this is a suitable window, but always follow label safety instructions.'
    )
  }

  return lines
}

router.get('/', async function (request, response) {
  try {
    const lat_raw = request.query.lat
    const lon_raw = request.query.lon

    if (!lat_raw || !lon_raw) {
      return response.status(400).json({
        ok: false,
        message: 'lat and lon query parameters are required'
      })
    }

    const latitude = Number(lat_raw)
    const longitude = Number(lon_raw)

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return response.status(400).json({
        ok: false,
        message: 'lat and lon must be valid numbers'
      })
    }

    const weather_url =
      WEATHER_API_URL +
      '?latitude=' +
      encodeURIComponent(latitude) +
      '&longitude=' +
      encodeURIComponent(longitude) +
      '&hourly=temperature_2m,precipitation,wind_speed_10m,uv_index' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,wind_gusts_10m_max' +
      '&current_weather=true' +
      '&timezone=auto'

    console.log('[Weather] fetching from open-meteo:', weather_url)

    const res = await fetch(weather_url)
    const data = await res.json()

    if (!res.ok) {
      console.error('[Weather] weather api error status=', res.status, 'body=', data)
      return response.status(502).json({
        ok: false,
        message: 'Failed to fetch weather data',
        detail: data
      })
    }

    const current = data.current_weather || {}
    const daily = data.daily || {}

    const today = {
      tmax_c: Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null,
      tmin_c: Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null,
      precipitation_mm: Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum[0] : null,
      uv_index_max: Array.isArray(daily.uv_index_max) ? daily.uv_index_max[0] : null,
      wind_gust_max_kmh: Array.isArray(daily.wind_gusts_10m_max)
        ? daily.wind_gusts_10m_max[0]
        : null
    }

    const current_block = {
      temperature_c: current.temperature,
      wind_speed_kmh: current.windspeed
    }

    const advice = build_rule_based_advice(today)

    const response_payload = {
      city: data.timezone || 'Your location',
      latitude,
      longitude,
      current: current_block,
      today,
      advice
    }

    console.log('[Weather] base payload built for frontend and LLM:', {
      city: response_payload.city,
      current: response_payload.current,
      today: response_payload.today,
      advice_count: response_payload.advice.length
    })

    let llm_advice = null

    try {
      llm_advice = await get_weather_llm_advice(response_payload)
    } catch (error) {
      console.error(
        '[Weather] unexpected error while calling get_weather_llm_advice:',
        error.message || error
      )
    }

    if (!llm_advice) {
      console.warn('[Weather] llm_advice is null; either no api key or LLM call failed')
    }

    const final_payload = Object.assign({}, response_payload, {
      llm_advice
    })

    return response.json(final_payload)
  } catch (error) {
    console.error('[Weather] unhandled error:', error.message || error)
    return response.status(500).json({
      ok: false,
      message: 'Internal server error while fetching weather'
    })
  }
})

module.exports = router
