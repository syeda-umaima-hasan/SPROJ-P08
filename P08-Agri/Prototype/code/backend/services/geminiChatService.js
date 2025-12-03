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

  // List of models to try in order of preference
  const modelsToTry = [
    'gemini-pro',           // Original stable model
    'gemini-1.5-flash',     // Fast model
    'gemini-1.5-pro',       // Better quality model
    'gemini-2.0-flash-exp', // Experimental newer model
  ];

  // Add user-specified model first if provided
  let modelsToTest = [];
  if (modelName && !modelsToTry.includes(modelName)) {
    modelsToTest.push(modelName);
  }
  modelsToTest = modelsToTest.concat(modelsToTry);

  // Build the prompt once
  const prompt = buildPrompt(question, diagnosisContext);

  // Try each model until one works
  let lastError = null;
  for (const modelNameToTry of modelsToTest) {
    try {
      console.log(`Attempting to use Gemini model: ${modelNameToTry}`);
      const model = genAI.getGenerativeModel({ model: modelNameToTry });

      // Generate content
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log(`Successfully used model: ${modelNameToTry}`);
      return text.trim();
    } catch (error) {
      console.error(`Model ${modelNameToTry} failed:`, error.message || error);
      lastError = error;
      
      // If it's not a 404 (model not found), don't try other models
      // It might be a different issue (API key, quota, etc.)
      if (error.status !== 404 && !error.message?.includes('not found')) {
        break;
      }
      // Continue to next model if this one wasn't found
      continue;
    }
  }

  // All models failed
  console.error('All Gemini models failed. Last error:', lastError);
  
  // Handle specific Gemini errors
  if (lastError?.message?.includes('API key')) {
    throw new Error('Invalid Gemini API key. Please check your configuration.');
  }
  if (lastError?.message?.includes('quota') || lastError?.message?.includes('rate limit')) {
    throw new Error('Gemini API rate limit exceeded. Please try again in a moment.');
  }
  
  throw new Error('Failed to generate response. No available Gemini models found. Please check your API configuration.');
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

