/**
 * IndiCare — API Principal (Vercel Serverless)
 * Rota: POST /api/indicare
 * Módulos: sugestao | validar | visao (lê screenshot da tela Flash do MV)
 * USA fetch nativo — sem dependência de @anthropic-ai/sdk
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_SUGESTAO = `Você é um médico radiologista sênior e auditor clínico especialista em saúde suplementar brasileira, com 15 anos de experiência em propedêutica diagnóstica por imagem.

BASES DE REFERÊNCIA que fundamentam sua análise:
- ACR Appropriateness Criteria (American College of Radiology) — versão vigente
- Diretrizes do CBR (Colégio Brasileiro de Radiologia e Diagnóstico por Imagem)
- Diretrizes nacionais de sociedades médicas brasileiras
- Resolução CFM nº 2.228/2019
- Tabela TUSS/ANS vigente — use APENAS códigos TUSS válidos e atuais

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "success": true,
  "sugestao": {
    "raciocinioClinico": "Texto em 3-5 frases: (1) síntese do quadro clínico; (2) análise de SE HÁ OU NÃO indicação de estudo por imagem e por quê; (3) qual a estratégia propedêutica recomendada; (4) finalize citando as referências que fundamentam: ex. 'Fundamentação: ACR Appropriateness Criteria, Diretrizes CBR e diretrizes nacionais aplicáveis ao quadro.'",
    "indicacaoImagem": true,
    "procedimentos": [
      {
        "codigo": "40901033",
        "descricao": "US - ABDOME TOTAL",
        "linha": "primeira",
        "justificativa": "Justificativa clínica clara e objetiva em 1-2 frases, redigida como argumento técnico utilizável no processo de autorização do exame (ex: método de primeira linha, não invasivo e sem radiação ionizante, adequado para investigação inicial de dor abdominal em paciente jovem)."
      }
    ],
    "cid": "CID-10 sugerido",
    "justificativaGeral": "copie aqui o mesmo texto de raciocinioClinico"
  }
}

Regras:
- raciocinioClinico é OBRIGATÓRIO e vem ANTES de qualquer exame: avalie criticamente se imagem é indicada (pode concluir que NÃO é)
- Se não houver indicação de imagem: indicacaoImagem=false, procedimentos vazio, explique no raciocínio
- Máximo 5 exames ordenados por prioridade clínica e custo-efetividade
- linha: "primeira", "segunda" ou "terceira"
- Códigos TUSS reais e vigentes (US, TC, RM, RX, MN)
- justificativa de cada exame: clara, técnica e argumentável — SEM citar referências/diretrizes (elas já estão no raciocínio)
- EXCEÇÃO: se um exame foge das linhas habituais da propedêutica (indicação atípica), adicione o campo "referencia" com a diretriz específica que o respalda
- Considere: método menos invasivo primeiro, radiação em jovens/gestantes, custo-efetividade`;

const SYSTEM_VISAO = `Você é um médico radiologista sênior e auditor clínico brasileiro analisando uma CAPTURA DE TELA de um prontuário eletrônico (MV PEP) de um hospital.

TAREFA 1 — EXTRAIR da imagem:
- Nome do paciente, idade, sexo, convênio
- Queixa principal / motivo da consulta (campo S do SOAP)
- Exame físico (campo O)
- Hipóteses diagnósticas (campo A)
- Conduta (campo P)
- Evolução clínica se visível

TAREFA 2 — ELABORAR raciocínio clínico e SUGERIR exames de imagem.

BASES DE REFERÊNCIA que fundamentam sua análise: ACR Appropriateness Criteria (versão vigente), Diretrizes do CBR, diretrizes nacionais de sociedades médicas brasileiras, Resolução CFM nº 2.228/2019, Tabela TUSS/ANS vigente (use APENAS códigos TUSS válidos).

Responda APENAS com JSON válido neste formato exato (sem markdown):
{
  "success": true,
  "dadosExtraidos": {
    "nome": "nome do paciente se visível",
    "idade": "idade",
    "sexo": "sexo",
    "indicacaoClinica": "resumo estruturado: queixa + exame físico + hipótese + conduta"
  },
  "sugestao": {
    "raciocinioClinico": "Texto em 3-5 frases: (1) síntese do quadro lido na tela; (2) análise de SE HÁ OU NÃO indicação de estudo por imagem e por quê; (3) estratégia propedêutica recomendada; (4) finalize citando as referências: ex. 'Fundamentação: ACR Appropriateness Criteria, Diretrizes CBR e diretrizes nacionais aplicáveis.'",
    "indicacaoImagem": true,
    "cid": "CID-10 sugerido",
    "caraterAtendimento": "Eletiva",
    "tipoAtendimento": "Exame ambulatorial",
    "procedimentos": [
      {
        "codigo": "40901033",
        "descricao": "US - ABDOME TOTAL",
        "linha": "primeira",
        "justificativa": "Justificativa clara e objetiva em 1-2 frases, redigida como argumento técnico utilizável no processo de autorização do exame.",
        "protocolo": "Referência principal (ex: ACR AC - Acute Abdominal Pain 2022)"
      }
    ],
    "justificativaGeral": "copie aqui o mesmo texto de raciocinioClinico"
  }
}

Regras:
- raciocinioClinico OBRIGATÓRIO antes dos exames: avalie criticamente se imagem é indicada (pode concluir que NÃO é)
- Se não houver indicação: indicacaoImagem=false, procedimentos vazio, explique no raciocínio
- Máximo 5 exames, linha: "primeira"|"segunda"|"terceira"
- Códigos TUSS reais e vigentes
- justificativa por exame: clara e argumentável — SEM citar referências (já estão no raciocínio)
- EXCEÇÃO: exame fora das linhas habituais da propedêutica → adicione campo "referencia" com a diretriz que o respalda
- Se a tela não contém dados clínicos legíveis, procedimentos vazio e explique`;

const SYSTEM_VALIDAR = `Você é um médico auditor sênior de plano de saúde com expertise em medicina baseada em evidências e regulamentações da ANS.

BASES DE REFERÊNCIA: ACR Appropriateness Criteria, diretrizes do CBR, diretrizes nacionais de sociedades médicas, Resolução CFM nº 2.228/2019, Rol ANS e tabela TUSS vigente. Cite a base na justificativa de cada item.

Avalie a coerência clínica entre os dados do paciente, a indicação e os procedimentos solicitados.

Responda APENAS com JSON válido neste formato exato (sem markdown):
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
    imagemBase64 = '',
    contexto = {}
  } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'API key não configurada.' });
  }

  const partesPac = [
    paciente.nome     ? `Paciente: ${paciente.nome}` : '',
    paciente.idade    ? `Idade: ${paciente.idade} anos` : '',
    paciente.sexo     ? `Sexo: ${paciente.sexo}` : '',
    paciente.convenio ? `Convênio: ${paciente.convenio}` : '',
  ].filter(Boolean).join('\n');

  let systemPrompt = '';
  let messages = [];

  if (modulo === 'visao') {
    if (!imagemBase64) {
      return res.status(400).json({ success: false, error: 'imagemBase64 obrigatória no módulo visao.' });
    }
    systemPrompt = SYSTEM_VISAO;
    messages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: imagemBase64
          }
        },
        {
          type: 'text',
          text: `${partesPac ? 'Dados já conhecidos:\n' + partesPac + '\n\n' : ''}Analise esta tela do prontuário MV PEP. Extraia os dados clínicos visíveis (SOAP, hipóteses, conduta) e sugira os exames de imagem indicados.`
        }
      ]
    }];

  } else if (modulo === 'sugestao') {
    systemPrompt = SYSTEM_SUGESTAO;
    const dadosExtra = Object.keys(dadosClinicos).length > 0
      ? '\nDados clínicos adicionais:\n' + Object.entries(dadosClinicos)
          .filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
      : '';
    messages = [{
      role: 'user',
      content: `${partesPac}\n\nIndicação clínica:\n${indicacaoClinica || 'Não informada'}${dadosExtra}\n\nSugira os exames de imagem mais indicados.`
    }];

  } else if (modulo === 'validar') {
    systemPrompt = SYSTEM_VALIDAR;
    const listaProcs = (procedimentos || []).map(p =>
      `- ${p.codigo || '?'}: ${p.descricao || p.nome || '?'}`
    ).join('\n');
    messages = [{
      role: 'user',
      content: `${partesPac}\n\nIndicação clínica:\n${indicacaoClinica || 'Não informada'}\n\nProcedimentos solicitados:\n${listaProcs || 'Nenhum informado'}\n\nAvalie a coerência clínica.`
    }];

  } else {
    return res.status(400).json({ success: false, error: `Módulo desconhecido: ${modulo}` });
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
        max_tokens: 2500,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic error:', errText.substring(0, 300));
      return res.status(500).json({ success: false, error: `Erro Anthropic: ${response.status}` });
    }

    const data = await response.json();
    const textoResposta = data.content?.[0]?.text || '';

    let resultado;
    try {
      const clean = textoResposta.replace(/```json|```/g, '').trim();
      resultado = JSON.parse(clean);
    } catch(e) {
      console.error('Parse error:', textoResposta.substring(0, 200));
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
