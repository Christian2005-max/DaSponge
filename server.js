const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const NodeCache = require("node-cache");

// Initialize environment and services
dotenv.config();
const app = express();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const rateCache = new NodeCache({ stdTTL: 600 }); // 10-minute cache

// Configuration
const PORT = process.env.PORT || 3000;
const CACHE_PREFIX = 'FX_RATE_';

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : '*',
  methods: ['GET', 'POST']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inbuilt Market Analysis Generator
function generateInbuiltAnalysis(baseCurrency, targetCurrency, rate) {
  const currencies = {
    USD: { strength: "strong", drivers: ["Fed policy", "economic growth", "safe-haven demand"] },
    EUR: { strength: "moderate", drivers: ["ECB policy", "energy prices", "manufacturing data"] },
    GBP: { strength: "moderate", drivers: ["BoE decisions", "Brexit impacts", "services sector"] },
    JPY: { strength: "weak", drivers: ["BoJ ultra-loose policy", "trade balance", "risk sentiment"] },
    AUD: { strength: "commodity-linked", drivers: ["China demand", "commodity prices", "RBA stance"] }
  };

  const baseInfo = currencies[baseCurrency] || { strength: "neutral", drivers: ["interest rates", "economic data", "geopolitical factors"] };
  const targetInfo = currencies[targetCurrency] || { strength: "neutral", drivers: ["interest rates", "economic data", "geopolitical factors"] };

  const trend = parseFloat(rate) > 1 ? "strengthening" : "weakening";
  const outlook = baseInfo.strength === "strong" && targetInfo.strength !== "strong" ? "bullish" : "neutral";

  return `The ${baseCurrency} is currently ${trend} against ${targetCurrency} at 1:${rate}. Key drivers include ${baseInfo.drivers.slice(0, 2).join(' and ')} for ${baseCurrency} and ${targetInfo.drivers.slice(0, 2).join(' and ')} for ${targetCurrency}. Short-term outlook appears ${outlook}, though traders should monitor upcoming economic releases for confirmation. This automated analysis is based on typical market drivers for these currencies.`;
}

// Gemini AI Service
async function getMarketAnalysis(baseCurrency, targetCurrency, rate) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
    const prompt = `As senior financial analyst at Global FX, provide concise professional analysis (60-80 words) about ${baseCurrency} to ${targetCurrency} exchange trends. Include:
    - Key economic drivers
    - Recent central bank impact
    - Short-term technical outlook
    Current rate: 1 ${baseCurrency} = ${rate} ${targetCurrency}. 
    Use professional tone, avoid speculation.`;
    
    const result = await model.generateContent(prompt);
    return (await result.response).text();
  } catch (error) {
    console.error('Gemini API Error:', error);
    return generateInbuiltAnalysis(baseCurrency, targetCurrency, rate);
  }
}

// Conversion Endpoint
app.post('/api/convert', async (req, res) => {
  try {
    const { amount, from_currency, to_currency } = req.body;
    const cacheKey = `${CACHE_PREFIX}${from_currency}_${to_currency}`;

    // Validate input
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ 
        error: 'Invalid amount', 
        code: 'INV-AMT' 
      });
    }

    // Check cache
    if (rateCache.has(cacheKey)) {
      const cached = rateCache.get(cacheKey);
      return res.json({ 
        ...cached,
        cached: true,
        amount: parseFloat(amount),
        converted_amount: (amount * cached.rate).toFixed(2)
      });
    }

    // Fetch live rates
    const fxResponse = await axios.get(
      `https://api.frankfurter.app/latest?from=${from_currency}&to=${to_currency}`
    );

    const rate = fxResponse.data.rates[to_currency];
    const analysis = await getMarketAnalysis(from_currency, to_currency, rate);

    // Cache response
    rateCache.set(cacheKey, {
      rate,
      analysis,
      timestamp: new Date().toISOString()
    });

    res.json({
      from_currency,
      to_currency,
      rate: parseFloat(rate.toFixed(4)),
      converted_amount: (amount * rate).toFixed(2),
      analysis,
      timestamp: new Date().toISOString(),
      source: 'Frankfurter.app'
    });

  } catch (error) {
    console.error('Conversion Error:', error);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      error: 'Conversion service unavailable',
      code: `SRV-${statusCode.toString().padStart(3, '0')}`
    });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    cacheStats: rateCache.getStats()
  });
});

app.listen(PORT, () => {
  console.log(`FX Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});