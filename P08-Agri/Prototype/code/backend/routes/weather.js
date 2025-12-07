const express = require('express')
const axios = require('axios')
const router = express.Router()
const { get_llm_weather_advice } = require('../lib/openaiClient')

const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'

router.get('/', async function (request, response) {
  try {
    const latitude = parseFloat(request.query.lat)
    const longitude = parseFloat(request.query.lon)

    if (Number.isNaN(latitude) === true || Number.isNaN(longitude) === true) {
      return response.status(400).json({
        ok: false,
        message: 'lat and lon query parameters are required and must be numbers'
      })
    }

    const params = {
      latitude,
      longitude,
      hourly: ['temperature_2m', 'precipitation', 'wind_speed_10m', 'uv_index'].join(','),
      daily: [
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'uv_index_max',
        'wind_gusts_10m_max'
      ].join(','),
      current_weather: true,
      timezone: 'auto'
    }

    const url =
      `${WEATHER_API_URL}?latitude=${latitude}&longitude=${longitude}` +
      '&hourly=temperature_2m,precipitation,wind_speed_10m,uv_index' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,wind_gusts_10m_max' +
      '&current_weather=true&timezone=auto'

    console.log('[Weather] fetching from open-meteo:', url)

    const api_response = await axios.get(WEATHER_API_URL, { params })
    const data = api_response.data || {}

    const current = {
      temperature_c: data.current_weather?.temperature || data.current?.temperature_2m,
      wind_speed_kmh: data.current_weather?.windspeed || data.current?.wind_speed_10m
    }

    const today = {
      tmax_c: data.daily?.temperature_2m_max?.[0],
      tmin_c: data.daily?.temperature_2m_min?.[0],
      precipitation_mm: data.daily?.precipitation_sum?.[0],
      uv_index_max: data.daily?.uv_index_max?.[0],
      wind_gust_max_kmh: data.daily?.wind_gusts_10m_max?.[0]
    }

    const advice = []

    if ((today.precipitation_mm || 0) === 0) {
      advice.push(
        'No significant rain today: if soil is dry, plan irrigation early morning or late evening.'
      )
    } else {
      advice.push(
        'Rain expected today: avoid unnecessary irrigation and make sure fields have proper drainage.'
      )
    }

    if ((current.wind_speed_kmh || 0) < 10) {
      advice.push(
        'Calmer winds: if spraying is needed, this is a suitable window, but always follow label safety instructions.'
      )
    } else {
      advice.push(
        'Stronger winds: avoid spraying pesticides or fertilizers to prevent drift.'
      )
    }

    const city_label = data.timezone || 'Your location'

    console.log('[Weather] base payload for frontend + LLM:', {
      city: city_label,
      current,
      today,
      advice_count: advice.length
    })

    let llm_advice = null

    try {
      console.log('[Weather] calling get_llm_weather_advice...')
      llm_advice = await get_llm_weather_advice({
        city: city_label,
        latitude,
        longitude,
        current,
        today,
        advice
      })
      console.log(
        '[Weather] LLM advice result:',
        llm_advice ? `OK (length ${llm_advice.length})` : 'NULL'
      )
    } catch (error) {
      console.error(
        '[Weather] get_llm_weather_advice failed:',
        error?.message || error
      )
      llm_advice = null
    }

    const payload = {
      city: city_label,
      latitude,
      longitude,
      current,
      today,
      advice,
      llm_advice
    }

    response.json(payload)
  } catch (error) {
    console.error(
      '[Weather] Unexpected error:',
      error?.response?.data || error?.message || error
    )
    response.status(500).json({
      ok: false,
      message: 'Failed to fetch weather data',
      detail: error?.message || String(error)
    })
  }
})

module.exports = router
