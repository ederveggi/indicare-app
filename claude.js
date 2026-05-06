// api/claude.js
// Vercel Serverless Function — Proxy seguro para a API da Anthropic
// A API Key fica nas variáveis de ambiente do Vercel — nunca exposta ao cliente

export default async function handler(req, res) {

  // CORS — permite chamadas do próprio domínio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Chave da API — vem das variáveis de ambiente do Vercel (segura)
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'API Key não configurada no servidor.' });
  }

  try {
    const { system, message, max_tokens = 1500 } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Campo message é obrigatório.' });
    }

    // Chama a API da Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        system: system || 'Você é um assistente médico especializado em propedêutica diagnóstica.',
        messages: [{ role: 'user', content: message }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: err.error?.message || `Erro na API: ${response.status}`
      });
    }

    const data = await response.json();
    return res.status(200).json({ text: data.content[0].text });

  } catch (err) {
    console.error('Erro no proxy:', err);
    return res.status(500).json({ error: 'Erro interno no servidor: ' + err.message });
  }
}
