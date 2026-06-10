/**
 * IndiCare — API Principal (Vercel Serverless)
 * Rota: POST /api/indicare
 * Módulos: sugestao | validar
 * USA fetch nativo — sem dependência de @anthropic-ai/sdk
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-3-5-sonnet-20241022';

const SYSTEM_SUGESTAO = `Você é um médico radiologista sênior e auditor clínico especialista em saúde suplementar brasileira, com 15 anos de experiência em propedêutica diagnóstica por imagem.

Com base nos dados clínicos fornecidos, sugira os exames de imagem mais indicados.

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "success": true,
  "sugestao": {
    "procedimentos": [
      {
        "codigo": "40901033",
        "descricao": "US - ABDOME TOTAL",
        "linha": "primeira",
        "justificativa": "Justificativa clínica em 1 frase"
      }
    ],
    "cid": "CID sugerido",
    "justificativaGeral": "Raciocínio diagnóstico em 2-3 frases"
  }
}

Regras:
- Máximo 5 exames ordenados por prioridade
- linha: "primeira", "segunda" ou "terceira"
- Códigos TUSS reais de exames de imagem (US, TC, RM, RX)
- Se indicação insuficiente, procedimentos vazio e explique no justificativaGeral`;

const SYSTEM_VALIDAR = `Você é um médico auditor sênior de plano de saúde com expertise em medicina baseada em evidências e regulamentações da ANS.

Avalie a coerência clínica entre os dados do paciente, a indicação e os procedimentos solicitados.

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "success": true,
  "decisao": "AUTORIZAR",
  "score": 85,
  "validacao": {
    "itens": [
      {
        "codigo": "codigo",
        "descricao": "Nome do exame",
        "nivel": "adequado",
        "justificativa": "Justificativa"
      }
    ],
    "recomendacao": "Recomendação geral do auditor"
  },
  "parecer": "Parecer técnico completo"
}

Regras:
- decisao: AUTORIZAR | AUTORIZAR COM RESSALVA | SOLICITAR COMPLEMENTAÇÃO | DEVOLVER/GLOSAR
- score: 0-100
- nivel: "adequado" | "discutivel" | "nao-indicado"`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido.' });
  }

  const {
    modulo = 'sugestao',
    paciente = {},
    indicacaoClinica = '',
    dadosClinicos = {},
    procedimentos = [],
    contexto = {}
  } = req.body || {};

  // Monta prompt do paciente
  const partesPac = [
    paciente.nome        ? `Paciente: ${paciente.nome}` : '',
    paciente.idade       ? `Idade: ${paciente.idade} anos` : '',
    paciente.sexo        ? `Sexo: ${paciente.sexo}` : '',
    paciente.convenio    ? `Convênio: ${paciente.convenio}` : '',
    paciente.nascimento  ? `Nascimento: ${paciente.nascimento}` : '',
    paciente.atendimento ? `Atendimento: ${paciente.atendimento}` : '',
  ].filter(Boolean).join('\n');

  let userPrompt = '';
  let systemPrompt = '';

  if (modulo === 'sugestao') {
    systemPrompt = SYSTEM_SUGESTAO;
    const dadosExtra = Object.keys(dadosClinicos).length > 0
      ? '\nDados clínicos adicionais:\n' + Object.entries(dadosClinicos)
          .filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
      : '';
    userPrompt = `${partesPac}\n\nIndicação clínica:\n${indicacaoClinica || 'Não informada'}${dadosExtra}\n\nSugira os exames de imagem mais indicados.`;

  } else if (modulo === 'validar') {
    systemPrompt = SYSTEM_VALIDAR;
    const listaProcs = (procedimentos || []).map(p =>
      `- ${p.codigo || '?'}: ${p.descricao || p.nome || '?'}`
    ).join('\n');
    userPrompt = `${partesPac}\n\nIndicação clínica:\n${indicacaoClinica || 'Não informada'}\n\nProcedimentos solicitados:\n${listaProcs || 'Nenhum informado'}\n\nAvalie a coerência clínica.`;

  } else {
    return res.status(400).json({ success: false, error: `Módulo desconhecido: ${modulo}` });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'API key não configurada.' });
  }

  try {
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic error:', errText);
      return res.status(500).json({ success: false, error: `Erro Anthropic: ${response.status}` });
    }

    const data = await response.json();
    const textoResposta = data.content?.[0]?.text || '';

    let resultado;
    try {
      const clean = textoResposta.replace(/```json|```/g, '').trim();
      resultado = JSON.parse(clean);
    } catch(e) {
      console.error('Parse JSON error:', textoResposta.substring(0, 200));
      return res.status(200).json({
        success: false,
        error: 'Erro ao processar resposta da IA.',
        raw: textoResposta.substring(0, 300)
      });
    }

    return res.status(200).json(resultado);

  } catch(err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
