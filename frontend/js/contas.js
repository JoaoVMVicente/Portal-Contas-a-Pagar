/**
 * contas.js — As 213 empresas do grupo e as 1.127 contas bancárias delas.
 * ---------------------------------------------------------------------------
 * Substitui o antigo unidades.js. A mudança não foi de nome: foi de conceito.
 *
 * O QUE MUDOU E POR QUÊ
 * ---------------------
 * A premissa antiga era: "CC é um código de conta que agrupa empresas".
 * Ao abrir o Mapeamento Geral de Contas, a coluna I ("CONTA") mostrou ser a
 * CONTA BANCÁRIA da empresa. E uma empresa tem várias — a maior tem 31.
 *
 * Então a relação é o contrário do que parecia:
 *
 *    ANTES (errado):  1 CC        ->  N empresas
 *    AGORA (certo):   1 empresa   ->  N contas
 *
 * Isso muda o caminho do formulário. O boleto traz o CNPJ da empresa, então
 * identificamos a empresa primeiro e depois a pessoa escolhe entre as contas
 * dela. O caminho inverso (digitou a conta, aparece a empresa) continua
 * funcionando, porque conta quase sempre identifica a empresa sozinha.
 */

let pacote = null;
let carregando = null;

/* ========================================================================== *
 * Carregar
 * ========================================================================== */
export async function carregarContas() {
  if (pacote) return pacote;
  if (carregando) return carregando;

  carregando = (async () => {
    const resposta = await fetch('./data/contas-bancarias.json', { cache: 'no-cache' });
    if (!resposta.ok) {
      throw new Error(
        'Não consegui carregar a lista de empresas e contas. ' +
          'Confira se o arquivo frontend/data/contas-bancarias.json existe ' +
          '(ele é gerado pelo importador em tools/).'
      );
    }
    const dados = await resposta.json();

    // Índice por documento, para achar empresa em tempo constante.
    dados.porDocumento = new Map(dados.empresas.map((e) => [e.documento, e]));

    // Se o arquivo vier sem os índices prontos, reconstruímos.
    if (!dados.indices?.porConta) {
      const porConta = {};
      const porChaveBusca = {};
      for (const e of dados.empresas) {
        porChaveBusca[e.chaveBusca] = e.documento;
        for (const c of e.contas) {
          (porConta[c.conta] ??= []).push(e.documento);
          if (c.contaDigitos && c.contaDigitos !== c.conta) {
            (porConta[c.contaDigitos] ??= []).push(e.documento);
          }
        }
      }
      dados.indices = { porConta, porChaveBusca };
    }

    pacote = dados;
    return dados;
  })();

  try {
    return await carregando;
  } finally {
    carregando = null;
  }
}

const digitos = (v) => String(v ?? '').replace(/\D+/g, '');

/* ========================================================================== *
 * Nomes: acentos e algarismos romanos
 * ========================================================================== */
const ROMANOS = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
  IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15,
  XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20,
};

/**
 * A mesma normalização que o importador usa, para as chaves casarem.
 *
 * Os nomes na planilha usam romanos: "ASSURUÁ 2 IV ENERGIA S.A.". Quem digita
 * escreve "assurua 2 4". Convertendo os dois para a mesma forma, os dois
 * encontram a mesma empresa.
 */
export function chaveDeNome(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\bS[\s.]*A\b\.?/g, ' ')
    .replace(/\bLTDA\b\.?/g, ' ')
    .replace(/\bLLC\b\.?/g, ' ')
    .replace(/\bME\b\.?/g, ' ')
    .replace(/\bEIRELI\b\.?/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (ROMANOS[p] != null ? String(ROMANOS[p]) : p))
    .join(' ')
    .trim();
}

/* ========================================================================== *
 * Consultas
 * ========================================================================== */
/** Todas as empresas, em ordem alfabética. */
export async function listarEmpresas() {
  const p = await carregarContas();
  return p.empresas;
}

/** A empresa de um CNPJ. Aceita com ou sem pontuação. */
export async function empresaPorDocumento(documento) {
  const p = await carregarContas();
  return p.porDocumento.get(digitos(documento)) ?? null;
}

/** Esta é a função que o boleto-campos.js usa para separar nós de eles. */
export async function criarVerificadorDeEmpresa() {
  const p = await carregarContas();
  return (documento) => p.porDocumento.has(digitos(documento));
}

/** As contas ativas de uma empresa. */
export async function contasDaEmpresa(documento) {
  const empresa = await empresaPorDocumento(documento);
  if (!empresa) return [];
  return empresa.contas.filter((c) => c.ativa);
}

/**
 * O caminho inverso: a pessoa sabe o número da conta e quer a empresa.
 * Aceita "37700-7" e "377007".
 */
export async function empresasPorConta(conta) {
  const p = await carregarContas();
  const chave = String(conta ?? '').trim();
  const documentos = p.indices.porConta[chave] ?? p.indices.porConta[digitos(chave)] ?? [];
  return documentos.map((d) => p.porDocumento.get(d)).filter(Boolean);
}

/**
 * Busca por nome ou CNPJ. Devolve no máximo `limite` empresas.
 * Ordena colocando primeiro quem começa com o termo — quem digita "delta"
 * quer "DELTA 1 I" antes de "ALFA DELTA COMERCIO".
 */
export async function buscarEmpresas(termo, limite = 40) {
  const p = await carregarContas();
  const bruto = String(termo ?? '').trim();
  if (bruto.length < 2) return [];

  const soDigitos = digitos(bruto);
  const chave = chaveDeNome(bruto);

  const resultado = [];
  for (const e of p.empresas) {
    let pontos = 0;

    if (soDigitos.length >= 3 && e.documento.includes(soDigitos)) pontos = 100;
    else if (chave && e.chaveBusca === chave) pontos = 95;
    else if (chave && e.chaveBusca.startsWith(chave)) pontos = 80;
    else if (chave && e.chaveBusca.includes(chave)) pontos = 60;
    else if (chave && e.nomesAlternativos.some((n) => chaveDeNome(n).includes(chave))) pontos = 50;

    if (pontos > 0) resultado.push({ empresa: e, pontos });
  }

  return resultado
    .sort((a, b) => b.pontos - a.pontos || a.empresa.razaoSocial.localeCompare(b.empresa.razaoSocial, 'pt-BR'))
    .slice(0, limite)
    .map((r) => r.empresa);
}

/* ========================================================================== *
 * Preencher campos da tela
 * ========================================================================== */
export function formatarDocumento(empresa) {
  if (!empresa) return '';
  if (empresa.documentoTipo === 'ein') return `EIN ${empresa.documento}`;
  return empresa.documentoFormatado ?? empresa.documento;
}

/**
 * O rótulo de uma conta no seletor. Uma empresa com 31 contas precisa disso:
 * só o número não distingue nada.
 *   "37700-7 · BANCO DO BRASIL · ag. 1880-5 · LIVRE"
 */
export function rotuloDaConta(conta) {
  return [conta.conta, conta.banco, conta.agencia ? `ag. ${conta.agencia}` : null, conta.tipoConta]
    .filter(Boolean)
    .join(' · ');
}

/** Preenche um <select> com as contas de uma empresa. */
export function preencherSelectContas(select, contas, contaEscolhida = null) {
  if (!contas.length) {
    select.innerHTML = '<option value="">Esta empresa não tem conta ativa cadastrada</option>';
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML =
    `<option value="">${contas.length === 1 ? 'Confirme a conta' : `Selecione entre as ${contas.length} contas`}</option>` +
    contas
      .map(
        (c) =>
          `<option value="${escaparAtributo(c.conta)}"
                   data-banco="${escaparAtributo(c.banco ?? '')}"
                   data-agencia="${escaparAtributo(c.agencia ?? '')}"
                   data-tipo="${escaparAtributo(c.tipoConta ?? '')}"
                   ${c.conta === contaEscolhida ? 'selected' : ''}>${escaparAtributo(rotuloDaConta(c))}</option>`
      )
      .join('');

  // Uma conta só: já deixamos escolhida, para a pessoa não clicar por nada.
  if (contas.length === 1 && !contaEscolhida) select.value = contas[0].conta;
}

function escaparAtributo(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Os totais, para mostrar na tela ("213 empresas, 1.073 contas ativas"). */
export async function totais() {
  const p = await carregarContas();
  return p.totais;
}
