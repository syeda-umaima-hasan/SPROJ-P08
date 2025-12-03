// backend/routes/weather.js
const express = require('express');
const axios = require('axios');

const router = express.Router();

/** Small helper: fetch with timeout + 1 retry using axios */
async function fetch_json(url, { timeout_ms = 12000, retry = 1, headers = {} } = {}) {
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const res = await axios.get(url, {
        headers,
        timeout: timeout_ms,
        validateStatus: () => true, // Don't throw on any status code
        maxRedirects: 5
      });
      if (res.status >= 200 && res.status < 300) {
        // Validate response data exists
        if (res.data === undefined || res.data === null) {
          console.error('Empty response data from:', url);
          if (attempt === retry) {
            return { ok: false, status: res.status, data: { error: 'Empty response from API' } };
          }
          continue;
        }
        return { ok: true, status: res.status, data: res.data };
      }
      // Return structured error so caller can decide
      return { ok: false, status: res.status, data: res.data || { error: 'Request failed' } };
    } catch (e) {
      console.error(`Fetch attempt ${attempt + 1} failed for ${url}:`, e?.message || e);
      if (attempt === retry) {
        return { ok: false, status: undefined, data: { error: e?.message || 'network error' } };
      }
      // brief backoff before retry
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return { ok: false, status: undefined, data: { error: 'Max retries exceeded' } };
}

/** Build label via reverse geocoding (best-effort). Never throws. */
async function reverse_label(lat, lon) {
  const headers = { 'User-Agent': 'AgriQual-Server/1.0' };

  // 1) Try Open-Meteo reverse
  const r1 = await fetch_json(
    `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en&format=json&count=1`,
    { timeout_ms: 8000, retry: 0, headers }
  );
  if (r1.ok && Array.isArray(r1.data?.results) && r1.data.results.length > 0) {
    const top = r1.data.results[0] || {};
    const parts = [];
    if (top.name) parts.push(top.name);
    if (top.admin1) parts.push(top.admin1);
    if (!top.name && top.admin2) parts.push(top.admin2);
    if (parts.length === 0 && top.country) parts.push(top.country);
    if (parts.length > 0) return parts.join(', ');
  }

  // 2) Fallback BigDataCloud
  const r2 = await fetch_json(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    { timeout_ms: 8000, retry: 0, headers }
  );
  if (r2.ok) {
    const b = r2.data || {};
    const parts = [];
    if (b.city || b.locality) parts.push(b.city || b.locality);
    if (b.principalSubdivision) parts.push(b.principalSubdivision);
    if (parts.length === 0 && b.countryName) parts.push(b.countryName);
    if (parts.length > 0) return parts.join(', ');
  }

  return 'Current location';
}

/** Forecast + advice (never depends on reverse geocode) */
router.get('/', async (req, res) => {
  try {
    const lat_param = req.query.lat;
    const lon_param = req.query.lon;

    if (!lat_param || !lon_param) {
      res.status(400).json({ message: 'lat and lon are required' });
      return;
    }
    const latitude = Number(lat_param);
    const longitude = Number(lon_param);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      res.status(400).json({ message: 'lat and lon must be numbers' });
      return;
    }

    const headers = { 'User-Agent': 'AgriQual-Server/1.0' };
    const weather_url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&current_weather=true` +
      `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,uv_index_max,wind_gusts_10m_max` +
      `&forecast_days=1&timezone=auto`;

    // Forecast first (primary)
    console.log('Fetching weather from:', weather_url);
    const w = await fetch_json(weather_url, { timeout_ms: 12000, retry: 1, headers });
    console.log('Weather API response status:', w.ok, w.status);
    
    if (!w.ok) {
      console.error('Weather API error:', w.status, JSON.stringify(w.data, null, 2));
      
      // Handle rate limiting (429) with user-friendly message
      if (w.status === 429) {
        const rateLimitMessage = w.data?.reason || 
          'Daily API request limit exceeded. The weather service has reached its daily limit. Please try again tomorrow.';
        res.status(429).json({ 
          message: 'Weather service temporarily unavailable', 
          detail: rateLimitMessage,
          error_type: 'rate_limit',
          retry_after: 'tomorrow'
        });
        return;
      }
      
      // Handle other errors
      const safe_message =
        w.status
          ? `Weather service error (${w.status}): ${w.data?.reason || w.data?.error || 'Please try again later.'}`
          : w.data?.error || 'Network error contacting weather service.';
      res.status(500).json({ 
        message: 'Failed to fetch weather', 
        detail: safe_message,
        api_status: w.status,
        api_error: w.data
      });
      return;
    }

    // Validate response structure
    if (!w.data || typeof w.data !== 'object') {
      console.error('Invalid weather API response type:', typeof w.data, w.data);
      res.status(500).json({ 
        message: 'Failed to fetch weather', 
        detail: 'Invalid response from weather service',
        response_type: typeof w.data
      });
      return;
    }

    const wd = w.data;
    console.log('Weather data keys:', Object.keys(wd));
    
    // Safely extract nested objects
    const current = (wd.current_weather && typeof wd.current_weather === 'object') ? wd.current_weather : {};
    const daily = (wd.daily && typeof wd.daily === 'object') ? wd.daily : {};

    // Validate that we have the expected data structure
    if (!daily || typeof daily !== 'object' || Object.keys(daily).length === 0) {
      console.error('Missing daily weather data in response:', JSON.stringify(wd, null, 2));
      res.status(500).json({ 
        message: 'Failed to fetch weather', 
        detail: 'Weather service returned incomplete data' 
      });
      return;
    }

    // Safely extract today's data with null checks
    const today = {
      precipitation_mm: (daily.precipitation_sum && Array.isArray(daily.precipitation_sum) && daily.precipitation_sum.length > 0) 
        ? daily.precipitation_sum[0] 
        : null,
      tmax_c: (daily.temperature_2m_max && Array.isArray(daily.temperature_2m_max) && daily.temperature_2m_max.length > 0) 
        ? daily.temperature_2m_max[0] 
        : null,
      tmin_c: (daily.temperature_2m_min && Array.isArray(daily.temperature_2m_min) && daily.temperature_2m_min.length > 0) 
        ? daily.temperature_2m_min[0] 
        : null,
      uv_index_max: (daily.uv_index_max && Array.isArray(daily.uv_index_max) && daily.uv_index_max.length > 0) 
        ? daily.uv_index_max[0] 
        : null,
      wind_gust_max_kmh: (daily.wind_gusts_10m_max && Array.isArray(daily.wind_gusts_10m_max) && daily.wind_gusts_10m_max.length > 0) 
        ? daily.wind_gusts_10m_max[0] 
        : null,
    };

    const current_block = {
      temperature_c: (current && typeof current.temperature === 'number') ? current.temperature : null,
      wind_speed_kmh: (current && typeof current.windspeed === 'number') ? current.windspeed : null,
    };

    // Best-effort label (does not affect success)
    let city_label = 'Current location';
    try {
      city_label = await reverse_label(latitude, longitude);
    } catch (labelError) {
      console.warn('Reverse geocoding failed (non-critical):', labelError?.message || labelError);
      // Continue with default label
    }

    // Advice (same as your original)
    const advice = [];
    if (today.precipitation_mm !== null && today.precipitation_mm >= 2) {
      advice.push('Rain expected today: postpone irrigation and N top-dress; check low fields for waterlogging.');
    } else {
      advice.push('No significant rain today: if soil is dry, plan irrigation early morning or late evening.');
    }
    if (
      (current_block.wind_speed_kmh !== null && current_block.wind_speed_kmh >= 25) ||
      (today.wind_gust_max_kmh !== null && today.wind_gust_max_kmh >= 40)
    ) {
      advice.push('Windy conditions: avoid pesticide/herbicide spraying; secure mulches and covers.');
    } else {
      advice.push('Calmer winds: if spraying is needed, this is a suitable window.');
    }
    if (today.tmax_c !== null && today.tmax_c >= 35) {
      advice.push('High heat: shallow irrigation to reduce stress; avoid transplanting at midday; monitor for wilting.');
    } else if (today.tmin_c !== null && today.tmin_c <= 5) {
      advice.push('Cold risk: use row covers for sensitive crops; avoid night irrigation.');
    }
    if (today.uv_index_max !== null && today.uv_index_max >= 8) {
      advice.push('Strong UV: schedule field work earlier/later; ensure sun protection for workers.');
    }

    res.json({
      city: city_label,
      latitude,
      longitude,
      current: current_block,
      today,
      advice
    });
  } catch (error) {
    console.error('Weather route error:', error);
    console.error('Error stack:', error?.stack);
    res.status(500).json({ 
      message: 'Failed to fetch weather', 
      detail: error?.message || 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    });
  }
});

module.exports = router;