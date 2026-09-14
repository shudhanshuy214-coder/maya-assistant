require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const KEY = process.env.GEMINI_API_KEY;

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '16kb' }));

function validateBody(req, res, next){
  const { message } = req.body || {};
  if(typeof message !== 'string' || !message.trim().length || message.length > 1000){
    return res.status(400).json({ error: 'Invalid message.' });
  }
  next();
}

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.' }
});

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function callGemini(contents, systemInstruction){
  const attempts = 3;
  for(let i = 0; i < attempts; i++){
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    try{
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': KEY },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0.6, maxOutputTokens: 200 }
        }),
        signal: ctrl.signal
      });
      clearTimeout(timeout);
      if(r.status === 503 && i < attempts - 1){
        await sleep(1000 * (i + 1));
        continue;
      }
      return r;
    }catch(err){
      clearTimeout(timeout);
      if(i < attempts - 1){ await sleep(1000 * (i + 1)); continue; }
      throw err;
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'MAYA V1 backend', model: MODEL, configured: !!KEY });
});

app.post('/api/assistant', aiLimiter, validateBody, async (req, res) => {
  if(!KEY){
    return res.status(503).json({ error: 'Gemini key is not configured on the server (GEMINI_API_KEY).' });
  }
  const { message, history } = req.body;

  const systemInstruction = 'You are Maya, a friendly personal AI voice assistant. Always reply in one or two short natural sentences.';

  const contents = [];
  if(Array.isArray(history)){
    for(const h of history){
      if(h && (h.role === 'user' || h.role === 'assistant')){
        contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.content) }] });
      }
    }
  }
  contents.push({ role: 'user', parts: [{ text: message }] });

  try{
    const r = await callGemini(contents, systemInstruction);

    if(!r.ok){
      console.error('Gemini request failed with status', r.status);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }
    const data = await r.json();
    const reply = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      ? String(data.candidates[0].content.parts[0].text).trim() : '';

    if(!reply) return res.status(502).json({ error: 'AI returned an empty response.' });
    res.json({ reply });
  }catch(err){
    if(err.name === 'AbortError') return res.status(504).json({ error: 'The AI took too long to respond.' });
    console.error('Assistant error:', err.message);
    res.status(502).json({ error: 'Failed to reach the AI service.' });
  }
});

app.get('/', (req, res) => res.json({ name: 'MAYA V1', status: 'running' }));

app.listen(PORT, () => {
  console.log('MAYA V1 backend running on port ' + PORT + ' (model: ' + MODEL + ', key configured: ' + !!KEY + ')');
});
