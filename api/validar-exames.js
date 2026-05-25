/**
 * IndiCare — POST /api/validar-exames
 * Função Serverless Vercel · Node.js 20
 *
 * Recebe indicação clínica + exames já selecionados pelo médico
 * e avalia o nível de coerência de cada exame com indicação,
 *baseado nos protocolos ACR, SBREIM e CFM.
 *
 * Mesmo padrão do api/claude.js: fetch puro, sem SDK.
 */

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({erro: 'API Key não ajustada.' });

  const {paciente, indicaçãoClínica, procedimentos, histórico } = req.body || {};

  if (!indicacaoClinica) return res.status(400).json({ erro: 'indicacaoClinica obrigatória.' });
  if (!procedimentos?.length) return res.status(400).json({ erro: 'procedimentos obrigatórios.' });

  const idade = calcularIdade(paciente?.nascimento);
  const message = `VALIDAÇÃO DE COERÊNCIA CLÍNICA — UNIMED CUIABÁ

PACIENTE:
- Nome: ${paciente?.nome || 'Não informado'}
- Idade: ${idade != null ? `${idade} anos` : 'Não informado'}

INDICAÇÃO CLÍNICA DO MÉDICO:
"${indicacaoClinica}"

EXAMES SOLICITADOS PARA VALIDAR:
${procedimentos.map((p, i) => `${i+1}. [${p.codigo || '?'}] ${p.descricao || p.nome || 'Sem descrição'}`).join('\n')}
${histórico?.length > 0 ? `\nHISTÓRICO RECENTE (${historico.length} atendimentos):\n` + historico.slice(0,5).map(h => `- ${h.data||''}: ${h.descricao||h.raw||''}`).join('\n') : ''}

Avalie a coerência de exame CADA com indicação clínica, segundo protocolos ACR, SBREIM e CFM.
${histórico?.length > 0 ? 'Considere o histórico para avaliar se há repetição de exames recentes.' : ''}
Responda SOMENTE com JSON conforme o esquema definido.`;

  tentar {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      método: 'POST',
      cabeçalhos: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'versão antrópica': '2023-06-01',
      },
      corpo: JSON.stringify({
        modelo: 'claude-sonnet-4-5',
        max_tokens: 1024,
        sistema: PROMPT_DO_SISTEMA,
        mensagens: [{ função: 'usuário', conteúdo: mensagem }],
      }),
    });

    se (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Erro ${response.status}` });
    }

    const data = await response.json();
    const texto = data.content[0].texto;

    deixe a validação;
    tentar {
      validação = JSON.parse(text.replace(/```json|```/g, '').trim());
    } pegar {
      return res.status(500).json({ erro: 'IA retornou formato inválido.', raw: text });
    }

    retornar res.status(200).json({ sucesso: true, validação });

  } catch (erro) {
    return res.status(500).json({ erro: 'Erro interno: ' + err.message });
  }
}

const SYSTEM_PROMPT = `Você é o IndiCare, assistente de propedêutica diagnóstica para médicos brasileiros.
Sua base: Critérios de Adequação ACR, SBREIM, CFM Res. 2.228/2019, tabela TUSS/ANS.

Avalie a coerência de cada exame com a indicação clínica fornecida.

ESQUEMA DE RESPOSTA (JSON exato, sem markdown):
{
  "itens": [
    {
      "codigo": "código TUSS ou '?'",
      "descricao": "nome do exame",
      "nível": "adequado" | "discutível" | "não-indicado",
      "justificativa": "fundamentação baseada em protocolo ACR/SBREIM/CFM (máx 120 caracteres)",
      "protocolo": "ex: ACR AC 8, SBREIM 2023"
    }
  ],
  "recomendacao": "Recomendação geral do IndiCare para esta situação clínica (máx 200 caracteres)"
}

Nfi:
- adequado: exame claramente indicado pelos protocolos para esta situação
- discutivel: indicação dependente do contexto clínico adicional
- não-indicado: não recomendado ou contraindicado pelos protocolos para esta situação`;

function calcularIdade(nascimento) {
  se (!nascimento) retornar nulo;
  const p = nascimento.split('/');
  se (p.length !== 3) retorne nulo;
  const nasc = new Date(`${p[2]}-${p[1]}-${p[0]}`);
  se (isNaN(nasc)) retorne nulo;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  retornar idade;
}
