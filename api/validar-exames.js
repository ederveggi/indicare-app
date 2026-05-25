/**
 * IndiCare — POST /api/validar-exames
 * Vercel Serverless Function · Node.js 20
 *
 * Recebe indicação clínica + exames já selecionados pelo médico
 * e avalia o nível de coerência de cada exame com a indicação,
 * baseado nos protocolos ACR, SBREIM e CFM.
 *
 * Mesmo padrão do api/claude.js: fetch puro, sem SDK.
 */

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'API Key não configurada.' });

  const { paciente, indicacaoClinica, procedimentos } = req.body || {};

  if (!indicacaoClinica) return res.status(400).json({ error: 'indicacaoClinica obrigatória.' });
  if (!procedimentos?.length) return res.status(400).json({ error: 'procedimentos obrigatórios.' });

  const idade = calcularIdade(paciente?.nascimento);
  const message = `VALIDAÇÃO DE COERÊNCIA CLÍNICA — UNIMED CUIABÁ

PACIENTE:
- Nome: ${paciente?.nome || 'Não informado'}
- Idade: ${idade != null ? `${idade} anos` : 'Não informada'}

INDICAÇÃO CLÍNICA DO MÉDICO:
"${indicacaoClinica}"

EXAMES SOLICITADOS PARA VALIDAR:
${procedimentos.map((p, i) => `${i+1}. [${p.codigo || '?'}] ${p.descricao || p.nome || 'Sem descrição'}`).join('\n')}

Avalie a coerência de CADA exame com a indicação clínica, segundo protocolos ACR, SBREIM e CFM.
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
        model: 'claude-sonnet-4-5',
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

const SYSTEM_PROMPT = `Você é o IndiCare, assistente de propedêutica diagnóstica para médicos brasileiros.
Sua base: ACR Appropriateness Criteria, SBREIM, CFM Res. 2.228/2019, tabela TUSS/ANS.

Avalie a coerência de cada exame com a indicação clínica fornecida.

SCHEMA DE RESPOSTA (JSON exato, sem markdown):
{
  "itens": [
    {
      "codigo": "código TUSS ou '?'",
      "descricao": "nome do exame",
      "nivel": "adequado" | "discutivel" | "nao-indicado",
      "justificativa": "fundamentação baseada em protocolo ACR/SBREIM/CFM (máx 120 chars)",
      "protocolo": "ex: ACR AC 8, SBREIM 2023"
    }
  ],
  "recomendacao": "Recomendação geral do IndiCare para esta situação clínica (máx 200 chars)"
}

Níveis:
- adequado: exame claramente indicado pelos protocolos para esta situação
- discutivel: indicação dependente de contexto clínico adicional
- nao-indicado: não recomendado ou contraindicado pelos protocolos para esta situação`;

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
