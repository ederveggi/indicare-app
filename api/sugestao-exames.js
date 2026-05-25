/**
 * IndiCare — POST /api/sugestao-exames
 * Vercel Serverless Function · Node.js 20
 */

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

// ── HELPERS (antes do handler — evita ReferenceError) ─────────────────────────

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
      codigo:        p.codigoTUSS  || p.codigo       || '',
      descricao:     p.descricao   || p.nome          || '',
      justificativa: p.justificativa                  || '',
      ultimaExecucao:p.ultimaExecucao                || '',
    })),
    observacoes:        (s.observacoes        || '').substring(0, 500),
  };
}

function montarPrompt(paciente, solicitante, contexto, indicacaoClinica, historico) {
  const idade  = calcularIdade(paciente.nascimento);
  const perfil = idade != null
    ? `${idade} anos${idade >= 75 ? ' — Idoso >75a (atenção a contraindicações)' : idade < 18 ? ' — Pediátrico' : ''}`
    : 'Não informada';

  const secaoIndicacao = indicacaoClinica
    ? `\nINDICAÇÃO CLÍNICA DO MÉDICO:\n"${indicacaoClinica}"\n`
    : '';

  const secaoHistorico = historico?.length > 0
    ? `\nHISTÓRICO DE ATENDIMENTOS RECENTES (${historico.length} registros):\n` +
      historico.slice(0, 8).map(h => `- ${h.data || ''}: ${h.descricao || h.tipo || h.raw || ''}`).join('\n') + '\n'
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
Sugira os exames de imagem mais indicados segundo ACR, SBREIM e CFM.
${indicacaoClinica ? 'Baseie-se principalmente na indicação clínica fornecida.' : 'Considere rastreamentos para a faixa etária.'}
${historico?.length > 0 ? 'Use o histórico para evitar repetição de exames recentes desnecessários.' : ''}
Responda SOMENTE com o JSON conforme o schema definido.`;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é o IndiCare, assistente de propedêutica diagnóstica de imagem para médicos brasileiros.

Sua base de conhecimento inclui:
- ACR Appropriateness Criteria (American College of Radiology)
- Diretrizes SBREIM (Sociedade Brasileira de Radiologia e Diagnóstico por Imagem)
- CFM Resolução 2.228/2019 — indicações de exames de imagem
- Tabela TUSS vigente (Terminologia Unificada da Saúde Suplementar — ANS)
- CBHPM (Classificação Brasileira Hierarquizada de Procedimentos Médicos)

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
  "indicacaoClinica": "Texto objetivo (máx 490 chars)",
  "procedimentos": [
    {
      "codigoTUSS": "40308361",
      "descricao": "Nome oficial conforme tabela TUSS/ANS",
      "justificativa": "Protocolo de referência (ex: ACR AC 8, SBREIM 2023)"
    }
  ],
  "observacoes": "Observações para o auditor médico (opcional)"
}`;

// ── HANDLER ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'API Key não configurada.' });

  const { paciente, solicitante, contexto, indicacaoClinica, historico } = req.body || {};

  if (!paciente || (!paciente.nome && !paciente.cpf && !paciente.carteira)) {
    return res.status(400).json({ error: 'Dados do paciente obrigatórios.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: montarPrompt(paciente, solicitante, contexto, indicacaoClinica, historico) }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Erro ${response.status}` });
    }

    const data = await response.json();
    const text = data.content[0].text;

    let sugestao;
    try {
      sugestao = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return res.status(500).json({ error: 'IA retornou formato inválido.', raw: text });
    }

    return res.status(200).json({ success: true, sugestao: normalizar(sugestao) });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
