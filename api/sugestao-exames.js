/**
 * IndiCare — POST /api/sugestao-exames
 * Vercel Serverless Function · Node.js 20
 *
 * Padrão idêntico ao api/claude.js existente:
 * - fetch puro para Anthropic, sem SDK
 * - mesma estrutura de CORS e error handling
 * - retorna { text } internamente, mas converte para { success, sugestao }
 *
 * Chamado pela extensão Chrome ao clicar "🩺 IndiCare — Sugerir Exames"
 * na página da Unimed Cuiabá. Nenhum dado é persistido (LGPD).
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {

  // ── CORS — mesmo padrão do claude.js ─────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método não permitido' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY)
    return res.status(500).json({ error: 'API Key não configurada no servidor.' });

  // ── Validação do body ─────────────────────────────────────────────────────
  const { paciente, solicitante, contexto, indicacaoClinica, historico } = req.body || {};

  if (!paciente || (!paciente.nome && !paciente.cpf && !paciente.carteira)) {
    // indicacaoClinica é opcional — se não vier, IA usa só perfil do paciente
    return res.status(400).json({
      error: 'Dados do paciente obrigatórios (nome, cpf ou carteira).'
    });
  }

  // ── Monta system + message (mesmo contrato do claude.js) ─────────────────
  const system  = SYSTEM_PROMPT;
  const message = montarPrompt(paciente, solicitante, contexto, indicacaoClinica, historico);

  // ── Chama Anthropic — fetch puro, igual ao claude.js ─────────────────────
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: err.error?.message || `Erro Anthropic: ${response.status}`
      });
    }

    const data = await response.json();
    const text = data.content[0].text;   // mesmo acesso do claude.js

    // ── Parse do JSON retornado pelo Claude ──────────────────────────────
    let sugestao;
    try {
      const limpo = text.replace(/```json|```/g, '').trim();
      sugestao = JSON.parse(limpo);
    } catch {
      console.error('[sugestao-exames] JSON inválido:', text);
      return res.status(500).json({ error: 'IA retornou formato inválido.', raw: text });
    }

    return res.status(200).json({
      success:  true,
      sugestao: normalizar(sugestao),
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — protocolos ACR, SBREIM, CFM (alinhado com Módulo 1)
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `Você é o IndiCare, assistente de propedêutica diagnóstica de imagem para médicos brasileiros.

Sua base de conhecimento inclui:
- ACR Appropriateness Criteria (American College of Radiology)
- Diretrizes SBREIM (Sociedade Brasileira de Radiologia e Diagnóstico por Imagem)
- CFM Resolução 2.228/2019 — indicações de exames de imagem
- Tabela TUSS vigente (Terminologia Unificada da Saúde Suplementar — ANS)
- CBHPM (Classificação Brasileira Hierarquizada de Procedimentos Médicos)
- Padrões TISS/ANS para operadoras de saúde suplementar

REGRAS:
1. Responda SOMENTE com JSON válido — sem texto, sem markdown, sem explicações.
2. Use códigos TUSS reais de 8 dígitos (tabela ANS vigente).
3. Máximo 5 procedimentos, ordenados por relevância clínica.
4. Caráter "Eletiva" por padrão; "Urgência" só se clinicamente justificável.
5. Indicação clínica: máximo 490 caracteres, linguagem técnica objetiva.
6. CID-10: o mais específico possível para o perfil do paciente.
7. Para idosos >75a: priorize modalidades sem contraste e sem radiação excessiva.
8. Se dados insuficientes: retorne procedimentos compatíveis com rastreamento da faixa etária.

SCHEMA DE RESPOSTA (JSON exato):
{
  "tipoPedido": "sadt",
  "indicacaoAcidente": "Não acidente",
  "previsaoOPME": "Não",
  "previsaoOncologia": "Não",
  "atendimentoRN": "Não",
  "tipoAtendimento": "Exame ambulatorial",
  "caraterAtendimento": "Eletiva",
  "cid": "Z00.0",
  "indicacaoClinica": "Texto objetivo baseado em protocolos ACR/SBREIM (máx 490 chars)",
  "procedimentos": [
    {
      "codigoTUSS": "40308361",
      "descricao": "Nome oficial conforme tabela TUSS/ANS",
      "justificativa": "Protocolo de referência (ex: ACR AC 8, SBREIM 2023)"
    }
  ],
  "observacoes": "Observações para o auditor médico (opcional)"
}`;

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT — monta com dados reais do paciente lidos da página Unimed
// ═══════════════════════════════════════════════════════════════════════════

function montarPrompt(paciente, solicitante, contexto, indicacaoClinica, historico) {
  const idade  = calcularIdade(paciente.nascimento);
  const perfil = idade != null
    ? `${idade} anos${idade >= 75 ? ' — Idoso >75a (atenção a contraindicações)' : idade < 18 ? ' — Pediátrico' : ''}`
    : 'Não informada';

  const secaoHistorico = historico?.length > 0
    ? `
HISTÓRICO DE ATENDIMENTOS RECENTES (${historico.length} registros):
` +
      historico.slice(0, 8).map(h => `- ${h.data || ''}: ${h.descricao || h.tipo || h.raw || ''}`).join('
')
    : '';

  const secaoIndicacao = indicacaoClinica
    ? `
INDICAÇÃO CLÍNICA DO MÉDICO:
"${indicacaoClinica}"
`
    : '';

  return `SOLICITAÇÃO DE PROPEDÊUTICA — UNIMED CUIABÁ (ANS 34.208-4)

PACIENTE:
- Nome: ${paciente.nome            || 'Não informado'}
- Idade: ${perfil}
- Nascimento: ${paciente.nascimento || 'Não informado'}
- CNS: ${paciente.cns              || 'Não informado'}
- Carteira: ${paciente.carteira    || paciente.usuario || 'Não informado'}

SOLICITANTE:
- Médico: ${solicitante?.nome      || 'Não informado'}
- Código: ${solicitante?.codigo    || 'Não informado'}

GUIA: ${contexto?.guia || 'Nova solicitação'}
${secaoIndicacao}${secaoHistorico}
Sugira os exames de imagem mais indicados para este paciente segundo ACR, SBREIM e CFM.
${indicacaoClinica ? 'Baseie-se principalmente na indicação clínica fornecida.' : 'Considere rastreamentos recomendados para a faixa etária.'}
${historico?.length > 0 ? 'Use o histórico para evitar repetição de exames recentes desnecessários.' : ''}
Responda SOMENTE com o JSON conforme o schema definido.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO — garante todos os campos esperados pela extensão
// ═══════════════════════════════════════════════════════════════════════════

function normalizar(s) {
  return {
    tipoPedido:         s.tipoPedido         || 'sadt',
    indicacaoAcidente:  s.indicacaoAcidente  || 'Não acidente',
    previsaoOPME:       s.previsaoOPME        || 'Não',
    previsaoOncologia:  s.previsaoOncologia   || 'Não',
    atendimentoRN:      s.atendimentoRN       || 'Não',
    tipoAtendimento:    s.tipoAtendimento     || 'Exame ambulatorial',
    caraterAtendimento: s.caraterAtendimento  || 'Eletiva',
    cid:                s.cid                 || '',
    indicacaoClinica:   (s.indicacaoClinica   || '').substring(0, 490),
    procedimentos:      (s.procedimentos      || []).slice(0, 5).map(p => ({
      codigo:         p.codigoTUSS  || p.codigo  || '',
      descricao:      p.descricao   || p.nome     || '',
      justificativa:  p.justificativa             || '',
      ultimaExecucao: p.ultimaExecucao           || '',
    })),
    observacoes:        (s.observacoes        || '').substring(0, 500),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function calcularIdade(nascimento) {
  if (!nascimento) return null;
  const p = nascimento.split('/');
  if (p.length !== 3) return null;
  const nasc = new Date(`${p[2]}-${p[1]}-${p[0]}`);
  if (isNaN(nasc)) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}
