const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini AI
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('GEMINI_API_KEY not set. Chat functionality will be disabled.');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
// Use gemini-1.5-flash (without version suffix) or gemini-1.5-pro
const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

/**
 * Generate a chat response using Google Gemini API
 * @param {string} question - User's question
 * @param {object} diagnosisContext - Diagnosis context with diagnosis, confidence, alternatives, recommendations
 * @returns {Promise<string>} - Generated response
 */
async function generateChatResponse(question, diagnosisContext) {
  if (!genAI) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY in environment variables.');
  }

  try {
    // Map deprecated model names to current models
    // Use simple model names without version suffixes - SDK will resolve to latest
    let actualModelName = modelName;
    
    // Convert deprecated or versioned names to simple format
    if (modelName === 'gemini-pro' || 
        modelName === 'gemini-1.5-flash-001' || 
        modelName === 'gemini-1.5-flash-latest') {
      actualModelName = 'gemini-1.5-flash';
    } else if (modelName === 'gemini-1.5-pro-001' || 
               modelName === 'gemini-1.5-pro-latest') {
      actualModelName = 'gemini-1.5-pro';
    }
    
    console.log('Using Gemini model:', actualModelName);
    const model = genAI.getGenerativeModel({ model: actualModelName });

    // Build the prompt with diagnosis context
    const prompt = buildPrompt(question, diagnosisContext);

    // Generate content
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return text.trim();
  } catch (error) {
    console.error('Gemini API error:', error);
    
    // Handle specific Gemini errors
    if (error.message?.includes('API key')) {
      throw new Error('Invalid Gemini API key. Please check your configuration.');
    }
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new Error('Gemini API rate limit exceeded. Please try again in a moment.');
    }
    
    throw new Error('Failed to generate response. Please try again.');
  }
}

/**
 * Build the prompt for Gemini with diagnosis context
 */
function buildPrompt(question, context) {
  const alternativesText = context.alternatives && context.alternatives.length > 0
    ? context.alternatives.map(alt => `- ${alt.label} (${(alt.confidence * 100).toFixed(1)}% confidence)`).join('\n')
    : 'None';

  const recommendationsText = context.recommendations && context.recommendations.length > 0
    ? context.recommendations.join(', ')
    : 'None provided';

  return `You are an expert agricultural advisor specializing in wheat crop management. 
You help farmers understand their crop diagnosis and provide actionable, practical advice.

IMPORTANT CONTEXT FROM IMAGE ANALYSIS:
- Diagnosis: ${context.diagnosis}
- Confidence Level: ${(context.confidence * 100).toFixed(1)}%
- Alternative Possibilities:
${alternativesText}
- Current Recommendations: ${recommendationsText}

GUIDELINES FOR YOUR RESPONSES:
1. Answer based on the diagnosis provided above
2. Be concise and practical (2-4 sentences maximum)
3. Use simple, clear language that farmers can understand
4. Provide actionable steps when possible
5. If the question is not related to the wheat diagnosis, politely redirect to the diagnosis topic
6. Always be helpful, encouraging, and supportive
7. If the diagnosis shows a problem, provide specific treatment advice
8. If the diagnosis shows healthy crop, provide maintenance tips

Farmer's Question: "${question}"

Provide your helpful answer now:`;
}

module.exports = { generateChatResponse };

