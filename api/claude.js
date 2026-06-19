/**
 * IndiCare — POST /api/claude  (proxy genérico)
 * Vercel Serverless Function
 *
 * v2.0 — 2ª barreira de anonimização (LGPD / defesa em profundidade)
 *  Esta rota é um PROXY genérico: recebe `message`/`system` prontos do
 *  cliente. Como rede de segurança, o `message` passa por um scrub que
 *  remove identificadores estruturados antes de repassar à Anthropic.
 *  Quando há imagem, injeta instrução LGPD no system para a IA não
 *  extrair/transcrever identificadores visíveis.
 *
 *  IMPORTANTE: por ser proxy genérico, a proteção principal depende da
 *  1ª barreira no cliente (web app). O scrub aqui é complementar.
 */

// Aumentar limite do body parser do Vercel
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

/* ── Scrub de PII em texto livre (rede de segurança) ──────────────── */
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

function scrubTexto(texto) {
  if (typeof texto !== 'string' || !texto) return texto;
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

const AVISO_LGPD_IMAGEM = `\n\n⚠️ LGPD (OBRIGATÓRIO): a imagem pode conter dados pessoais visíveis. NÃO extraia, NÃO transcreva e NÃO inclua na resposta nome, carteirinha, CPF, CNS, RG, telefone, endereço ou qualquer identificador do paciente. Use apenas idade, sexo e dados estritamente clínicos.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'API Key não configurada no servidor.' });
  try {
    const { system, message, image_base64, image_mime, max_tokens = 1500 } = req.body;
    if (!message) return res.status(400).json({ error: 'Campo message obrigatório.' });

    // ── 2ª BARREIRA: scrub do texto antes de repassar ──
    const messageLimpa = scrubTexto(message);
    const temImagem = image_base64 && image_base64.length > 100;
    const systemFinal = (system || 'Você é um assistente médico especializado em propedêutica diagnóstica.')
                        + (temImagem ? AVISO_LGPD_IMAGEM : '');

    let content;
    if (temImagem) {
      content = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image_mime || 'image/jpeg',
            data: image_base64
          }
        },
        { type: 'text', text: messageLimpa }
      ];
    } else {
      content = messageLimpa;
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens,
        system: systemFinal,
        messages: [{ role: 'user', content }]
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Erro: ${response.status}` });
    }
    const data = await response.json();
    return res.status(200).json({ text: data.content[0].text });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
