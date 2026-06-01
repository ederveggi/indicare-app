/**
 * IndiCare — POST /api/sugestao-exames
 * Vercel Serverless Function · Node.js 20
 */

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

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
    justificativaGeral: s.justificativaGeral  || '',
    procedimentos:      (s.procedimentos      || []).slice(0, 3).map((p, i) => ({
      linha:         p.linha        || ['primeira','segunda','terceira'][i] || 'primeira',
      codigo:        p.codigoTUSS   || p.codigo      || '',
      descricao:     p.descricao    || p.nome         || '',
      justificativa: p.justificativa                  || '',
      protocolo:     p.protocolo                      || '',
      ultimaExecucao:p.ultimaExecucao                || '',
    })),
    observacoes:        (s.observacoes        || '').substring(0, 500),
  };
}

function montarPrompt(paciente, solicitante, contexto, indicacaoClinica, historico) {
  const idade  = calcularIdade(paciente.nascimento);
  const perfil = idade != null
    ? `${idade} anos${idade >= 75 ? ' — Idoso >75a' : idade < 18 ? ' — Pediátrico' : ''}`
    : 'Não informada';

  const secaoIndicacao = indicacaoClinica
    ? `\nINDICAÇÃO CLÍNICA DO MÉDICO:\n"${indicacaoClinica}"\n` : '';

  const secaoHistorico = historico?.length > 0
    ? `\nHISTÓRICO (${historico.length} atendimentos):\n` +
      historico.slice(0, 8).map(h => `- ${h.data||''}: ${h.descricao||h.raw||''}`).join('\n') + '\n'
    : '';

  return `SOLICITAÇÃO DE PROPEDÊUTICA — UNIMED CUIABÁ (ANS 34.208-4)

PACIENTE:
- Nome: ${paciente.nome || 'Não informado'}
- Idade: ${perfil}
- Nascimento: ${paciente.nascimento || 'Não informado'}
- CNS: ${paciente.cns || 'Não informado'}
- Carteira: ${paciente.carteira || paciente.usuario || 'Não informado'}

SOLICITANTE:
- Médico: ${solicitante?.nome || 'Não informado'}
- Código: ${solicitante?.codigo || 'Não informado'}
${secaoIndicacao}${secaoHistorico}
Sugira os exames de imagem mais indicados segundo ACR, SBREIM e CFM.
Ordene por prioridade clínica (1 = mais urgente/importante).
Responda SOMENTE com o JSON conforme o schema definido.`;
}

const SYSTEM_PROMPT = `Você é o IndiCare, assistente de propedêutica diagnóstica de imagem para médicos brasileiros.
Base: ACR Appropriateness Criteria, SBREIM, CFM Res. 2.228/2019, tabela TUSS/ANS vigente.

SISTEMA: Unimed Cuiabá usa o sistema MV com PREFIXOS ABREVIADOS nas descrições.
SEMPRE use estes prefixos EXATOS no campo "descricao" (é assim que o sistema busca):
- "RM - " para Ressonância Magnética (ex: "RM - ABDOME SUPERIOR", "RM - COLUNA LOMBAR", "RM - PELVE")
- "TC - " para Tomografia Computadorizada (ex: "TC - ABDOME TOTAL", "TC - TORAX")
- "US - " para Ultrassonografia (ex: "US - ABDOME TOTAL", "US - PELVICA")
- "RX - " para Raio-X (ex: "RX - TORAX", "RX - ABDOME")
- "DOPPLER COLORIDO DE " para Doppler (sem prefixo abreviado, por extenso)

EXEMPLOS REAIS do sistema (descrição EXATA):
- "RM - ABDOME SUPERIOR (FIGADO, PANCREAS, BACO, RINS, SUPRA-RENAIS, RETROPERITONIO)" → 41101170
- "RM - COLUNA CERVICAL OU DORSAL OU LOMBAR" → 41101227
- "ANGIOTOMOGRAFIA DE AORTA ABDOMINAL" → 41001184
- "ANGIOTOMOGRAFIA ARTERIAL DE ABDOME SUPERIOR" → 41001435
- "ANGIOTOMOGRAFIA ARTERIAL DE MEMBRO INFERIOR" → 41001478
- "ANGIOTOMOGRAFIA ARTERIAL DE PELVE" → 41001451
- "DOPPLER COLORIDO DE ARTERIAS VISCERAIS MESOENTERICAS" → 40901416
- "DOPPLER COLORIDO DE AORTA E ARTERIAS RENAIS" → 40901394
- "DOPPLER COLORIDO ARTERIAL DE MEMBRO INFERIOR - UNILATERAL" → 40901475
- "US - ABDOME TOTAL" → busca por "US - ABDOME"

IMPORTANTE: ANGIOTOMOGRAFIA é escrita por EXTENSO (não "TC -" nem "angiotc").
Use sempre "ANGIOTOMOGRAFIA" + região (ARTERIAL/VENOSA DE ...).

REGRAS CRÍTICAS:
1. Responda SOMENTE com JSON válido — sem texto, sem markdown.
2. Máximo 3 procedimentos: "primeira linha", "segunda linha", "terceira linha".
3. DESCRIÇÃO com prefixo correto (RM -, TC -, US -, RX - ou DOPPLER COLORIDO DE).
4. Para o sistema buscar, a descrição deve começar com o prefixo certo.
5. justificativaGeral: 2-3 frases de raciocínio diagnóstico.
6. CID-10: o mais específico para a indicação.
7. Idosos >75a: prefira Doppler ou US (sem contraste/radiação) como 1ª linha.
8. Adenomiose/pelve feminina: "RM - PELVE" como 1ª linha.
9. Isquemia mesentérica: "DOPPLER COLORIDO DE ARTERIAS VISCERAIS MESOENTERICAS" 1ª linha.

SCHEMA (JSON exato):
{
  "tipoPedido": "sadt",
  "indicacaoAcidente": "Não acidente",
  "previsaoOPME": "Não",
  "previsaoOncologia": "Não",
  "atendimentoRN": "Não",
  "tipoAtendimento": "Exame ambulatorial",
  "caraterAtendimento": "Eletiva",
  "cid": "K55.0",
  "indicacaoClinica": "Texto técnico objetivo (máx 490 chars)",
  "justificativaGeral": "Raciocínio diagnóstico em 2-3 frases",
  "procedimentos": [
    {
      "linha": "primeira",
      "codigoTUSS": "40901416",
      "descricao": "DOPPLER COLORIDO DE ARTERIAS VISCERAIS MESOENTERICAS",
      "justificativa": "Por que é primeira linha (máx 100 chars)",
      "protocolo": "ACR AC 9, SBREIM 2023"
    }
  ],
  "observacoes": "Alertas clínicos para o auditor médico"
}`;

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
        max_tokens: 1500,
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
