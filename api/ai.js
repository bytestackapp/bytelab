// Vercel serverless function. Keys stay server-side (Vercel environment variables).
// Uses Gemini (free tier) if GEMINI_API_KEY is set, otherwise Anthropic if ANTHROPIC_API_KEY is set.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const pass = process.env.OFFICE_PASSWORD;
  if (!pass || req.headers['x-office-key'] !== pass) return res.status(401).json({ error: 'Unauthorized' });
  const { prompt, agent } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) return res.status(400).json({ error: 'Bad prompt' });
  const gem = process.env.GEMINI_API_KEY, ant = process.env.ANTHROPIC_API_KEY;
  if (!gem && !ant) return res.status(500).json({ error: 'No AI key configured on the server' });
  const call = gem
    ? () => fetch('https://generativelanguage.googleapis.com/v1beta/models/' + (process.env.GEMINI_MODEL || 'gemini-3.6-flash') + ':generateContent', {
        method: 'POST',
        headers: { 'x-goog-api-key': gem, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1200 } })
      })
    : () => fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ant, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
      });
  try {
    let r, j;
    for (let i = 0; i < 3; i++) { // free tiers rate-limit: wait and retry on 429
      r = await call();
      j = await r.json().catch(() => ({}));
      if (r.status !== 429) break;
      await new Promise(s => setTimeout(s, 4000));
    }
    if (r.status === 429) return res.status(429).json({ error: 'Rate limit reached. Wait a minute and try again.' });
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || 'AI request failed' });
    const parts = gem ? ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []) : (j.content || []);
    const text = parts.map(p => p.text || '').join('');
    if (!text) return res.status(502).json({ error: 'Empty response from the model' });
    // Optional history in Supabase (service key never reaches the browser)
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      fetch(process.env.SUPABASE_URL + '/rest/v1/office_runs', {
        method: 'POST',
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY, 'content-type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ agent: String(agent || ''), prompt, result: text })
      }).catch(() => {});
    }
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
};
