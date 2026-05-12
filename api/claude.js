export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'API Key não configurada no servidor.' });

  try {
    const { system, message, image_base64, image_mime, max_tokens = 1500 } = req.body;
    if (!message) return res.status(400).json({ error: 'Campo message obrigatório.' });

    let content;
    if (image_base64 && image_base64.length > 100) {
      content = [
        { type: 'image', source: { type: 'base64', media_type: image_mime || 'image/jpeg', data: image_base64 } },
        { type: 'text', text: message }
      ];
    } else {
      content = message;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens,
        system: system || 'Você é um assistente médico especializado em propedêutica diagnóstica.',
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Erro: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json({ text: data.content[0].text });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
