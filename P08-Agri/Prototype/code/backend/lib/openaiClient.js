// backend/lib/openaiClient.js
// Shared OpenAI client + helper for weather LLM advice

const OpenAI = require('openai');

let openai = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
} else {
  console.warn(
    'OPENAI_API_KEY is not set. Weather LLM advice will be disabled.'
  );
}

/**
 * Build detailed, crop-aware advice for a farmer given weather context.
 * Returns a JSON object like:
 * {
 *   summary: string,
 *   actions_to_take: string[],
 *   actions_to_avoid: string[],
 *   risks: string[],
 *   extra_notes: string
 * }
 */
async function createWeatherAdvice(weatherContext) {
  if (!openai) {
    throw new Error('OpenAI client not configured');
  }

  const { city, latitude, longitude, current, today, advice } = weatherContext;

  const systemPrompt = `
You are AgriQual, a weather-aware agricultural advisor for wheat farmers in Pakistan.
Given structured weather data, provide clear, practical, and safe advice.
Always assume the farmer is working with wheat crops in typical Pakistani conditions.
Use simple, friendly English and keep everything specific and actionable.
`;

  const userPrompt = `
Location: ${city || 'Unknown'} (lat: ${latitude}, lon: ${longitude})

Current conditions:
- Temperature: ${current && current.temperature_c != null ? current.temperature_c : '?'} °C
- Wind speed: ${current && current.wind_speed_kmh != null ? current.wind_speed_kmh : '?'} km/h

Today (forecast / summary):
- Max temp: ${today && today.tmax_c != null ? today.tmax_c : '?'} °C
- Min temp: ${today && today.tmin_c != null ? today.tmin_c : '?'} °C
- Precipitation: ${today && today.precipitation_mm != null ? today.precipitation_mm : '?'} mm
- Max UV index: ${today && today.uv_index_max != null ? today.uv_index_max : '?'}
- Max wind gusts: ${today && today.wind_gust_max_kmh != null ? today.wind_gust_max_kmh : '?'} km/h

Rule-based messages from the app:
${Array.isArray(advice) ? advice.map((a) => `- ${a}`).join('\n') : ''}

Based on these conditions, give advice for a wheat farmer in Pakistan.

Return:
1. A short 2–4 sentence summary of how today’s weather affects field work.
2. 3–6 specific actions the farmer SHOULD take today (for irrigation, spraying, field work, disease monitoring, etc).
3. 3–6 actions the farmer should AVOID today.
4. Any important RISKS (e.g., disease risk, lodging, spray drift, heat/frost stress) with short explanations.
5. Extra notes tailored to wheat in Pakistan (for example, timing around critical growth stages if relevant).

VERY IMPORTANT:
Respond in **JSON only**, with this exact shape:

{
  "summary": "string",
  "actions_to_take": ["string", ...],
  "actions_to_avoid": ["string", ...],
  "risks": ["string", ...],
  "extra_notes": "string"
}
`;

  const completion = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' }
  });

  const first = completion.output[0]?.content?.[0];

  let text;
  if (!first) {
    throw new Error('Empty OpenAI response for weather advice');
  }

  if (typeof first.text === 'string') {
    text = first.text;
  } else if (typeof first === 'string') {
    text = first;
  } else if (first.type === 'output_text' && typeof first.text === 'string') {
    text = first.text;
  } else {
    throw new Error('Unexpected OpenAI response format for weather advice');
  }

  const parsed = JSON.parse(text);

  // Basic sanity checks so frontend doesn't explode
  return {
    summary: parsed.summary || '',
    actions_to_take: Array.isArray(parsed.actions_to_take) ? parsed.actions_to_take : [],
    actions_to_avoid: Array.isArray(parsed.actions_to_avoid) ? parsed.actions_to_avoid : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    extra_notes: parsed.extra_notes || ''
  };
}

module.exports = {
  createWeatherAdvice
};
