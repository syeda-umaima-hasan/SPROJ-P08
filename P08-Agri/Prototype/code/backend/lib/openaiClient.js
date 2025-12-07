// backend/lib/openaiClient.js

let cached_client = null;
let init_error = null;

async function getOpenAIClient() {
  if (cached_client !== null) {
    return cached_client;
  }

  if (init_error !== null) {
    throw init_error;
  }

  const api_key = process.env.OPENAI_API_KEY;

  if (!api_key) {
    init_error = new Error('OPENAI_API_KEY is not set in environment');
    throw init_error;
  }

  try {
    const openai_module = await import('openai');
    const OpenAI = openai_module.default;
    cached_client = new OpenAI({ apiKey: api_key });
    return cached_client;
  } catch (error) {
    init_error = error;
    throw error;
  }
}

module.exports = {
  getOpenAIClient
};
