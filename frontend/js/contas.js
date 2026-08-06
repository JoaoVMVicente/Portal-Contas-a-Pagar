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

    // ---------------------------------------------------------------------
    // Índice por RAIZ do CNPJ (os 8 primeiros dígitos).
    // ---------------------------------------------------------------------
    // Isto conserta um problema que só apareceu com um boleto real. Um CNPJ
    // tem três partes:
    //
    //     30.866.542 / 0002 - 93
    //     └── raiz ──┘  └filial┘ └DV┘
    //
    // A raiz identifica a EMPRESA. A filial identifica a UNIDADE dela.
    //
    // A planilha cadastra quase tudo como matriz (0001), mas o fornecedor
    // emite o boleto contra a filial que recebeu o material — 0002, 0003...
    // Comparando os 14 dígitos, a mesma empresa parecia ser outra, e o
    // sistema concluía que não era do grupo.
    //
    // Casar por raiz resolve. E é seguro: conferi que, nesta planilha, cada
    // raiz aponta para uma empresa só (a única raiz repetida tem a mesma
    // razão social duas vezes, ou seja, é a mesma empresa mesmo).
    // ---------------------------------------------------------------------
    dados.porRaiz = new Map();
    for (const e of dados.empresas) {
      if (e.documentoTipo !== 'cnpj' || e.documento.length !== 14) continue;
      const raiz = e.documento.slice(0, 8);
      if (!dados.porRaiz.has(raiz)) dados.porRaiz.set(raiz, []);
      dados.porRaiz.get(raiz).push(e);
    }
    // Dentro de cada raiz, a matriz (0001) vem primeiro: é a que a planilha
    // cadastra e a que faz mais sentido oferecer.
    for (const lista of dados.porRaiz.values()) {
      lista.sort((a, b) => a.documento.slice(8, 12).localeCompare(b.documento.slice(8, 12)));
    }

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

    if (!dados.porRaiz) dados.porRaiz = new Map();

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

/**
 * A empresa de um CNPJ. Aceita com ou sem pontuação.
 *
 * Tenta primeiro o CNPJ inteiro. Se não achar, tenta pela RAIZ — porque o
 * boleto costuma vir contra uma filial que não está cadastrada, e a matriz
 * está. Ver o comentário do índice porRaiz, acima.
 */
export async function empresaPorDocumento(documento) {
  const achado = await acharEmpresa(documento);
  return achado?.empresa ?? null;
}

/**
 * Como empresaPorDocumento, mas dizendo COMO achou. A tela usa isso para
 * avisar que o boleto é de uma filial e a conta cadastrada é da matriz.
 *
 * @returns {{empresa:object, porRaiz:boolean, filialDoBoleto:string|null}|null}
 */
export async function acharEmpresa(documento) {
  const p = await carregarContas();
  const d = digitos(documento);

  const exata = p.porDocumento.get(d);
  if (exata) return { empresa: exata, porRaiz: false, filialDoBoleto: null };

  if (d.length === 14) {
    const mesmaRaiz = p.porRaiz.get(d.slice(0, 8));
    if (mesmaRaiz?.length) {
      return {
        empresa: mesmaRaiz[0],
        porRaiz: true,
        filialDoBoleto: d.slice(8, 12),
      };
    }
  }
  return null;
}

/**
 * Esta é a função que o boleto-campos.js usa para separar nós de eles.
 * Responde "este documento é de uma empresa do grupo?" — considerando a raiz.
 */
export async function criarVerificadorDeEmpresa() {
  const p = await carregarContas();
  return (documento) => {
    const d = digitos(documento);
    if (p.porDocumento.has(d)) return true;
    if (d.length === 14 && p.porRaiz.has(d.slice(0, 8))) return true;
    return false;
  };
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
    let achouPor = null;
    let nomeQueCasou = null;

    if (soDigitos.length >= 3 && e.documento.includes(soDigitos)) {
      pontos = 100;
      achouPor = 'documento';
    } else if (chave && e.chaveBusca === chave) {
      pontos = 95;
      achouPor = 'nome atual';
    } else if (chave && e.chaveBusca.startsWith(chave)) {
      pontos = 80;
      achouPor = 'nome atual';
    } else if (chave && e.chaveBusca.includes(chave)) {
      pontos = 60;
      achouPor = 'nome atual';
    } else if (chave && e.razaoSocialJuridica && chaveDeNome(e.razaoSocialJuridica).includes(chave)) {
      pontos = 55;
      achouPor = 'nome jurídico';
      nomeQueCasou = e.razaoSocialJuridica;
    } else if (chave) {
      // O nome ANTERIOR. Boleto emitido antes da renomeação chega assim, e sem
      // isto o operador teria que consultar uma planilha à parte.
      const anterior = e.nomesAlternativos.find((n) => chaveDeNome(n).includes(chave));
      if (anterior) {
        pontos = 50;
        achouPor = 'nome anterior';
        nomeQueCasou = anterior;
      }
    }

    if (pontos > 0) resultado.push({ empresa: e, pontos, achouPor, nomeQueCasou });
  }

  return resultado
    .sort((a, b) => b.pontos - a.pontos || a.empresa.razaoSocial.localeCompare(b.empresa.razaoSocial, 'pt-BR'))
    .slice(0, limite)
    // Devolvemos a empresa com duas marcas a mais, para a tela poder dizer
    // "encontrada pelo nome anterior: Porto do Parnaíba Energia S.A."
    .map((r) => ({ ...r.empresa, achouPor: r.achouPor, nomeQueCasou: r.nomeQueCasou }));
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
