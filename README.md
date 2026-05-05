# 🩺 IndiCare — Protótipo v0.1

**Plataforma de Propedêutica Diagnóstica por Imagem com Inteligência Artificial**

Desenvolvido por: Dr. Eder dos Santos Veggi  
Empresa: Indicare Tecnologia em Saúde Ltda.

---

## O que esse protótipo faz

- **Sugere exames de imagem** com base nos achados clínicos descritos em linguagem natural
- **Valida pedidos médicos** analisando coerência com diretrizes (ACR, CFM, SBREIM)
- **Consulta nomenclaturas** TUSS (convênios) e SIGTAP (SUS/SISREG)
- Usa **RAG (Retrieval-Augmented Generation)** — a IA responde com base nos protocolos clínicos reais, não em "achismo"

---

## Instalação — Passo a Passo

### 1. Pré-requisitos
- Python 3.10 ou superior instalado
- Conta na Anthropic para obter a API key

### 2. Baixar os arquivos
Copie toda a pasta `indicare/` para seu computador.

### 3. Criar ambiente virtual (recomendado)
```bash
cd indicare
python -m venv venv

# Ativar no Windows:
venv\Scripts\activate

# Ativar no Mac/Linux:
source venv/bin/activate
```

### 4. Instalar dependências
```bash
pip install -r requirements.txt
```
⏱️ Aguarde — o download do modelo de embeddings (~100MB) acontece na primeira execução.

### 5. Configurar a API Key da Anthropic
Edite o arquivo `.env` e cole sua chave:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```
Obtenha sua chave em: https://console.anthropic.com/

### 6. Rodar o protótipo
```bash
streamlit run src/app.py
```

O navegador abrirá automaticamente em: `http://localhost:8501`

---

## Estrutura de Pastas

```
indicare/
├── src/
│   └── app.py                    ← Aplicação principal (Streamlit)
├── protocolos/
│   ├── apendicite.md             ← Protocolo clínico
│   ├── lombalgia.md              ← Protocolo clínico
│   ├── dor_toracica_tep.md       ← Protocolo clínico
│   ├── tce_neurologico.md        ← Protocolo clínico
│   └── nomenclaturas_tuss_sigtap.csv ← Banco de nomenclaturas
├── requirements.txt              ← Dependências Python
├── .env                          ← Sua API key (não compartilhe!)
└── README.md                     ← Este arquivo
```

---

## Como adicionar novos protocolos

1. Crie um arquivo `.md` na pasta `protocolos/`
2. Siga o padrão dos protocolos existentes (seções, CID-10, códigos TUSS/SIGTAP)
3. Reinicie o app — o protocolo é indexado automaticamente
4. **Sem necessidade de código** — é só adicionar o arquivo Markdown

---

## Como funciona tecnicamente (RAG)

```
Você digita o caso clínico
        ↓
O texto é convertido em vetor matemático (embedding)
        ↓
ChromaDB busca os trechos mais relevantes dos protocolos
        ↓
Os trechos + seu caso são enviados para o Claude (Anthropic)
        ↓
Claude raciocina sobre o caso usando os protocolos como contexto
        ↓
Resposta com sugestão, justificativa e códigos TUSS/SIGTAP
```

**O diferencial do RAG:** a IA não "inventa" — ela responde baseada nos protocolos clínicos reais que você indexou.

---

## Próximas versões planejadas

- [ ] App mobile React Native (iOS + Android)
- [ ] Mais protocolos clínicos (20+ especialidades)
- [ ] Integração com tabela TUSS completa (ANS)
- [ ] Integração com SIGTAP completo (DATASUS)
- [ ] Módulo de geração de pedido médico em PDF
- [ ] API REST para integração com HIS/RIS
- [ ] Autenticação por CRM/COREN

---

## Custo estimado de uso

| Volume | Custo estimado |
|--------|---------------|
| 50 consultas/dia (testes) | ~R$ 5–15/mês |
| 500 consultas/dia (beta) | ~R$ 50–150/mês |
| 5.000 consultas/dia (escala) | ~R$ 500–1.500/mês |

*Valores baseados na API Claude Sonnet 4 da Anthropic*

---

## Suporte
Dr. Eder dos Santos Veggi — eder@indicaresaude.com.br
