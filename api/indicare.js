/**
 * IndiCare — API Principal (Vercel Serverless)
 * Rota: POST /api/indicare
 * Módulos: sugestao | validar
 */

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_SUGESTAO = `Você é um médico radiologista sênior e auditor clínico especialista em saúde suplementar brasileira, com 15 anos de experiência em propedêutica diagnóstica por imagem.

Com base nos dados clínicos fornecidos, sugira os exames de imagem mais indicados.

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "success": true,
  "sugestao": {
    "procedimentos": [
      {
        "codigo": "TUSS_CODE",
        "descricao": "Nome completo do exame",
        "linha": "primeira",
        "justificativa": "Justificativa clínica em 1 frase"
      }
    ],
    "cid": "CID sugerido se aplicável",
    "justificativaGeral": "Raciocínio diagnóstico geral em 2-3 frases"
  }
}

Regras:
- Máximo 5 exames, ordenados por prioridade clínica
- linha: "primeira", "segunda" ou "terceira"
- Códigos TUSS reais de exames de imagem (US, RX, TC, RM)
- Se não houver indicação clínica suficiente, retorne procedimentos vazio e explique no justificativaGeral`;

const SYSTEM_VALIDAR = `Você é um médico auditor sênior de plano de saúde com experiência em medicina baseada em evidências e regulamentações da ANS.

Avalie a coerência clínica entre os dados do paciente, a indicação e os procedimentos solicitados.

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "success": true,
  "decisao": "AUTORIZAR",
  "score": 85,
  "validacao": {
    "itens": [
      {
        "codigo": "codigo_do_exame",
        "descricao": "Nome do exame",
        "nivel": "adequado",
        "justificativa": "Justificativa da avaliação"
      }
    ],
    "recomendacao": "Texto com recomendação geral do auditor"
  },
  "parecer": "Parecer técnico completo para registro"
}

Regras:
- decisao: AUTORIZAR | AUTORIZAR COM RESSALVA | SOLICITAR COMPLEMENTAÇÃO | DEVOLVER/GLOSAR
- score: 0-100 (coerência clínica)
- nivel dos itens: "adequado" | "discutivel" | "nao-indicado"`;

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido.' });
  }

  const {
    modulo = 'sugestao',
    paciente = {},
    indicacaoClinica = '',
    dadosClinicos = {},
    procedimentos = [],
    historico = [],
    contexto = {}
  } = req.body || {};

  // Monta contexto clínico para o prompt
  const partesPaciente = [
    paciente.nome        ? `Paciente: ${paciente.nome}` : '',
    paciente.idade       ? `Idade: ${paciente.idade} anos` : '',
    paciente.sexo        ? `Sexo: ${paciente.sexo}` : '',
    paciente.convenio    ? `Convênio: ${paciente.convenio}` : '',
    paciente.nascimento  ? `Nascimento: ${paciente.nascimento}` : '',
    paciente.atendimento ? `Atendimento: ${paciente.atendimento}` : '',
  ].filter(Boolean).join('\n');

  let userPrompt = '';

  if (modulo === 'sugestao') {
    userPrompt = `${partesPaciente}

Indicação clínica / dados da tela:
${indicacaoClinica || 'Não informada'}

${Object.keys(dadosClinicos).length > 0 ?
  'Dados clínicos adicionais:\n' + Object.entries(dadosClinicos)
    .filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n') : ''}

Sugira os exames de imagem mais indicados para este caso.`;

  } else if (modulo === 'validar') {
    const listaProcs = procedimentos.map(p =>
      `- ${p.codigo || '?'}: ${p.descricao || p.nome || '?'}`
    ).join('\n');

    userPrompt = `${partesPaciente}

Indicação clínica:
${indicacaoClinica || 'Não informada'}

Procedimentos solicitados:
${listaProcs || 'Nenhum procedimento informado'}

Avalie a coerência clínica e emita o parecer de autorização.`;
  } else {
    return res.status(400).json({ success: false, error: `Módulo desconhecido: ${modulo}` });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      system: modulo === 'sugestao' ? SYSTEM_SUGESTAO : SYSTEM_VALIDAR,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const textoResposta = response.content[0]?.text || '';

    // Parse JSON da resposta
    let dados;
    try {
      const clean = textoResposta.replace(/```json|```/g, '').trim();
      dados = JSON.parse(clean);
    } catch(e) {
      console.error('Erro parse JSON:', textoResposta.substring(0, 200));
      return res.status(200).json({
        success: false,
        error: 'Erro ao processar resposta da IA.',
        raw: textoResposta.substring(0, 500)
      });
    }

    return res.status(200).json(dados);

  } catch(err) {
    console.error('Erro Anthropic:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao consultar IA: ' + err.message
    });
  }
};
