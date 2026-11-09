// Vercel serverless function. Keys stay server-side (Vercel environment variables).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const pass = process.env.OFFICE_PASSWORD;
  if (!pass || req.headers['x-office-key'] !== pass) return res.status(401).json({ error: 'Unauthorized' });
  const { prompt, agent } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) return res.status(400).json({ error: 'Bad prompt' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || 'AI request failed' });
    const text = (j.content || []).map(c => c.text || '').join('');
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
