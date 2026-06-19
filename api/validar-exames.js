/**
 * IndiCare — POST /api/validar-exames
 * Vercel Serverless Function · Node.js 20
 * v2.0 — 2ª barreira de anonimização (LGPD / defesa em profundidade)
 *  - Prompt sem identificadores (só idade/sexo).
 *  - Sanitização de entrada: PII descartada antes de montar o prompt.
 *  - Idade lida do campo `idade` (fallback p/ nascimento).
 *  - "SBREIM" (inexistente) -> CBR.
 */

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é o IndiCare, assistente de propedêutica diagnóstica para médicos brasileiros.
Sua base: ACR Appropriateness Criteria, diretrizes do CBR (Colégio Brasileiro de Radiologia), CFM Res. 2.228/2019, tabela TUSS/ANS.

Avalie a coerência de cada exame com a indicação clínica fornecida.

SCHEMA DE RESPOSTA (JSON exato, sem markdown):
{
  "itens": [
    {
      "codigo": "código TUSS ou '?'",
      "descricao": "nome do exame",
      "nivel": "adequado" | "discutivel" | "nao-indicado",
      "justificativa": "fundamentação baseada em protocolo ACR/CBR/CFM (máx 120 chars)",
      "protocolo": "ex: ACR AC 8, CBR 2023"
    }
  ],
  "recomendacao": "Recomendação geral do IndiCare para esta situação clínica (máx 200 chars)"
}

Níveis:
- adequado: exame claramente indicado pelos protocolos para esta situação
- discutivel: indicação dependente de contexto clínico adicional
- nao-indicado: não recomendado ou contraindicado pelos protocolos para esta situação`;

/* ════════════════════════════════════════════════════════════════
 * 2ª BARREIRA — Sanitização de entrada (servidor)
 * ════════════════════════════════════════════════════════════════ */

function scrubTexto(texto) {
  if (typeof texto !== 'string' || !texto) return '';
  let t = texto;
  t = t.replace(/(\b(?:data\s+de\s+nascimento|nascimento|dn|d\.n\.)\s*[:\-]\s*)(\d{2}\/\d{2}\/\d{4})/gi,
    (full, pre, data) => {
      const id = calcularIdade(data);
      return id != null ? `Idade: ${id} anos` : `${pre}[DATA_NASCIMENTO]`;
    });
  const rotulos = [
    ['nome do paciente', '[PACIENTE]'], ['nome da mãe', '[NOME_MAE]'],
    ['nome da mae', '[NOME_MAE]'], ['paciente', '[PACIENTE]'],
    ['beneficiário', '[BENEFICIARIO]'], ['beneficiario', '[BENEFICIARIO]'],
    ['carteirinha', '[CARTEIRINHA]'], ['carteira', '[CARTEIRINHA]'],
    ['matrícula', '[MATRICULA]'], ['matricula', '[MATRICULA]'],
    ['rg', '[RG]'], ['endereço', '[ENDERECO]'], ['endereco', '[ENDERECO]'],
    ['nome', '[NOME]'],
  ];
  for (const [chave, rot] of rotulos) {
    const esc = chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(\\b' + esc + '\\s*[:\\-]\\s*)(?!\\[)([^\\n\\r,.;]+)', 'gi');
    t = t.replace(re, (full, pre) => pre + rot);
  }
  const padroes = [
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
    [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
    [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]'],
    [/\b\d{3}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, '[CARTAO_SUS]'],
    [/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d?\s?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]'],
    [/\b\d{5}-?\d{3}\b/g, '[CEP]'],
    [/\b\d{2}\/\d{2}\/\d{4}\b/g, '[DATA]'],
  ];
  for (const [re, rot] of padroes) t = t.replace(re, rot);
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

function sanitizarPaciente(pac) {
  pac = pac || {};
  const out = {};
  let idade = pac.idade;
  if ((idade === undefined || idade === null || idade === '') && pac.nascimento) {
    const c = calcularIdade(pac.nascimento);
    if (c != null) idade = c;
  }
  if (idade !== undefined && idade !== null && idade !== '') {
    const n = parseInt(String(idade).replace(/[^\d]/g, ''), 10);
    if (!isNaN(n)) out.idade = n;
  }
  if (pac.sexo) out.sexo = String(pac.sexo).substring(0, 20);
  return out;
}

function sanitizarHistorico(historico) {
  if (!Array.isArray(historico)) return [];
  return historico.slice(0, 5).map(h => ({
    data: (h && h.data) ? String(h.data).substring(0, 20) : '',
    descricao: scrubTexto((h && (h.descricao || h.raw)) || ''),
  }));
}

// Procedimentos: mantém código/descrição (são dados clínicos), mas
// passa a descrição por scrub por segurança.
function sanitizarProcedimentos(procs) {
  if (!Array.isArray(procs)) return [];
  return procs.slice(0, 10).map(p => ({
    codigo: (p && (p.codigo || p.codigoTUSS)) ? String(p.codigo || p.codigoTUSS).substring(0, 20) : '?',
    descricao: scrubTexto((p && (p.descricao || p.nome)) || ''),
  }));
}

// ── HELPER ────────────────────────────────────────────────────────────────────
function calcularIdade(nascimento) {
  if (!nascimento) return null;
  const p = String(nascimento).split('/');
  if (p.length !== 3) return null;
  const nasc = new Date(`${p[2]}-${p[1]}-${p[0]}`);
  if (isNaN(nasc)) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  if (idade < 0 || idade > 130) return null;
  return idade;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'API Key não configurada.' });

  const body = req.body || {};

  // ── 2ª BARREIRA: sanitiza tudo que chega ──
  const paciente         = sanitizarPaciente(body.paciente);
  const indicacaoClinica = scrubTexto(body.indicacaoClinica || '');
  const procedimentos    = sanitizarProcedimentos(body.procedimentos);
  const historico        = sanitizarHistorico(body.historico);

  if (!indicacaoClinica || indicacaoClinica.trim().length < 5) {
    return res.status(400).json({ error: 'indicacaoClinica obrigatória (mínimo 5 caracteres).' });
  }
  if (!procedimentos.length) return res.status(400).json({ error: 'procedimentos obrigatórios.' });

  const idade = paciente.idade;
  const linhaSexo = paciente.sexo ? `\n- Sexo: ${paciente.sexo}` : '';

  const secaoHistorico = (historico && historico.length > 0)
    ? `\nHISTÓRICO RECENTE (${historico.length} atendimentos):\n` +
      historico.map(h => `- ${h.data || ''}: ${h.descricao || ''}`).join('\n')
    : '';

  const message = `VALIDAÇÃO DE COERÊNCIA CLÍNICA — UNIMED CUIABÁ

PACIENTE (dados clínicos minimizados — sem identificação):
- Idade: ${idade != null ? `${idade} anos` : 'Não informada'}${linhaSexo}

INDICAÇÃO CLÍNICA DO MÉDICO:
"${indicacaoClinica}"

EXAMES SOLICITADOS PARA VALIDAR:
${procedimentos.map((p, i) => `${i + 1}. [${p.codigo || '?'}] ${p.descricao || 'Sem descrição'}`).join('\n')}
${secaoHistorico}

Avalie a coerência de CADA exame com a indicação clínica, segundo protocolos ACR, CBR e CFM.
${(historico && historico.length > 0) ? 'Considere o histórico para avaliar repetição desnecessária de exames recentes.' : ''}
Responda SOMENTE com JSON conforme o schema definido.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Erro ${response.status}` });
    }

    const data = await response.json();
    const text = data.content[0].text;

    let validacao;
    try {
      validacao = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return res.status(500).json({ error: 'IA retornou formato inválido.', raw: text });
    }

    return res.status(200).json({ success: true, validacao });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
