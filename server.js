const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================
// FERRAMENTAS DO STARK (CRUD COMPLETO)
// ============================================
const TOOLS = [
  {
    name: "criar_despesa",
    description: "Cria uma nova despesa/conta a pagar no sistema. Use para lançar gastos do extrato.",
    input_schema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Mês no formato YYYY-MM (ex: 2025-12)" },
        nome: { type: "string", description: "Nome/descrição da despesa" },
        valor: { type: "number", description: "Valor da despesa" },
        categoria: { type: "string", description: "Categoria (Combustível, Alimentação, Aluguel, Pessoal, etc.)" },
        status: { type: "string", enum: ["Pago", "A Pagar"], description: "Status do pagamento" },
        vencimento: { type: "string", description: "Data de vencimento (DD/MM/YYYY)" },
        dataPagamento: { type: "string", description: "Data do pagamento se já pago (DD/MM/YYYY)" }
      },
      required: ["mes", "nome", "valor", "categoria"]
    }
  },
  {
    name: "criar_receita",
    description: "Cria uma nova receita/conta a receber no sistema. Use para lançar entradas do extrato.",
    input_schema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Mês no formato YYYY-MM (ex: 2025-12)" },
        nome: { type: "string", description: "Nome/descrição da receita" },
        valor: { type: "number", description: "Valor da receita" },
        categoria: { type: "string", description: "Categoria (Serviços, Empréstimo, Rendimentos, etc.)" },
        status: { type: "string", enum: ["Recebido", "A Receber"], description: "Status do recebimento" },
        vencimento: { type: "string", description: "Data de vencimento (DD/MM/YYYY)" },
        dataPagamento: { type: "string", description: "Data do recebimento se já recebido (DD/MM/YYYY)" }
      },
      required: ["mes", "nome", "valor", "categoria"]
    }
  },
  {
    name: "atualizar_status",
    description: "Atualiza o status de um item (despesa ou receita) existente",
    input_schema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Mês no formato YYYY-MM" },
        tipo: { type: "string", enum: ["despesa", "receita"], description: "Tipo do item" },
        itemNome: { type: "string", description: "Nome do item a atualizar" },
        novoStatus: { type: "string", description: "Novo status (Pago, A Pagar, Recebido, A Receber)" },
        dataPagamento: { type: "string", description: "Data do pagamento/recebimento" }
      },
      required: ["mes", "tipo", "itemNome", "novoStatus"]
    }
  },
  {
    name: "editar_item",
    description: "Edita nome, valor ou categoria de um item existente",
    input_schema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Mês no formato YYYY-MM" },
        tipo: { type: "string", enum: ["despesa", "receita"], description: "Tipo do item" },
        itemNome: { type: "string", description: "Nome atual do item" },
        novoNome: { type: "string", description: "Novo nome (opcional)" },
        novoValor: { type: "number", description: "Novo valor (opcional)" },
        novaCategoria: { type: "string", description: "Nova categoria (opcional)" }
      },
      required: ["mes", "tipo", "itemNome"]
    }
  },
  {
    name: "deletar_item",
    description: "Remove um item do sistema",
    input_schema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Mês no formato YYYY-MM" },
        tipo: { type: "string", enum: ["despesa", "receita"], description: "Tipo do item" },
        itemNome: { type: "string", description: "Nome do item a deletar" }
      },
      required: ["mes", "tipo", "itemNome"]
    }
  },
  {
    name: "listar_itens",
    description: "Lista todos os itens de um mês (despesas e/ou receitas) do banco de dados",
    input_schema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Mês no formato YYYY-MM" },
        tipo: { type: "string", enum: ["despesa", "receita", "todos"], description: "Tipo de itens a listar" }
      },
      required: ["mes"]
    }
  },
  {
    name: "resumo_financeiro",
    description: "Gera um resumo financeiro do mês com totais de receitas, despesas e saldo",
    input_schema: {
      type: "object",
      properties: {
        mes: { type: "string", description: "Mês no formato YYYY-MM" }
      },
      required: ["mes"]
    }
  },
  {
    name: "criar_multiplos_itens",
    description: "Cria múltiplos itens de uma vez (despesas ou receitas). Use para lançar várias transações do extrato de forma eficiente.",
    input_schema: {
      type: "object",
      properties: {
        itens: {
          type: "array",
          description: "Array de itens a criar",
          items: {
            type: "object",
            properties: {
              mes: { type: "string" },
              tipo: { type: "string", enum: ["despesa", "receita"] },
              nome: { type: "string" },
              valor: { type: "number" },
              categoria: { type: "string" },
              status: { type: "string" },
              dataPagamento: { type: "string" }
            },
            required: ["mes", "tipo", "nome", "valor", "categoria"]
          }
        }
      },
      required: ["itens"]
    }
  }
];

// ============================================
// EXECUTAR FERRAMENTAS
// ============================================
async function executarFerramenta(nome, input) {
  console.log(`🔧 Executando: ${nome}`, JSON.stringify(input).substring(0, 200));

  try {
    switch (nome) {
      case "criar_despesa":
        return await criarItem({ ...input, tipo: "despesa" });

      case "criar_receita":
        return await criarItem({ ...input, tipo: "receita" });

      case "atualizar_status":
        return await atualizarStatus(input);

      case "editar_item":
        return await editarItem(input);

      case "deletar_item":
        return await deletarItem(input);

      case "listar_itens":
        return await listarItens(input);

      case "resumo_financeiro":
        return await resumoFinanceiro(input);

      case "criar_multiplos_itens":
        return await criarMultiplosItens(input);

      default:
        return { success: false, error: `Ferramenta desconhecida: ${nome}` };
    }
  } catch (error) {
    console.error(`Erro em ${nome}:`, error);
    return { success: false, error: error.message };
  }
}

// ============================================
// FUNÇÕES CRUD
// ============================================
async function criarItem(input) {
  const { mes, tipo, nome, valor, categoria, status, vencimento, dataPagamento } = input;

  const item = await prisma.customItem.create({
    data: {
      mes,
      tipo,
      nome,
      valor,
      categoria,
      status: status || (tipo === "despesa" ? "A Pagar" : "A Receber"),
      vencimento,
      dataPagamento
    }
  });

  return {
    success: true,
    message: `${tipo === "despesa" ? "Despesa" : "Receita"} criada: ${nome} - R$ ${valor.toFixed(2)}`,
    item
  };
}

async function criarMultiplosItens(input) {
  const { itens } = input;
  const resultados = [];

  for (const item of itens) {
    try {
      const created = await prisma.customItem.create({
        data: {
          mes: item.mes,
          tipo: item.tipo,
          nome: item.nome,
          valor: item.valor,
          categoria: item.categoria,
          status: item.status || (item.tipo === "despesa" ? "Pago" : "Recebido"),
          dataPagamento: item.dataPagamento
        }
      });
      resultados.push({ success: true, nome: item.nome, valor: item.valor });
    } catch (error) {
      resultados.push({ success: false, nome: item.nome, error: error.message });
    }
  }

  const sucessos = resultados.filter(r => r.success).length;
  return {
    success: true,
    message: `${sucessos}/${itens.length} itens criados com sucesso`,
    resultados
  };
}

async function atualizarStatus(input) {
  const { mes, tipo, itemNome, novoStatus, dataPagamento } = input;

  // Tentar atualizar CustomItem primeiro
  const customItem = await prisma.customItem.findFirst({
    where: { mes, tipo, nome: itemNome }
  });

  if (customItem) {
    await prisma.customItem.update({
      where: { id: customItem.id },
      data: { status: novoStatus, dataPagamento }
    });
    return { success: true, message: `Status atualizado: ${itemNome} -> ${novoStatus}` };
  }

  // Se não for CustomItem, criar/atualizar PaymentStatus
  await prisma.paymentStatus.upsert({
    where: { mes_tipo_itemNome: { mes, tipo, itemNome } },
    create: { mes, tipo, itemNome, status: novoStatus, dataPagamento },
    update: { status: novoStatus, dataPagamento }
  });

  return { success: true, message: `Status atualizado: ${itemNome} -> ${novoStatus}` };
}

async function editarItem(input) {
  const { mes, tipo, itemNome, novoNome, novoValor, novaCategoria } = input;

  // Tentar editar CustomItem primeiro
  const customItem = await prisma.customItem.findFirst({
    where: { mes, tipo, nome: itemNome }
  });

  if (customItem) {
    await prisma.customItem.update({
      where: { id: customItem.id },
      data: {
        nome: novoNome || customItem.nome,
        valor: novoValor ?? customItem.valor,
        categoria: novaCategoria || customItem.categoria
      }
    });
    return { success: true, message: `Item editado: ${itemNome}` };
  }

  // Se não for CustomItem, criar EditedItem
  await prisma.editedItem.upsert({
    where: { mes_tipo_itemNome: { mes, tipo, itemNome } },
    create: { mes, tipo, itemNome, novoNome, novoValor, novaCategoria },
    update: { novoNome, novoValor, novaCategoria }
  });

  return { success: true, message: `Item editado: ${itemNome}` };
}

async function deletarItem(input) {
  const { mes, tipo, itemNome } = input;

  // Tentar deletar CustomItem primeiro
  const customItem = await prisma.customItem.findFirst({
    where: { mes, tipo, nome: itemNome }
  });

  if (customItem) {
    await prisma.customItem.delete({ where: { id: customItem.id } });
    return { success: true, message: `Item deletado: ${itemNome}` };
  }

  // Se não for CustomItem, criar DeletedItem para esconder do dados-mensais
  await prisma.deletedItem.upsert({
    where: { mes_tipo_itemNome: { mes, tipo, itemNome } },
    create: { mes, tipo, itemNome },
    update: {}
  });

  return { success: true, message: `Item marcado como deletado: ${itemNome}` };
}

async function listarItens(input) {
  const { mes, tipo = "todos" } = input;

  const where = { mes };
  if (tipo !== "todos") where.tipo = tipo;

  const customItems = await prisma.customItem.findMany({ where, orderBy: { valor: 'desc' } });
  const paymentStatuses = await prisma.paymentStatus.findMany({ where: { mes } });

  const despesas = customItems.filter(i => i.tipo === "despesa");
  const receitas = customItems.filter(i => i.tipo === "receita");

  const totalDespesas = despesas.reduce((sum, i) => sum + i.valor, 0);
  const totalReceitas = receitas.reduce((sum, i) => sum + i.valor, 0);

  return {
    success: true,
    mes,
    despesas: despesas.map(d => ({ nome: d.nome, valor: d.valor, categoria: d.categoria, status: d.status })),
    receitas: receitas.map(r => ({ nome: r.nome, valor: r.valor, categoria: r.categoria, status: r.status })),
    totais: {
      despesas: totalDespesas,
      receitas: totalReceitas,
      saldo: totalReceitas - totalDespesas
    }
  };
}

async function resumoFinanceiro(input) {
  const { mes } = input;

  const customItems = await prisma.customItem.findMany({ where: { mes } });

  const despesas = customItems.filter(i => i.tipo === "despesa");
  const receitas = customItems.filter(i => i.tipo === "receita");

  // Agrupar por categoria
  const despesasPorCategoria = {};
  despesas.forEach(d => {
    if (!despesasPorCategoria[d.categoria]) despesasPorCategoria[d.categoria] = 0;
    despesasPorCategoria[d.categoria] += d.valor;
  });

  const receitasPorCategoria = {};
  receitas.forEach(r => {
    if (!receitasPorCategoria[r.categoria]) receitasPorCategoria[r.categoria] = 0;
    receitasPorCategoria[r.categoria] += r.valor;
  });

  const totalDespesas = despesas.reduce((sum, i) => sum + i.valor, 0);
  const totalReceitas = receitas.reduce((sum, i) => sum + i.valor, 0);

  return {
    success: true,
    mes,
    resumo: {
      totalReceitas,
      totalDespesas,
      saldo: totalReceitas - totalDespesas,
      margem: totalReceitas > 0 ? ((totalReceitas - totalDespesas) / totalReceitas * 100).toFixed(1) : 0
    },
    despesasPorCategoria,
    receitasPorCategoria,
    quantidades: {
      despesas: despesas.length,
      receitas: receitas.length
    }
  };
}

// ============================================
// SYSTEM PROMPT
// ============================================
const SYSTEM_PROMPT = `Você é o STARK, o CFO Virtual da Starken Tecnologia.

## SUA PERSONALIDADE
Fale de forma direta, prática, sem enrolação. Tom informal mas profissional.

## SUAS CAPACIDADES
Você tem AUTONOMIA TOTAL no sistema financeiro. Pode:
- CRIAR despesas e receitas
- EDITAR itens existentes
- DELETAR itens
- ATUALIZAR status de pagamentos
- LISTAR e consultar dados
- GERAR resumos financeiros

## QUANDO RECEBER UM EXTRATO PARA LANÇAR
1. Analise TODAS as transações do arquivo
2. Use a ferramenta "criar_multiplos_itens" para lançar tudo de uma vez
3. Categorize corretamente cada transação:
   - Combustível: postos, gasolina
   - Alimentação: restaurantes, supermercados, lanchonetes
   - Aluguel: imobiliárias, proprietários
   - Pessoal: pagamentos a pessoas (funcionários, prestadores)
   - Taxas Bancárias: tarifas, IOF, mensageria
   - Empréstimos: dinheiro emprestado recebido
   - Serviços: pagamentos por serviços prestados
   - Regularização: Serasa, débitos, acordos
   - Educação: cursos, treinamentos
4. Após lançar, confirme com resumo do que foi criado

## REGRAS IMPORTANTES
- Receitas = entradas de dinheiro (tipo: "receita")
- Despesas = saídas de dinheiro (tipo: "despesa")
- Use o mês correto no formato YYYY-MM
- Para extratos, marque como "Pago" ou "Recebido" (já aconteceu)
- Inclua a data do pagamento/recebimento quando disponível

## RESPOSTAS
- Seja conciso mas completo
- Confirme as ações realizadas
- Mostre totais e resumos quando relevante
`;

// ============================================
// FUNÇÃO PARA PROCESSAR ARQUIVO IMPORTADO
// ============================================
function processarArquivoImportado(importedFile) {
  if (!importedFile || !importedFile.items) return '';

  const items = importedFile.items || [];

  let context = `
═══════════════════════════════════════════════════════════════
📎 ARQUIVO IMPORTADO: ${importedFile.filename}
═══════════════════════════════════════════════════════════════

📊 RESUMO:
• Total de transações: ${items.length}
• Receitas: R$ ${(importedFile.receitas || 0).toFixed(2)}
• Despesas: R$ ${(importedFile.despesas || 0).toFixed(2)}
• Saldo: R$ ${((importedFile.receitas || 0) - (importedFile.despesas || 0)).toFixed(2)}

📋 TODAS AS TRANSAÇÕES:
`;

  items.forEach((item, i) => {
    context += `${i + 1}. [${item.tipo?.toUpperCase() || 'N/A'}] ${item.data || 'S/D'} | ${item.descricao || 'N/A'} | R$ ${item.valor?.toFixed(2) || '0.00'}\n`;
  });

  return context;
}

// ============================================
// ROTA PRINCIPAL DO AGENTE (COM TOOL USE)
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
    if (importedFile) {
      console.log('📎 Processando arquivo:', importedFile.filename, 'com', importedFile.items?.length, 'transações');
      fileContext = processarArquivoImportado(importedFile);
    }

    const userMessage = fileContext
      ? `${message}\n\n---\nDADOS DO ARQUIVO IMPORTADO:${fileContext}`
      : message;

    const messages = [
      ...conversationHistory.slice(-6),
      { role: 'user', content: userMessage }
    ];

    console.log('🤖 Iniciando conversa com Claude...');
    const startTime = Date.now();

    // Loop de tool use
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages
    });

    let toolResults = [];
    let iterations = 0;
    const maxIterations = 10;

    // Enquanto Claude quiser usar ferramentas
    while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
      iterations++;
      console.log(`🔄 Iteração ${iterations} - Processando tool calls...`);

      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

      for (const toolUse of toolUseBlocks) {
        console.log(`  🔧 Tool: ${toolUse.name}`);
        const result = await executarFerramenta(toolUse.name, toolUse.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // Continuar a conversa com os resultados das ferramentas
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      toolResults = [];

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages
      });
    }

    const elapsed = Date.now() - startTime;
    console.log(`✅ Resposta final em ${elapsed}ms (${iterations} iterações de tools)`);

    // Extrair texto da resposta final
    const textContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.json({
      success: true,
      response: textContent,
      usage: response.usage,
      model: 'claude-sonnet-4-20250514',
      elapsed,
      toolsUsed: iterations
    });

  } catch (error) {
    console.error('❌ Erro no STARK:', error);
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
    version: '2.0.0',
    features: ['tool-use', 'crud-autonomy', 'prisma-database']
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', database: 'connected' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 STARK API v2.0 running on port ${PORT}`);
  console.log('🔧 Tools disponíveis:', TOOLS.map(t => t.name).join(', '));
});
