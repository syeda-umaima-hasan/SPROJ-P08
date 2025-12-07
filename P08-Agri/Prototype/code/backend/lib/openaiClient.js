const OpenAI = require('openai')

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined
})

async function get_weather_llm_advice(weather_payload) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY, skipping LLM advice')
    return null
  }

  const model_name = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

  const system_prompt = `
You are an agronomy assistant helping small wheat farmers in Pakistan.
You receive structured weather data and simple rule-based advice.
Your job is to translate this into clear, farmer-friendly guidance.
Keep language simple, practical, and focused on wheat crop care.
Always prioritise farmer safety and sustainable practices.
`.trim()

  const user_prompt = `
Here is the structured weather context and basic advice as JSON:

${JSON.stringify(weather_payload, null, 2)}

Using this context, write more detailed crop-care guidance for a wheat farmer.

Important formatting rules:
- Reply in plain text only.
- Do not use any markdown symbols like *, **, #, ###.
- Use this structure exactly:

More Detailed Explanations:
Summary:
- One or two short sentences about what kind of day it is for farming.

Actions to take:
- 4 to 6 bullet points starting with "- ".
- Focus on irrigation, spraying, fertilizer, monitoring crops, and any other relevant actions today.

Things to avoid:
- 4 to 6 bullet points starting with "- ".
- Include what mistakes to avoid, safety tips, and timing issues.

Constraints:
- Maximum length about 250 words.
- Base everything on the actual numbers you see (rain, temperature, wind, UV, etc.).
- If rain is likely or conditions are risky, be conservative and focus on risk reduction.
`.trim()

  try {
    const response = await client.responses.create({
      model: model_name,
      input: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: user_prompt }
      ]
    })

    const output_block = response.output && response.output[0]
    const content_block = output_block && output_block.content && output_block.content[0]
    const text_value = content_block && content_block.text

    if (!text_value) {
      console.error('OpenAI weather advice: empty text in response')
      return null
    }

    return text_value
  } catch (error) {
    const message = error.response?.data || error.message || error
    console.error('OpenAI weather advice error:', message)
    return null
  }
}

module.exports = {
  get_weather_llm_advice
}
