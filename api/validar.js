/**
 * IndiCare API — Validação de Pedido
 * Endpoint para integração com sistemas de auditoria MV/TASY
 * 
 * POST /api/validar
 */

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Servidor não configurado' });

  try {
    const { exame, cid, justificativa, convenio, image_base64, image_mime, max_tokens = 1500 } = req.body;

    let content;
    if (image_base64 && image_base64.length > 100) {
      content = [
        { type: 'image', source: { type: 'base64', media_type: image_mime || 'image/jpeg', data: image_base64 } },
        { type: 'text', text: `Valide este pedido médico.\nConvênio: ${convenio || 'Não informado'}\nExame: ${exame || 'Ver imagem'}\nCID: ${cid || 'Ver imagem'}\nJustificativa: ${justificativa || 'Ver imagem'}` }
      ];
    } else {
      content = `Valide este pedido:\nExame: ${exame}\nCID: ${cid}\nJustificativa: ${justificativa}\nConvênio: ${convenio}`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens,
        system: 'Você é auditor médico especializado. Responda em JSON com: decisao (AUTORIZAR|AUTORIZAR_COM_RESSALVA|SOLICITAR_COMPLEMENTACAO|DEVOLVER), score (0-100), parecer (texto), pendencias (array), codigos_corretos (tuss, sigtap).',
        messages: [{ role: 'user', content }]
      })
    });

    const data = await response.json();
    const text = data.content[0].text;
    
    let resultado;
    try {
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      resultado = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      resultado = { raw: text };
    }

    return res.status(200).json({ success: true, timestamp: new Date().toISOString(), resultado });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
