const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================
// DADOS FINANCEIROS (mesmos do agente original)
// ============================================
const dadosFinanceiros = {
  "2025-12": {
    periodo: "Dezembro 2025",
    receitas: { total: 54982.75, starken: 29833.00, alpha: 25149.75 },
    despesas: { total: 31869.90 },
    lucro: 23112.85,
    margem: 42
  }
};

// ============================================
// SYSTEM PROMPT
// ============================================
const SYSTEM_PROMPT = `Você é o STARK, o CFO Virtual da Starken Tecnologia.

## SUA PERSONALIDADE
Fale de forma direta, prática, sem enrolação. Tom informal mas profissional.

## QUANDO ANALISAR ARQUIVOS IMPORTADOS
- Use APENAS os dados do arquivo que estão no CONTEXTO
- NÃO use os dados internos do sistema
- Liste TODAS as transações, não faça "Top X"
- Organize por categoria e destinatário
- Inclua datas e valores de cada transação
- Seja DETALHADO e COMPLETO
`;

// ============================================
// FUNÇÕES DE CATEGORIZAÇÃO
// ============================================
function categorizarDespesa(desc) {
  const d = (desc || '').toLowerCase();
  if (d.includes('mercado') || d.includes('market') || d.includes('supermercado')) return 'Mercado/Supermercado';
  if (d.includes('posto') || d.includes('combustivel') || d.includes('gasolina')) return 'Combustível';
  if (d.includes('restaurante') || d.includes('lanchonete') || d.includes('pizza') || d.includes('burger') || d.includes('cafe') || d.includes('confeitaria')) return 'Alimentação';
  if (d.includes('drogasil') || d.includes('farmacia') || d.includes('drogaria')) return 'Farmácia';
  if (d.includes('parking') || d.includes('estacionamento')) return 'Estacionamento';
  if (d.includes('taxa') || d.includes('tarifa') || d.includes('mensageria') || d.includes('boleto')) return 'Taxas Bancárias';
  if (d.includes('assessoria alpha') || d.includes('alpha ltda')) return 'Royalties Alpha';
  if (d.includes('starken')) return 'Starken (interno)';
  return 'Transferências/Pagamentos';
}

function processarArquivoImportado(importedFile) {
  if (!importedFile || !importedFile.items) return '';

  const items = importedFile.items || [];
  const porTipo = { receita: [], despesa: [], indefinido: [] };

  items.forEach(item => {
    const tipo = item.tipo || 'indefinido';
    if (porTipo[tipo]) porTipo[tipo].push(item);
  });

  // Agrupar despesas por categoria
  const despesasPorCategoria = {};
  porTipo.despesa.forEach(item => {
    const cat = categorizarDespesa(item.descricao);
    if (!despesasPorCategoria[cat]) despesasPorCategoria[cat] = { total: 0, items: [] };
    despesasPorCategoria[cat].total += item.valor;
    despesasPorCategoria[cat].items.push(item);
  });

  // Agrupar transferências por destinatário
  const transferencias = despesasPorCategoria['Transferências/Pagamentos']?.items || [];
  const porDestinatario = {};
  transferencias.forEach(item => {
    const desc = item.descricao || '';
    const match = desc.match(/para (.+)$/i);
    const dest = match ? match[1].trim() : 'Outros';
    if (!porDestinatario[dest]) porDestinatario[dest] = { total: 0, items: [] };
    porDestinatario[dest].total += item.valor;
    porDestinatario[dest].items.push(item);
  });

  const todasReceitas = porTipo.receita.sort((a, b) => b.valor - a.valor);

  // Formato detalhado
  let context = `
═══════════════════════════════════════════════════════════════
📎 ARQUIVO: ${importedFile.filename}
═══════════════════════════════════════════════════════════════

📊 RESUMO GERAL
• Receitas: R$ ${(importedFile.receitas || 0).toFixed(2)} (${porTipo.receita.length} entradas)
• Despesas: R$ ${(importedFile.despesas || 0).toFixed(2)} (${porTipo.despesa.length} saídas)
• Saldo: R$ ${((importedFile.receitas || 0) - (importedFile.despesas || 0)).toFixed(2)}

═══════════════════════════════════════════════════════════════
🟢 TODAS AS RECEITAS (${todasReceitas.length})
═══════════════════════════════════════════════════════════════
${todasReceitas.map((item, i) =>
  `${i + 1}. ${item.data || 'S/D'} | ${item.descricao || 'N/A'} | R$ ${item.valor.toFixed(2)}`
).join('\n')}

═══════════════════════════════════════════════════════════════
🔴 DESPESAS POR CATEGORIA
═══════════════════════════════════════════════════════════════
`;

  // Adicionar cada categoria
  Object.entries(despesasPorCategoria)
    .filter(([cat]) => cat !== 'Transferências/Pagamentos')
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([cat, data]) => {
      context += `\n📁 ${cat.toUpperCase()}: R$ ${data.total.toFixed(2)} (${data.items.length} transações)\n`;
      data.items.sort((a, b) => b.valor - a.valor).forEach(item => {
        context += `   • ${item.data || 'S/D'} | ${item.descricao?.substring(0, 50) || 'N/A'} | R$ ${item.valor.toFixed(2)}\n`;
      });
    });

  context += `
═══════════════════════════════════════════════════════════════
💳 TRANSFERÊNCIAS/PAGAMENTOS POR DESTINATÁRIO
═══════════════════════════════════════════════════════════════
`;

  // Adicionar cada destinatário
  Object.entries(porDestinatario)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([dest, data]) => {
      context += `\n👤 ${dest}: R$ ${data.total.toFixed(2)} (${data.items.length} pagamentos)\n`;
      data.items.forEach(item => {
        context += `   • ${item.data || 'S/D'} | R$ ${item.valor.toFixed(2)}\n`;
      });
    });

  return context;
}

// ============================================
// ROTA PRINCIPAL DO AGENTE
// ============================================
app.post('/agent', async (req, res) => {
  console.log('=== STARK Agent Request ===');

  try {
    const { message, conversationHistory = [], importedFile } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Mensagem não fornecida' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Processar arquivo importado se houver
    let fileContext = '';
    let systemPrompt = SYSTEM_PROMPT;

    if (importedFile) {
      console.log('Processando arquivo:', importedFile.filename, 'com', importedFile.items?.length, 'transações');
      fileContext = processarArquivoImportado(importedFile);

      systemPrompt += `

## ⚠️ ARQUIVO IMPORTADO ATIVO
O usuário importou um extrato bancário. REGRAS OBRIGATÓRIAS:
1. Use APENAS os dados do CONTEXTO DO ARQUIVO
2. IGNORE os dados internos do sistema
3. NÃO faça "Top 5" ou "Top 10" - liste TODAS as transações
4. Mantenha organização por CATEGORIA e DESTINATÁRIO
5. Inclua DATA e VALOR de cada transação
6. Seja DETALHADO e COMPLETO
`;
    }

    const recentHistory = conversationHistory.slice(-6);
    const userMessage = fileContext
      ? `${message}\n\n---\nDADOS DO ARQUIVO IMPORTADO:${fileContext}`
      : message;

    const messages = [...recentHistory, { role: 'user', content: userMessage }];

    console.log('Enviando para Claude Sonnet...');
    const startTime = Date.now();

    // Usar Sonnet para análises com arquivo (sem limite de timeout no Railway!)
    const model = importedFile ? 'claude-sonnet-4-20250514' : 'claude-3-5-haiku-20241022';

    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages
    });

    const elapsed = Date.now() - startTime;
    console.log(`Resposta recebida em ${elapsed}ms`);

    const textContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.json({
      success: true,
      response: textContent,
      usage: response.usage,
      model,
      elapsed
    });

  } catch (error) {
    console.error('Erro no STARK:', error);
    res.status(500).json({
      error: error.message,
      details: 'Erro ao processar requisição'
    });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'STARK CFO Virtual API',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 STARK API running on port ${PORT}`);
});
