// backend/routes/weather.js

const express = require('express');
const router = express.Router();
const { getOpenAIClient } = require('../lib/openaiClient');

// Simple rule-based crop advice (what you already had conceptually)
function build_rule_based_advice(weather) {
  const advice_lines = [];
  const today = weather.today || {};
  const current = weather.current || {};

  const precipitation = Number(today.precipitation_mm ?? 0);
  const wind_speed = Number(current.wind_speed_kmh ?? 0);
  const uv_index = Number(today.uv_index_max ?? 0);

  if (precipitation < 1) {
    advice_lines.push(
      'No significant rain today: if soil is dry, plan irrigation early morning or late evening.'
    );
  } else {
    advice_lines.push(
      'Rain expected: avoid unnecessary irrigation and ensure field drainage is clear.'
    );
  }

  if (wind_speed < 15) {
    advice_lines.push(
      'Calmer winds: if spraying is needed, this is a suitable window.'
    );
  } else {
    advice_lines.push(
      'Strong winds today: avoid spraying to reduce drift and product loss.'
    );
  }

  if (uv_index >= 7) {
    advice_lines.push(
      'High UV index: minimise midday field work and protect both workers and young crops from heat stress.'
    );
  }

  return advice_lines;
}

// Build a compact text summary for the LLM
function build_llm_weather_summary(weather) {
  const city = weather.city || 'Your location';
  const today = weather.today || {};
  const current = weather.current || {};

  return [
    `Location: ${city}`,
    `Current temperature: ${current.temperature_c} °C`,
    `Current wind speed: ${current.wind_speed_kmh} km/h`,
    `Today max temp: ${today.tmax_c} °C`,
    `Today min temp: ${today.tmin_c} °C`,
    `Today precipitation: ${today.precipitation_mm} mm`,
    `Today UV index (max): ${today.uv_index_max}`
  ].join('\n');
}

// Call OpenAI to get detailed AI advice (returns null on failure)
async function get_llm_advice(weather) {
  try {
    const client = await getOpenAIClient();
    const summary = build_llm_weather_summary(weather);

    const system_prompt =
      'You are an agronomy assistant helping small wheat farmers in Pakistan. ' +
      'You will receive current weather and today\'s forecast. ' +
      'Give clear, practical, step-by-step guidance on what the farmer should ' +
      'do today for their wheat crop (irrigation, spraying, fertiliser timing, ' +
      'harvesting, and worker safety). Avoid technical jargon.';

    const user_prompt =
      summary +
      '\n\nUsing this weather, give a short, structured plan for today. ' +
      'Use 3–6 bullet points, each one a specific action or warning. ' +
      'Address both crop management AND worker safety.';

    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: system_prompt
        },
        {
          role: 'user',
          content: user_prompt
        }
      ]
    });

    const output =
      response &&
      response.output &&
      response.output[0] &&
      response.output[0].content &&
      response.output[0].content[0] &&
      response.output[0].content[0].text &&
      response.output[0].content[0].text.value;

    if (typeof output === 'string') {
      return output.trim();
    }

    return null;
  } catch (error) {
    console.error('LLM weather advice error:', error.message || error);
    return null;
  }
}

// NOTE: This handler assumes you already have working logic that fills
// `weather_data` with the same shape you were returning before:
// {
//   city,
//   latitude,
//   longitude,
//   current: { temperature_c, wind_speed_kmh },
//   today: {
//     precipitation_mm,
//     tmax_c,
//     tmin_c,
//     uv_index_max,
//     wind_gust_max_kmh
//   }
// }
//
// I’ll keep that pattern and only wrap it with AI logic.
// Replace the placeholder "get_base_weather_data" with your existing logic
// if you are fetching from some external API.

async function get_base_weather_data(lat, lon) {
  // ⬇️ Replace this with your existing implementation if you have one.
  // For safety, here is a very simple Open-Meteo based implementation
  // that returns data in your expected format.

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current_weather=true' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,windgusts_10m_max' +
    '&timezone=auto';

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch weather data');
  }

  const data = await response.json();
  const index = 0; // today

  const weather_data = {
    city: 'Your location',
    latitude: lat,
    longitude: lon,
    current: {
      temperature_c: data.current_weather?.temperature ?? null,
      wind_speed_kmh: data.current_weather?.windspeed ?? null
    },
    today: {
      precipitation_mm: data.daily?.precipitation_sum?.[index] ?? null,
      tmax_c: data.daily?.temperature_2m_max?.[index] ?? null,
      tmin_c: data.daily?.temperature_2m_min?.[index] ?? null,
      uv_index_max: data.daily?.uv_index_max?.[index] ?? null,
      wind_gust_max_kmh: data.daily?.windgusts_10m_max?.[index] ?? null
    }
  };

  return weather_data;
}

router.get('/', async function (request, response) {
  const lat = parseFloat(request.query.lat);
  const lon = parseFloat(request.query.lon);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return response
      .status(400)
      .json({ ok: false, message: 'lat and lon query parameters are required' });
  }

  try {
    // 1. Get the basic weather data
    const weather_data = await get_base_weather_data(lat, lon);

    // 2. Build rule-based advice (your old behaviour)
    weather_data.advice = build_rule_based_advice(weather_data);

    // 3. Try to get AI advice (non-fatal if it fails)
    const llm_advice = await get_llm_advice(weather_data);
    weather_data.llm_advice = llm_advice;

    return response.json(weather_data);
  } catch (error) {
    console.error('Weather route error:', error.message || error);
    return response.status(500).json({
      ok: false,
      message: 'Failed to fetch weather advisory',
      detail: error.message || String(error)
    });
  }
});

module.exports = router;
