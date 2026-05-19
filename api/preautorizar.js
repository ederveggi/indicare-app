/**
 * IndiCare API — Pré-Autorização
 * Endpoint para integração com MV, TASY e outros HIS/RIS
 * 
 * POST /api/preautorizar
 * 
 * Exemplo de uso pelo MV/TASY:
 * fetch('https://app.indicaresaude.com.br/api/preautorizar', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json', 'x-api-key': 'SUA_CHAVE' },
 *   body: JSON.stringify({ exame, cid, justificativa, convenio, paciente })
 * })
 */

export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // Autenticação por API Key (para integração B2B)
  const clientApiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const VALID_KEYS = (process.env.CLIENT_API_KEYS || '').split(',').filter(Boolean);
  
  // Em desenvolvimento aceita sem chave; em produção valida
  if (VALID_KEYS.length > 0 && !VALID_KEYS.includes(clientApiKey)) {
    return res.status(401).json({ 
      error: 'API Key inválida',
      message: 'Solicite sua chave de integração em contato@indicaresaude.com.br'
    });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Servidor não configurado' });

  try {
    const {
      exame,           // Nome do exame
      cid,             // CID-10 principal
      justificativa,   // Texto da justificativa clínica
      convenio,        // Nome do convênio
      paciente = {},   // { idade, sexo, perfil } — sem dados identificadores
      tempo_evolucao,  // Tempo de evolução
      tratamento_previo, // Tratamentos já realizados
      urgencia = false   // Se é urgência
    } = req.body;

    // Validação dos campos obrigatórios
    if (!exame || !cid || !convenio) {
      return res.status(400).json({
        error: 'Campos obrigatórios: exame, cid, convenio',
        campos_recebidos: Object.keys(req.body)
      });
    }

    const systemPrompt = `Voce e um especialista em aprovacao de exames de imagem no Brasil.
Analise se o exame sera aprovado pelo convenio, seguindo regras ANS, ACR 2024, CFM e SBREIM.
Responda APENAS em JSON valido, sem texto adicional.`;

    const userPrompt = `Analise a aprovabilidade:
Convenio: ${convenio}
Exame: ${exame}
CID: ${cid}
Justificativa: ${justificativa || 'Não informada'}
Tempo evolucao: ${tempo_evolucao || 'Não informado'}
Tratamento previo: ${tratamento_previo || 'Não informado'}
Paciente: ${paciente.idade ? paciente.idade + ' anos' : ''} ${paciente.sexo || ''}
Urgencia: ${urgencia ? 'Sim' : 'Não'}

Responda em JSON com exatamente esta estrutura:
{
  "probabilidade_aprovacao": 85,
  "decisao_provavel": "APROVARA",
  "nivel": "ALTA",
  "fundamento": "ACR Appropriateness Criteria 2024 - Low Back Pain",
  "pontos_adequados": ["CID compatível", "Justificativa suficiente"],
  "problemas": [],
  "checklist": [
    {"item": "CID compatível com exame", "ok": true},
    {"item": "Justificativa clínica presente", "ok": true},
    {"item": "Tratamento prévio documentado", "ok": false}
  ],
  "justificativa_sugerida": "Texto completo sugerido para o campo de justificativa...",
  "exame_alternativo": null,
  "tuss": "40914079",
  "sigtap": "0207010064",
  "prazo_resposta_dias": 5,
  "observacoes": "Para RM eletiva, Bradesco exige fisioterapia prévia documentada"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'Erro na IA' });
    }

    const data = await response.json();
    const text = data.content[0].text;

    // Parse JSON da resposta
    let resultado;
    try {
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      resultado = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return res.status(500).json({ 
        error: 'Erro ao processar resposta da IA',
        raw: text.substring(0, 200)
      });
    }

    // Resposta padronizada para integração
    return res.status(200).json({
      success: true,
      versao_api: '1.0',
      timestamp: new Date().toISOString(),
      solicitacao: { exame, cid, convenio },
      resultado
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
