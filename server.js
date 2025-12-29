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
  },
  {
    name: "salvar_memoria",
    description: "Salva uma informação importante na memória persistente. Use para lembrar fatos, preferências do usuário, contextos importantes, ou lembretes.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["fato", "preferencia", "lembrete", "contexto"], description: "Tipo da memória" },
        conteudo: { type: "string", description: "O que deve ser lembrado" },
        relevancia: { type: "number", description: "Importância de 1-10 (10 = muito importante)" },
        mes: { type: "string", description: "Mês relacionado no formato YYYY-MM (opcional)" }
      },
      required: ["tipo", "conteudo"]
    }
  },
  {
    name: "buscar_memorias",
    description: "Busca memórias salvas anteriormente. Use para lembrar contextos, fatos ou preferências do usuário.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["fato", "preferencia", "lembrete", "contexto", "todos"], description: "Filtrar por tipo" },
        mes: { type: "string", description: "Filtrar por mês (opcional)" }
      }
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

      case "salvar_memoria":
        return await salvarMemoria(input);

      case "buscar_memorias":
        return await buscarMemorias(input);

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
// FUNÇÕES DE MEMÓRIA PERSISTENTE
// ============================================
async function salvarMemoria(input) {
  const { tipo, conteudo, relevancia = 5, mes } = input;

  const memoria = await prisma.starkMemory.create({
    data: {
      tipo,
      conteudo,
      relevancia,
      mes
    }
  });

  return {
    success: true,
    message: `Memória salva: "${conteudo.substring(0, 50)}..."`,
    id: memoria.id
  };
}

async function buscarMemorias(input) {
  const { tipo = "todos", mes } = input;

  const where = {};
  if (tipo !== "todos") where.tipo = tipo;
  if (mes) where.mes = mes;

  const memorias = await prisma.starkMemory.findMany({
    where,
    orderBy: [{ relevancia: 'desc' }, { createdAt: 'desc' }],
    take: 20
  });

  return {
    success: true,
    memorias: memorias.map(m => ({
      tipo: m.tipo,
      conteudo: m.conteudo,
      relevancia: m.relevancia,
      mes: m.mes,
      data: m.createdAt.toISOString().split('T')[0]
    })),
    total: memorias.length
  };
}

async function salvarMensagem(role, content, metadata = null) {
  try {
    await prisma.conversationMessage.create({
      data: {
        role,
        content: content.substring(0, 10000), // Limitar tamanho
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    });
  } catch (error) {
    console.error('Erro ao salvar mensagem:', error);
  }
}

async function carregarContexto() {
  // Carregar últimas mensagens
  const mensagens = await prisma.conversationMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  // Carregar memórias importantes
  const memorias = await prisma.starkMemory.findMany({
    where: { relevancia: { gte: 7 } },
    orderBy: { relevancia: 'desc' },
    take: 10
  });

  return { mensagens: mensagens.reverse(), memorias };
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

## REGRA CRÍTICA - EXECUÇÃO IMEDIATA
SEMPRE que o usuário pedir para lançar, criar, categorizar ou processar transações:
1. NÃO PERGUNTE - EXECUTE IMEDIATAMENTE
2. NÃO DIGA "vou fazer" - FAÇA usando as ferramentas
3. CHAME a ferramenta criar_multiplos_itens com TODOS os itens de uma vez
4. Só responda com texto DEPOIS de executar as ferramentas

## QUANDO RECEBER UM EXTRATO PARA LANÇAR
AÇÃO OBRIGATÓRIA: Use criar_multiplos_itens IMEDIATAMENTE com todas as transações.

Estrutura de cada item:
{
  "mes": "2024-11" ou "2024-12" (baseado na data da transação),
  "tipo": "despesa" ou "receita",
  "nome": "descrição da transação",
  "valor": 123.45,
  "categoria": "categoria apropriada",
  "status": "Pago" ou "Recebido",
  "dataPagamento": "2024-11-15" (formato ISO da data do extrato)
}

Categorias para DESPESAS:
- Combustível: postos, gasolina, shell, ipiranga
- Alimentação: restaurantes, supermercados, lanchonetes, mercado
- Transporte: uber, 99, taxi, estacionamento
- Delivery: ifood, rappi, zé delivery
- Aluguel: imobiliárias, proprietários
- Pessoal: salários, pagamentos a pessoas, funcionários, prestadores
- Taxas Bancárias: tarifas, IOF, mensageria, TED, DOC
- Impostos: DAS, INSS, FGTS, IRPF
- Telecom: internet, telefone, celular
- Software: assinaturas, SaaS, Adobe, Microsoft
- Marketing: ads, publicidade, Google Ads
- Saúde: farmácia, médico, plano
- Transferências: PIX enviado, TED enviado

Categorias para RECEITAS:
- Serviços: pagamentos por projetos, consultoria
- Mensalidade: MRR, assinaturas de clientes
- Gateway: Asaas, PagSeguro, Stripe
- PIX Recebido: transferências recebidas
- Empréstimo: dinheiro emprestado recebido
- Rendimentos: juros, aplicações

## REGRAS DE FORMATO
- Receitas = entradas de dinheiro (valor positivo) → tipo: "receita"
- Despesas = saídas de dinheiro (valor negativo no extrato) → tipo: "despesa"
- Mês: extraia da data (11/2024 → "2024-11", 12/2024 → "2024-12")
- Status: use "Pago" para despesas, "Recebido" para receitas
- dataPagamento: converta DD/MM/YYYY para YYYY-MM-DD

## MEMÓRIA PERSISTENTE
Use as ferramentas salvar_memoria e buscar_memorias para lembrar contextos importantes.

## RESPOSTAS
- Seja conciso mas completo
- SEMPRE execute as ações ANTES de responder
- Confirme o que foi feito com números e totais
- Confirme as ações realizadas
- Mostre totais e resumos quando relevante
`;

// ============================================
// FUNÇÃO PARA PROCESSAR ARQUIVO IMPORTADO (OTIMIZADA)
// ============================================
function processarArquivoImportado(importedFile) {
  if (!importedFile || !importedFile.items) return '';

  const items = importedFile.items || [];

  // Separar receitas e despesas
  const receitas = items.filter(i => i.tipo === 'receita' || i.tipo === 'entrada' || (i.valor && i.valor > 0 && i.tipo !== 'despesa'));
  const despesas = items.filter(i => i.tipo === 'despesa' || i.tipo === 'saida' || (i.valor && i.valor < 0) || i.tipo === 'despesa');

  // Calcular totais
  const totalReceitas = receitas.reduce((sum, i) => sum + Math.abs(i.valor || 0), 0);
  const totalDespesas = despesas.reduce((sum, i) => sum + Math.abs(i.valor || 0), 0);

  // Agrupar despesas por categoria/descrição similar
  const despesasAgrupadas = {};
  despesas.forEach(item => {
    const desc = (item.descricao || 'Outros').toLowerCase().trim();
    // Simplificar descrição para agrupar
    let categoria = categorizarTransacao(desc);
    if (!despesasAgrupadas[categoria]) {
      despesasAgrupadas[categoria] = { total: 0, count: 0, itens: [] };
    }
    despesasAgrupadas[categoria].total += Math.abs(item.valor || 0);
    despesasAgrupadas[categoria].count++;
    despesasAgrupadas[categoria].itens.push(item);
  });

  // Agrupar receitas por categoria
  const receitasAgrupadas = {};
  receitas.forEach(item => {
    const desc = (item.descricao || 'Outros').toLowerCase().trim();
    let categoria = categorizarReceita(desc);
    if (!receitasAgrupadas[categoria]) {
      receitasAgrupadas[categoria] = { total: 0, count: 0, itens: [] };
    }
    receitasAgrupadas[categoria].total += Math.abs(item.valor || 0);
    receitasAgrupadas[categoria].count++;
    receitasAgrupadas[categoria].itens.push(item);
  });

  let context = `
═══════════════════════════════════════════════════════════════
📎 ARQUIVOS IMPORTADOS: ${importedFile.filename}
═══════════════════════════════════════════════════════════════

📊 RESUMO GERAL:
• Total de transações: ${items.length}
• Total Receitas: R$ ${totalReceitas.toFixed(2)} (${receitas.length} transações)
• Total Despesas: R$ ${totalDespesas.toFixed(2)} (${despesas.length} transações)
• Saldo: R$ ${(totalReceitas - totalDespesas).toFixed(2)}

💰 RECEITAS POR CATEGORIA:
`;

  // Adicionar receitas agrupadas (ordenadas por valor)
  Object.entries(receitasAgrupadas)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([cat, data]) => {
      context += `• ${cat}: R$ ${data.total.toFixed(2)} (${data.count}x)\n`;
    });

  context += `\n💸 DESPESAS POR CATEGORIA:\n`;

  // Adicionar despesas agrupadas (ordenadas por valor)
  Object.entries(despesasAgrupadas)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([cat, data]) => {
      context += `• ${cat}: R$ ${data.total.toFixed(2)} (${data.count}x)\n`;
    });

  // TOP 30 maiores despesas individuais (para detalhamento)
  context += `\n📋 TOP 30 MAIORES DESPESAS:\n`;
  despesas
    .sort((a, b) => Math.abs(b.valor || 0) - Math.abs(a.valor || 0))
    .slice(0, 30)
    .forEach((item, i) => {
      context += `${i + 1}. ${item.data || 'S/D'} | ${item.descricao || 'N/A'} | R$ ${Math.abs(item.valor || 0).toFixed(2)}\n`;
    });

  // TOP 20 maiores receitas individuais
  context += `\n📋 TOP 20 MAIORES RECEITAS:\n`;
  receitas
    .sort((a, b) => Math.abs(b.valor || 0) - Math.abs(a.valor || 0))
    .slice(0, 20)
    .forEach((item, i) => {
      context += `${i + 1}. ${item.data || 'S/D'} | ${item.descricao || 'N/A'} | R$ ${Math.abs(item.valor || 0).toFixed(2)}\n`;
    });

  // Lista completa compacta (para referência)
  context += `\n📋 LISTA COMPLETA DE DESPESAS (para lançamento):\n`;
  despesas.forEach((item, i) => {
    const cat = categorizarTransacao((item.descricao || '').toLowerCase());
    context += `${item.data}|${item.descricao}|${Math.abs(item.valor).toFixed(2)}|${cat}\n`;
  });

  return context;
}

// Categorizar transação automaticamente
function categorizarTransacao(desc) {
  desc = desc.toLowerCase();
  if (desc.includes('pix') && (desc.includes('enviado') || desc.includes('transf'))) return 'Transferências PIX';
  if (desc.includes('ted') || desc.includes('doc')) return 'Transferências TED/DOC';
  if (desc.includes('combustivel') || desc.includes('posto') || desc.includes('shell') || desc.includes('ipiranga') || desc.includes('br ') || desc.includes('gasolina')) return 'Combustível';
  if (desc.includes('uber') || desc.includes('99') || desc.includes('taxi') || desc.includes('cabify')) return 'Transporte App';
  if (desc.includes('ifood') || desc.includes('rappi') || desc.includes('zé delivery') || desc.includes('aiqfome')) return 'Delivery';
  if (desc.includes('restaurante') || desc.includes('lanchonete') || desc.includes('padaria') || desc.includes('mercado') || desc.includes('supermercado') || desc.includes('alimenta')) return 'Alimentação';
  if (desc.includes('aluguel') || desc.includes('condominio') || desc.includes('iptu')) return 'Moradia';
  if (desc.includes('luz') || desc.includes('energia') || desc.includes('enel') || desc.includes('celesc') || desc.includes('cemig')) return 'Energia';
  if (desc.includes('agua') || desc.includes('saneamento') || desc.includes('copasa') || desc.includes('sabesp')) return 'Água';
  if (desc.includes('internet') || desc.includes('telefone') || desc.includes('celular') || desc.includes('vivo') || desc.includes('claro') || desc.includes('tim') || desc.includes('oi ')) return 'Telecom';
  if (desc.includes('netflix') || desc.includes('spotify') || desc.includes('youtube') || desc.includes('disney') || desc.includes('hbo') || desc.includes('amazon prime') || desc.includes('assinatura')) return 'Assinaturas';
  if (desc.includes('software') || desc.includes('adobe') || desc.includes('microsoft') || desc.includes('google') || desc.includes('chatgpt') || desc.includes('openai') || desc.includes('anthropic')) return 'Software/SaaS';
  if (desc.includes('salario') || desc.includes('folha') || desc.includes('funcionario') || desc.includes('prolabore') || desc.includes('pessoal')) return 'Pessoal/Salários';
  if (desc.includes('imposto') || desc.includes('das') || desc.includes('inss') || desc.includes('fgts') || desc.includes('irpf') || desc.includes('icms') || desc.includes('iss')) return 'Impostos';
  if (desc.includes('tarifa') || desc.includes('taxa') || desc.includes('anuidade') || desc.includes('iof') || desc.includes('bancaria')) return 'Taxas Bancárias';
  if (desc.includes('farmacia') || desc.includes('drogaria') || desc.includes('saude') || desc.includes('medico') || desc.includes('hospital') || desc.includes('clinica') || desc.includes('plano')) return 'Saúde';
  if (desc.includes('material') || desc.includes('papelaria') || desc.includes('escritorio')) return 'Material Escritório';
  if (desc.includes('marketing') || desc.includes('publicidade') || desc.includes('ads') || desc.includes('meta ') || desc.includes('google ads')) return 'Marketing';
  if (desc.includes('contador') || desc.includes('contabil') || desc.includes('juridico') || desc.includes('advogado')) return 'Serviços Profissionais';
  if (desc.includes('saque') || desc.includes('retirada')) return 'Saques';
  return 'Outros';
}

// Categorizar receita automaticamente
function categorizarReceita(desc) {
  desc = desc.toLowerCase();
  if (desc.includes('pix') && desc.includes('recebido')) return 'PIX Recebido';
  if (desc.includes('ted') || desc.includes('doc')) return 'TED/DOC Recebido';
  if (desc.includes('boleto')) return 'Boleto Recebido';
  if (desc.includes('cartao') || desc.includes('card') || desc.includes('visa') || desc.includes('master') || desc.includes('elo')) return 'Cartão de Crédito';
  if (desc.includes('asaas') || desc.includes('pagarme') || desc.includes('stripe') || desc.includes('mercadopago') || desc.includes('pagseguro')) return 'Gateway de Pagamento';
  if (desc.includes('venda') || desc.includes('servico') || desc.includes('projeto') || desc.includes('consultoria')) return 'Serviços/Projetos';
  if (desc.includes('mensalidade') || desc.includes('assinatura') || desc.includes('recorrente')) return 'Mensalidade/MRR';
  if (desc.includes('rendimento') || desc.includes('juros') || desc.includes('aplicacao')) return 'Rendimentos';
  if (desc.includes('reembolso') || desc.includes('estorno') || desc.includes('devolucao')) return 'Reembolso';
  if (desc.includes('emprestimo') || desc.includes('credito')) return 'Empréstimo';
  return 'Outros';
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

    // Carregar contexto persistente (memórias importantes)
    const contexto = await carregarContexto();
    let systemPromptComMemoria = SYSTEM_PROMPT;

    if (contexto.memorias.length > 0) {
      systemPromptComMemoria += `\n\n## MEMÓRIAS IMPORTANTES (do banco de dados)\n`;
      contexto.memorias.forEach(m => {
        systemPromptComMemoria += `- [${m.tipo}] ${m.conteudo}\n`;
      });
    }

    // Processar arquivo importado se houver
    let fileContext = '';
    if (importedFile) {
      console.log('📎 Processando arquivo:', importedFile.filename, 'com', importedFile.items?.length, 'transações');
      fileContext = processarArquivoImportado(importedFile);
    }

    const userMessage = fileContext
      ? `${message}\n\n---\nDADOS DO ARQUIVO IMPORTADO:${fileContext}`
      : message;

    // Salvar mensagem do usuário
    await salvarMensagem('user', message, importedFile ? { arquivo: importedFile.filename } : null);

    const messages = [
      ...conversationHistory.slice(-6),
      { role: 'user', content: userMessage }
    ];

    console.log('🤖 Iniciando conversa com Claude...');
    console.log(`📚 ${contexto.memorias.length} memórias carregadas`);
    const startTime = Date.now();

    // Loop de tool use
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPromptComMemoria,
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

    // Salvar resposta do assistant
    await salvarMensagem('assistant', textContent, { toolsUsed: iterations });

    res.json({
      success: true,
      response: textContent,
      usage: response.usage,
      model: 'claude-sonnet-4-20250514',
      elapsed,
      toolsUsed: iterations,
      memoriasCarregadas: contexto.memorias.length
    });

  } catch (error) {
    console.error('❌ Erro no STARK:', error);

    // Tratamento específico de erros
    if (error.message && error.message.includes('rate_limit')) {
      return res.status(429).json({
        success: false,
        error: 'API temporariamente sobrecarregada. Aguarde alguns segundos e tente novamente.',
        details: 'rate_limit'
      });
    }

    if (error.message && error.message.includes('context_length')) {
      return res.status(400).json({
        success: false,
        error: 'Muitos dados para processar de uma vez. Tente com menos arquivos ou peça para processar um mês de cada vez.',
        details: 'context_length'
      });
    }

    if (error.message && error.message.includes('overloaded')) {
      return res.status(503).json({
        success: false,
        error: 'Servidor temporariamente sobrecarregado. Tente novamente em alguns segundos.',
        details: 'overloaded'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: 'internal_error'
    });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'STARK CFO Virtual API',
    version: '3.0.0',
    features: ['tool-use', 'crud-autonomy', 'prisma-database', 'persistent-memory']
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
