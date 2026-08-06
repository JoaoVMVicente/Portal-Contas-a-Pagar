#!/usr/bin/env node
/**
 * excel-para-json.mjs — Transforma o "Mapeamento Geral de Contas" nos dados
 * que o portal usa.
 *
 * ===========================================================================
 * O QUE ESTE ARQUIVO ENTENDE DA SUA PLANILHA
 * ===========================================================================
 * Aba padrão: BASE GERAL. As colunas que importam:
 *
 *   A  GRUPO ECONOMICO   agrupador (SG, SD, VDB, US, CONS, ARCO...)
 *   B  CÓDIGO            código interno da empresa
 *   C  EMPRESA           razão social            <- pedido
 *   D  CNPJ              o documento da empresa  <- pedido
 *   E  BANCO             nome do banco
 *   F  CÓD. BANCO        número do banco
 *   H  AGÊNCIA           agência
 *   I  CONTA             a conta bancária        <- pedido ("CC")
 *   J  TIPO DE CONTA     LIVRE, VINCULADA, CONTA ENCERRADA...
 *
 * Uma empresa tem MUITAS contas (há uma com 31). Então o desenho dos dados é:
 *
 *   empresa (1 CNPJ)  ->  várias contas bancárias
 *
 * Contas marcadas como ENCERRADA entram no arquivo, mas com `ativa: false`,
 * e não aparecem para escolher no formulário. Elas ficam para o histórico
 * continuar legível.
 *
 * ===========================================================================
 * ALGARISMOS ROMANOS
 * ===========================================================================
 * Os nomes usam romanos: "ASSURUÁ 2 IV ENERGIA S.A.", "DELTA 7 I". Quem
 * digita quase sempre escreve "delta 7 1". Então guardamos, junto de cada
 * empresa, uma chave de busca em que os romanos soltos viram números árabes,
 * os acentos saem e o "S.A." é descartado. Assim "delta 7 1", "DELTA 7 I" e
 * "Delta 7 I S.A." caem todos no mesmo lugar.
 *
 * ===========================================================================
 * USO
 * ===========================================================================
 *   node excel-para-json.mjs --arquivo <caminho.xlsx> --inspecionar
 *   node excel-para-json.mjs --arquivo <caminho.xlsx>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

/* ========================================================================== *
 * Argumentos da linha de comando
 * ========================================================================== */
function lerArgumentos(argv) {
  const op = {
    arquivo: null,
    aba: 'BASE GERAL',
    linhaCabecalho: null,
    colEmpresa: 'EMPRESA',
    colCnpj: 'CNPJ',
    colConta: 'CONTA',
    colBanco: 'BANCO',
    colCodBanco: 'CÓD. BANCO',
    colAgencia: 'AGÊNCIA',
    colTipo: 'TIPO DE CONTA',
    colGrupo: 'GRUPO ECONOMICO',
    colCodigo: 'CÓDIGO',
    arquivoRazoes: null,
    abaRazoes: 'Razão status',
    colCnpjRazoes: 'CNPJ',
    colJuridica: 'Razão Social Jurídico',
    colAntiga: 'Denominação Antiga',
    saidaJson: path.join(RAIZ, 'frontend/data/contas-bancarias.json'),
    saidaSql: path.join(RAIZ, 'db/07_seed_contas.sql'),
    inspecionar: false,
    incluirEncerradas: true,
    silencioso: false,
  };

  const mapa = {
    '--arquivo': 'arquivo',
    '--aba': 'aba',
    '--linha-cabecalho': 'linhaCabecalho',
    '--col-empresa': 'colEmpresa',
    '--col-cnpj': 'colCnpj',
    '--col-conta': 'colConta',
    '--col-banco': 'colBanco',
    '--col-cod-banco': 'colCodBanco',
    '--col-agencia': 'colAgencia',
    '--col-tipo': 'colTipo',
    '--col-grupo': 'colGrupo',
    '--col-codigo': 'colCodigo',
    '--arquivo-razoes': 'arquivoRazoes',
    '--aba-razoes': 'abaRazoes',
    '--col-juridica': 'colJuridica',
    '--col-antiga': 'colAntiga',
    '--saida-json': 'saidaJson',
    '--saida-sql': 'saidaSql',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--inspecionar') op.inspecionar = true;
    else if (a === '--sem-encerradas') op.incluirEncerradas = false;
    else if (a === '--silencioso') op.silencioso = true;
    else if (mapa[a]) op[mapa[a]] = argv[++i];
    else if (a === '--ajuda' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }

  if (op.linhaCabecalho) op.linhaCabecalho = Number(op.linhaCabecalho);
  return op;
}

/* ========================================================================== *
 * Texto: acentos, romanos, chaves de busca
 * ========================================================================== */
const ROMANOS = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
  IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15,
  XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20,
};

/** Tira acento e deixa maiúsculo. */
export function semAcento(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * A chave que usamos para procurar empresa por nome.
 * "ASSURUÁ 2 IV ENERGIA S.A." -> "ASSURUA 2 4 ENERGIA"
 * "assurua 2 4"               -> "ASSURUA 2 4"
 */
export function chaveDeNome(texto) {
  const bruto = semAcento(texto)
    .replace(/\bS[\s.]*A\b\.?/g, ' ')
    .replace(/\bLTDA\b\.?/g, ' ')
    .replace(/\bLLC\b\.?/g, ' ')
    .replace(/\bME\b\.?/g, ' ')
    .replace(/\bEIRELI\b\.?/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ');

  return bruto
    .split(/\s+/)
    .filter(Boolean)
    .map((palavra) => (ROMANOS[palavra] != null ? String(ROMANOS[palavra]) : palavra))
    .join(' ')
    .trim();
}

const digitos = (v) => String(v ?? '').replace(/\D+/g, '');

/* ========================================================================== *
 * CNPJ
 * ========================================================================== */
export function cnpjValido(entrada) {
  const c = digitos(entrada);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const conferir = (tamanho) => {
    const pesos =
      tamanho === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(c[i]) * pesos[i];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    return Number(c[tamanho]) === dv;
  };
  return conferir(12) && conferir(13);
}

export function formatarCnpj(entrada) {
  const c = digitos(entrada);
  if (c.length !== 14) return String(entrada ?? '');
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/* ========================================================================== *
 * Planilha
 * ========================================================================== */
function abrirPlanilha(caminho) {
  if (!caminho) {
    console.error('Falta dizer o arquivo. Use --arquivo <caminho.xlsx>');
    process.exit(1);
  }
  const absoluto = path.resolve(process.cwd(), caminho);
  if (!fs.existsSync(absoluto)) {
    console.error(`Não achei o arquivo: ${absoluto}`);
    process.exit(1);
  }
  // A build ESM do SheetJS não tem readFile — lemos o buffer na mão.
  return XLSX.read(fs.readFileSync(absoluto), { cellDates: false, cellText: false });
}

/** Devolve a planilha como matriz de células (linhas x colunas). */
function comoMatriz(aba) {
  return XLSX.utils.sheet_to_json(aba, { header: 1, blankrows: false, defval: null, raw: false });
}

/**
 * Acha a linha do cabeçalho procurando a linha que contém mais das palavras
 * que esperamos. Cabeçalho raramente está na linha 1 em planilha corporativa.
 */
function acharCabecalho(matriz, pistas) {
  const alvo = pistas.map((p) => chaveDeNome(p));
  let melhor = { linha: 0, pontos: -1 };
  const limite = Math.min(matriz.length, 30);

  for (let i = 0; i < limite; i += 1) {
    const celulas = (matriz[i] ?? []).map((c) => chaveDeNome(c));
    const pontos = alvo.filter((a) => celulas.some((c) => c && c === a)).length;
    if (pontos > melhor.pontos) melhor = { linha: i, pontos };
  }
  return melhor;
}

/** Acha o índice de uma coluna pelo nome, tolerando acento e pontuação. */
function acharColuna(cabecalho, nomeProcurado) {
  const alvo = chaveDeNome(nomeProcurado);
  const exato = cabecalho.findIndex((c) => chaveDeNome(c) === alvo);
  if (exato >= 0) return exato;
  return cabecalho.findIndex((c) => chaveDeNome(c).includes(alvo));
}

const LETRA = (i) => {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/* ========================================================================== *
 * Inspecionar
 * ========================================================================== */
function inspecionar(livro, op) {
  console.log('\nAbas encontradas:');
  livro.SheetNames.forEach((n, i) =>
    console.log(`  ${i + 1}. ${n}${n === op.aba ? '   <- vou usar esta' : ''}`)
  );

  const nomeAba = livro.SheetNames.includes(op.aba) ? op.aba : livro.SheetNames[0];
  const matriz = comoMatriz(livro.Sheets[nomeAba]);

  const pistas = [op.colEmpresa, op.colCnpj, op.colConta, op.colBanco, op.colTipo];
  const achado = acharCabecalho(matriz, pistas);
  const linhaCab = op.linhaCabecalho != null ? op.linhaCabecalho - 1 : achado.linha;
  const cabecalho = matriz[linhaCab] ?? [];

  console.log(`\n--- Aba: ${nomeAba} ---`);
  console.log(`Linhas no total: ${matriz.length}`);
  console.log(`Cabeçalho parece estar na linha ${linhaCab + 1} (${achado.pontos} colunas reconhecidas)`);
  console.log('\nColunas:');
  cabecalho.forEach((c, i) => {
    if (c != null && String(c).trim()) console.log(`  ${LETRA(i)} = ${String(c).trim()}`);
  });

  const alvos = {
    'EMPRESA (razão social)': op.colEmpresa,
    CNPJ: op.colCnpj,
    'CONTA (o CC)': op.colConta,
    BANCO: op.colBanco,
    'AGÊNCIA': op.colAgencia,
    'TIPO DE CONTA': op.colTipo,
  };
  console.log('\nO que eu vou usar:');
  for (const [rotulo, nome] of Object.entries(alvos)) {
    const i = acharColuna(cabecalho, nome);
    console.log(
      `  ${rotulo.padEnd(24)} -> ${i >= 0 ? `coluna ${LETRA(i)} (${String(cabecalho[i]).trim()})` : 'NÃO ENCONTRADA'}`
    );
  }

  console.log('\nPrimeiras linhas de dados:');
  for (let i = linhaCab + 1; i < Math.min(linhaCab + 6, matriz.length); i += 1) {
    const l = matriz[i] ?? [];
    const pega = (nome) => {
      const j = acharColuna(cabecalho, nome);
      return j >= 0 ? String(l[j] ?? '').trim() : '';
    };
    console.log(
      `  ${pega(op.colConta).padEnd(14)} | ${pega(op.colBanco).slice(0, 16).padEnd(16)} | ${pega(op.colEmpresa).slice(0, 38)}`
    );
  }
  console.log('\n(nada foi alterado — este foi só o modo --inspecionar)\n');
}

/* ========================================================================== *
 * Importar
 * ========================================================================== */
function importar(livro, op) {
  const nomeAba = livro.SheetNames.includes(op.aba) ? op.aba : livro.SheetNames[0];
  if (nomeAba !== op.aba) {
    console.warn(`Aviso: não achei a aba "${op.aba}". Usando "${nomeAba}".`);
  }

  const matriz = comoMatriz(livro.Sheets[nomeAba]);
  const pistas = [op.colEmpresa, op.colCnpj, op.colConta, op.colBanco, op.colTipo];
  const linhaCab =
    op.linhaCabecalho != null ? op.linhaCabecalho - 1 : acharCabecalho(matriz, pistas).linha;
  const cabecalho = matriz[linhaCab] ?? [];

  const idx = {
    empresa: acharColuna(cabecalho, op.colEmpresa),
    cnpj: acharColuna(cabecalho, op.colCnpj),
    conta: acharColuna(cabecalho, op.colConta),
    banco: acharColuna(cabecalho, op.colBanco),
    codBanco: acharColuna(cabecalho, op.colCodBanco),
    agencia: acharColuna(cabecalho, op.colAgencia),
    tipo: acharColuna(cabecalho, op.colTipo),
    grupo: acharColuna(cabecalho, op.colGrupo),
    codigo: acharColuna(cabecalho, op.colCodigo),
  };

  for (const obrigatoria of ['empresa', 'cnpj', 'conta']) {
    if (idx[obrigatoria] < 0) {
      console.error(
        `Não achei a coluna de ${obrigatoria}. Rode com --inspecionar para ver os nomes das ` +
          `colunas e informe na mão, por exemplo: --col-${obrigatoria} "NOME EXATO".`
      );
      process.exit(1);
    }
  }

  const empresasPorCnpj = new Map();
  const problemas = [];
  const contasVistas = new Map();
  let linhasLidas = 0;
  let contasImportadas = 0;

  for (let i = linhaCab + 1; i < matriz.length; i += 1) {
    const linha = matriz[i] ?? [];
    const numeroLinha = i + 1;
    const pega = (j) => (j >= 0 ? String(linha[j] ?? '').trim() : '');

    const nomeEmpresa = pega(idx.empresa);
    const cnpjBruto = pega(idx.cnpj);
    const conta = pega(idx.conta);

    if (!nomeEmpresa && !cnpjBruto && !conta) continue;
    linhasLidas += 1;

    if (!nomeEmpresa) {
      problemas.push({ linha: numeroLinha, motivo: 'sem nome de empresa' });
      continue;
    }
    if (!conta) {
      problemas.push({ linha: numeroLinha, motivo: `sem conta (empresa ${nomeEmpresa})` });
      continue;
    }
    if (!cnpjBruto) {
      problemas.push({ linha: numeroLinha, motivo: `sem CNPJ (empresa ${nomeEmpresa})` });
      continue;
    }

    const cnpjDigitos = digitos(cnpjBruto);

    // Empresas dos EUA têm EIN de 9 dígitos, não CNPJ. Aceitamos, marcando.
    let tipoDocumento = 'cnpj';
    let documentoOk = cnpjValido(cnpjDigitos);

    if (!documentoOk && cnpjDigitos.length === 9) {
      tipoDocumento = 'ein';
      documentoOk = true;
    } else if (!documentoOk) {
      problemas.push({
        linha: numeroLinha,
        motivo: `documento não passa na verificação (empresa ${nomeEmpresa}, ${cnpjDigitos.length} dígitos)`,
      });
      continue;
    }

    const tipoConta = pega(idx.tipo);
    const encerrada = /ENCERRAD/.test(semAcento(tipoConta));
    if (encerrada && !op.incluirEncerradas) continue;

    if (!empresasPorCnpj.has(cnpjDigitos)) {
      empresasPorCnpj.set(cnpjDigitos, {
        documento: cnpjDigitos,
        documentoTipo: tipoDocumento,
        documentoFormatado: tipoDocumento === 'cnpj' ? formatarCnpj(cnpjDigitos) : cnpjDigitos,
        razaoSocial: nomeEmpresa,
        nomesAlternativos: [],
        chaveBusca: chaveDeNome(nomeEmpresa),
        grupo: pega(idx.grupo) || null,
        codigo: pega(idx.codigo) || null,
        contas: [],
      });
    }

    const empresa = empresasPorCnpj.get(cnpjDigitos);

    // Nome diferente para o mesmo CNPJ = a empresa foi renomeada. Guardamos os
    // dois: o mais longo vira o principal, o outro fica como apelido de busca.
    if (nomeEmpresa !== empresa.razaoSocial && !empresa.nomesAlternativos.includes(nomeEmpresa)) {
      if (nomeEmpresa.length > empresa.razaoSocial.length) {
        empresa.nomesAlternativos.push(empresa.razaoSocial);
        empresa.razaoSocial = nomeEmpresa;
        empresa.chaveBusca = chaveDeNome(nomeEmpresa);
      } else {
        empresa.nomesAlternativos.push(nomeEmpresa);
      }
    }

    if (empresa.contas.some((c) => c.conta === conta)) continue;

    if (!contasVistas.has(conta)) contasVistas.set(conta, new Set());
    contasVistas.get(conta).add(cnpjDigitos);

    empresa.contas.push({
      conta,
      contaDigitos: digitos(conta),
      banco: pega(idx.banco) || null,
      codBanco: pega(idx.codBanco) ? digitos(pega(idx.codBanco)).padStart(3, '0') : null,
      agencia: pega(idx.agencia) || null,
      tipoConta: tipoConta || null,
      ativa: !encerrada,
    });
    contasImportadas += 1;
  }

  const contasAmbiguas = [...contasVistas.entries()]
    .filter(([, cnpjs]) => cnpjs.size > 1)
    .map(([conta, cnpjs]) => ({ conta, empresas: cnpjs.size }));

  const empresas = [...empresasPorCnpj.values()].sort((a, b) =>
    a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR')
  );
  empresas.forEach((e) =>
    e.contas.sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.conta.localeCompare(b.conta))
  );

  return { empresas, problemas, contasAmbiguas, linhasLidas, contasImportadas, nomeAba };
}

/* ========================================================================== *
 * As razões sociais antigas
 * ========================================================================== *
 * POR QUE ISTO É NECESSÁRIO
 * -------------------------
 * O grupo passou por uma renomeação grande: Omega virou Serena, Porto do
 * Parnaíba virou Delta 1 II, Sigma virou Serra das Agulhas. São 104 de 161
 * empresas com nome antigo registrado.
 *
 * Um boleto emitido antes da mudança — ou por um fornecedor que não atualizou o
 * cadastro — vem com o nome velho. O operador que procurar "Porto do Parnaíba"
 * no portal não acharia nada, e teria que abrir uma planilha à parte para
 * descobrir que hoje é "Delta 1 II".
 *
 * Guardando os dois nomes, a busca encontra por qualquer um deles.
 *
 * E TEM UM ACHADO DE BRINDE
 * -------------------------
 * A planilha compara o nome jurídico (consulta oficial) com o nome que está no
 * Mapa de Contas, e marca as divergências. São 14. Em alguns casos a diferença
 * é grande — o Mapa de Contas diz "VDB F2 Geração" onde o jurídico diz
 * "Assuruá 2 I". Não corrijo por conta própria: qual dos dois vale é decisão de
 * quem cuida do cadastro. Mas os dois entram na busca, e o relatório lista as
 * divergências para alguém decidir.
 */
const SEM_INFORMACAO = new Set(['', 'não informado', 'nao informado', 'n/a', '-', 'erro na consulta']);

function lerRazoesSociais(op) {
  if (!op.arquivoRazoes) return null;

  const livro = abrirPlanilha(op.arquivoRazoes);
  const nomeAba = livro.SheetNames.includes(op.abaRazoes) ? op.abaRazoes : livro.SheetNames[0];
  const matriz = comoMatriz(livro.Sheets[nomeAba]);

  const pistas = [op.colCnpjRazoes, op.colJuridica, op.colAntiga];
  const linhaCab = acharCabecalho(matriz, pistas).linha;
  const cab = matriz[linhaCab] ?? [];

  const idx = {
    cnpj: acharColuna(cab, op.colCnpjRazoes),
    juridica: acharColuna(cab, op.colJuridica),
    antiga: acharColuna(cab, op.colAntiga),
  };

  if (idx.cnpj < 0 || idx.juridica < 0) {
    console.warn(
      `Aviso: não achei as colunas de CNPJ e razão social jurídica em "${nomeAba}". ` +
        'Os nomes antigos não serão importados.'
    );
    return null;
  }

  const porDocumento = new Map();
  let comAntiga = 0;

  for (let i = linhaCab + 1; i < matriz.length; i += 1) {
    const linha = matriz[i] ?? [];
    const pega = (j) => (j >= 0 ? String(linha[j] ?? '').trim() : '');

    const doc = digitos(pega(idx.cnpj));
    if (!doc) continue;

    const juridica = pega(idx.juridica);
    const antiga = pega(idx.antiga);

    const nomes = [];
    if (juridica && !SEM_INFORMACAO.has(juridica.toLowerCase())) nomes.push(juridica);
    if (antiga && !SEM_INFORMACAO.has(antiga.toLowerCase())) {
      nomes.push(antiga);
      comAntiga += 1;
    }

    if (nomes.length) porDocumento.set(doc, { juridica: juridica || null, nomes });
  }

  return { porDocumento, comAntiga, aba: nomeAba, arquivo: path.basename(op.arquivoRazoes) };
}

/**
 * Junta os nomes antigos e jurídicos nas empresas já importadas.
 * Casa por CNPJ exato e, se não achar, pela raiz — mesma lógica do portal.
 */
function juntarRazoes(empresas, razoes) {
  if (!razoes) return { casadas: 0, divergentes: [], semCasar: [] };

  const porDoc = new Map(empresas.map((e) => [e.documento, e]));
  const porRaiz = new Map();
  for (const e of empresas) {
    if (e.documento.length === 14) {
      if (!porRaiz.has(e.documento.slice(0, 8))) porRaiz.set(e.documento.slice(0, 8), []);
      porRaiz.get(e.documento.slice(0, 8)).push(e);
    }
  }

  let casadas = 0;
  const divergentes = [];
  const semCasar = [];

  for (const [doc, info] of razoes.porDocumento) {
    let alvos = porDoc.has(doc) ? [porDoc.get(doc)] : porRaiz.get(doc.slice(0, 8)) ?? [];
    if (!alvos.length) {
      semCasar.push({ documento: doc, nome: info.juridica });
      continue;
    }

    for (const empresa of alvos) {
      empresa.razaoSocialJuridica = info.juridica ?? empresa.razaoSocialJuridica ?? null;

      // Comparar por chave normalizada, não por texto. "ARCO ENERGIA 1 S.A."
      // e "Arco Energia 1 S.A." são o mesmo nome com caixa diferente — guardar
      // os dois só polui a lista que o operador vê.
      const jaConhecidos = new Set(
        [empresa.razaoSocial, ...empresa.nomesAlternativos].map((n) => chaveDeNome(n))
      );

      for (const nome of info.nomes) {
        const chave = chaveDeNome(nome);
        if (!chave || jaConhecidos.has(chave)) continue;
        empresa.nomesAlternativos.push(nome);
        jaConhecidos.add(chave);
      }

      // O nome jurídico diverge do nome do Mapa de Contas? Vale registrar.
      if (
        info.juridica &&
        chaveDeNome(info.juridica) !== chaveDeNome(empresa.razaoSocial)
      ) {
        divergentes.push({
          documento: empresa.documento,
          noMapaDeContas: empresa.razaoSocial,
          juridica: info.juridica,
        });
      }
      casadas += 1;
    }
  }

  return { casadas, divergentes, semCasar };
}

/* ========================================================================== *
 * Gerar o JSON
 * ========================================================================== */
function montarJson(resultado, origem) {
  const { empresas } = resultado;

  const porConta = {};
  const porChaveBusca = {};

  for (const e of empresas) {
    porChaveBusca[e.chaveBusca] = e.documento;
    for (const alt of [...e.nomesAlternativos, e.razaoSocialJuridica].filter(Boolean)) {
      const k = chaveDeNome(alt);
      if (k && !porChaveBusca[k]) porChaveBusca[k] = e.documento;
    }
    for (const c of e.contas) {
      if (!porConta[c.conta]) porConta[c.conta] = [];
      if (!porConta[c.conta].includes(e.documento)) porConta[c.conta].push(e.documento);
      // Indexamos também só os dígitos: a conta vem com traço ("37700-7") e
      // ninguém digita o traço quando está procurando.
      if (c.contaDigitos && c.contaDigitos !== c.conta) {
        if (!porConta[c.contaDigitos]) porConta[c.contaDigitos] = [];
        if (!porConta[c.contaDigitos].includes(e.documento)) {
          porConta[c.contaDigitos].push(e.documento);
        }
      }
    }
  }

  const contasTotais = empresas.reduce((t, e) => t + e.contas.length, 0);
  const contasAtivas = empresas.reduce((t, e) => t + e.contas.filter((c) => c.ativa).length, 0);

  return {
    geradoEm: new Date().toISOString(),
    origem,
    aba: resultado.nomeAba,
    totais: {
      empresas: empresas.length,
      contas: contasTotais,
      contasAtivas,
      contasEncerradas: contasTotais - contasAtivas,
    },
    avisos: {
      contasEmMaisDeUmaEmpresa: resultado.contasAmbiguas,
      problemas: resultado.problemas.length,
    },
    empresas,
    indices: { porConta, porChaveBusca },
  };
}

/* ========================================================================== *
 * Gerar o SQL
 * ========================================================================== */
function montarSql(pacote) {
  const esc = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  const linhas = [];

  linhas.push('-- ===========================================================================');
  linhas.push('-- 07_seed_contas.sql — Empresas do grupo e suas contas bancárias');
  linhas.push('--');
  linhas.push('-- GERADO AUTOMATICAMENTE. Não edite à mão: rode o importador de novo.');
  linhas.push(`--   Origem : ${pacote.origem}`);
  linhas.push(`--   Aba    : ${pacote.aba}`);
  linhas.push(`--   Quando : ${pacote.geradoEm}`);
  linhas.push(
    `--   Contém : ${pacote.totais.empresas} empresas, ${pacote.totais.contas} contas ` +
      `(${pacote.totais.contasAtivas} ativas, ${pacote.totais.contasEncerradas} encerradas)`
  );
  linhas.push('--');
  linhas.push('-- Estratégia de recarga: marcamos TUDO como inativo, depois reativamos o que');
  linhas.push('-- veio na planilha. Nada é apagado, para os boletos antigos continuarem');
  linhas.push('-- fazendo sentido mesmo que a empresa saia da planilha.');
  linhas.push('-- ===========================================================================');
  linhas.push('');
  linhas.push('begin;');
  linhas.push('');
  linhas.push('update public.empresas set ativo = false;');
  linhas.push('update public.contas_bancarias set ativo = false;');
  linhas.push('');

  linhas.push('-- --------------------------------------------------------------- EMPRESAS --');
  linhas.push('insert into public.empresas');
  linhas.push(
    '  (documento, documento_tipo, razao_social, razao_social_juridica, nomes_alternativos, chave_busca, grupo_economico, codigo_interno, ativo)'
  );
  linhas.push('values');
  linhas.push(
    pacote.empresas
      .map((e) => {
        const alt = e.nomesAlternativos.length
          ? `array[${e.nomesAlternativos.map(esc).join(', ')}]::text[]`
          : `'{}'::text[]`;
        return `  (${esc(e.documento)}, ${esc(e.documentoTipo)}, ${esc(e.razaoSocial)}, ${esc(e.razaoSocialJuridica)}, ${alt}, ${esc(e.chaveBusca)}, ${esc(e.grupo)}, ${esc(e.codigo)}, true)`;
      })
      .join(',\n')
  );
  linhas.push('on conflict (documento) do update set');
  linhas.push('  documento_tipo       = excluded.documento_tipo,');
  linhas.push('  razao_social         = excluded.razao_social,');
  linhas.push('  razao_social_juridica = excluded.razao_social_juridica,');
  linhas.push('  nomes_alternativos = excluded.nomes_alternativos,');
  linhas.push('  chave_busca        = excluded.chave_busca,');
  linhas.push('  grupo_economico    = excluded.grupo_economico,');
  linhas.push('  codigo_interno     = excluded.codigo_interno,');
  linhas.push('  ativo              = true;');
  linhas.push('');

  linhas.push('-- ------------------------------------------------------ CONTAS BANCÁRIAS --');
  const valoresContas = [];
  for (const e of pacote.empresas) {
    for (const c of e.contas) {
      valoresContas.push(
        `  (${esc(e.documento)}, ${esc(c.conta)}, ${esc(c.contaDigitos)}, ${esc(c.banco)}, ${esc(c.codBanco)}, ${esc(c.agencia)}, ${esc(c.tipoConta)}, ${c.ativa ? 'true' : 'false'})`
      );
    }
  }

  for (let i = 0; i < valoresContas.length; i += 400) {
    const bloco = valoresContas.slice(i, i + 400);
    linhas.push('insert into public.contas_bancarias');
    linhas.push(
      '  (empresa_documento, conta, conta_digitos, banco, cod_banco, agencia, tipo_conta, ativo)'
    );
    linhas.push('values');
    linhas.push(bloco.join(',\n'));
    linhas.push('on conflict (empresa_documento, conta) do update set');
    linhas.push('  conta_digitos = excluded.conta_digitos,');
    linhas.push('  banco         = excluded.banco,');
    linhas.push('  cod_banco     = excluded.cod_banco,');
    linhas.push('  agencia       = excluded.agencia,');
    linhas.push('  tipo_conta    = excluded.tipo_conta,');
    linhas.push('  ativo         = excluded.ativo;');
    linhas.push('');
  }

  linhas.push('commit;');
  linhas.push('');
  linhas.push('-- Conferência rápida:');
  linhas.push('--   select count(*) from public.empresas where ativo;');
  linhas.push('--   select count(*) from public.contas_bancarias where ativo;');
  return linhas.join('\n');
}

/* ========================================================================== *
 * Principal
 * ========================================================================== */
function principal() {
  const op = lerArgumentos(process.argv);
  const livro = abrirPlanilha(op.arquivo);

  if (op.inspecionar) {
    inspecionar(livro, op);
    return;
  }

  const resultado = importar(livro, op);

  // Os nomes antigos, se a planilha de razões sociais foi informada.
  const razoes = lerRazoesSociais(op);
  const juncao = juntarRazoes(resultado.empresas, razoes);

  const pacote = montarJson(resultado, path.basename(op.arquivo));
  pacote.razoesSociais = razoes
    ? {
        origem: razoes.arquivo,
        aba: razoes.aba,
        empresasCasadas: juncao.casadas,
        comDenominacaoAntiga: razoes.comAntiga,
        divergencias: juncao.divergentes,
      }
    : null;

  fs.mkdirSync(path.dirname(op.saidaJson), { recursive: true });
  fs.writeFileSync(op.saidaJson, JSON.stringify(pacote, null, 1), 'utf8');

  fs.mkdirSync(path.dirname(op.saidaSql), { recursive: true });
  fs.writeFileSync(op.saidaSql, montarSql(pacote), 'utf8');

  const caminhoProblemas = op.saidaJson.replace(/\.json$/, '.problemas.json');
  if (resultado.problemas.length) {
    fs.writeFileSync(
      caminhoProblemas,
      JSON.stringify({ geradoEm: pacote.geradoEm, problemas: resultado.problemas }, null, 1),
      'utf8'
    );
  } else if (fs.existsSync(caminhoProblemas)) {
    fs.unlinkSync(caminhoProblemas);
  }

  if (op.silencioso) return;

  console.log('');
  console.log(`Aba usada: ${resultado.nomeAba}`);
  console.log(`Linhas com conteúdo: ${resultado.linhasLidas}`);
  console.log('');
  console.log(`Empresas          : ${pacote.totais.empresas}`);
  console.log(`Contas bancárias  : ${pacote.totais.contas}`);
  console.log(`  ativas          : ${pacote.totais.contasAtivas}`);
  console.log(`  encerradas      : ${pacote.totais.contasEncerradas}  (guardadas, fora do formulário)`);

  if (resultado.problemas.length) {
    console.log('');
    console.log(`Linhas ignoradas: ${resultado.problemas.length}`);
    resultado.problemas.slice(0, 12).forEach((p) => console.log(`  linha ${p.linha}: ${p.motivo}`));
    if (resultado.problemas.length > 12) {
      console.log(`  ... e mais ${resultado.problemas.length - 12}. Lista completa em:`);
      console.log(`  ${path.relative(process.cwd(), caminhoProblemas)}`);
    }
  }

  if (resultado.contasAmbiguas.length) {
    console.log('');
    console.log('Atenção: estas contas aparecem em mais de uma empresa —');
    console.log('escolher só pelo número da conta fica ambíguo:');
    resultado.contasAmbiguas.forEach((c) =>
      console.log(`  conta ${c.conta} -> ${c.empresas} empresas`)
    );
  }

  if (pacote.razoesSociais) {
    const r = pacote.razoesSociais;
    console.log('');
    console.log(`Razões sociais (${r.origem}, aba "${r.aba}"):`);
    console.log(`  empresas casadas         : ${r.empresasCasadas}`);
    console.log(`  com denominação antiga   : ${r.comDenominacaoAntiga}`);
    if (r.divergencias.length) {
      console.log('');
      console.log(`  ATENÇÃO: ${r.divergencias.length} empresa(s) com nome jurídico diferente`);
      console.log('  do nome no Mapa de Contas. Os dois entram na busca, mas alguém');
      console.log('  precisa decidir qual é o correto:');
      r.divergencias.slice(0, 20).forEach((d) => {
        console.log(`    ${d.documento}`);
        console.log(`       mapa de contas: ${d.noMapaDeContas}`);
        console.log(`       jurídico      : ${d.juridica}`);
      });
      if (r.divergencias.length > 20) {
        console.log(`    ... e mais ${r.divergencias.length - 20}. A lista completa está no JSON.`);
      }
    }
  }

  console.log('');
  console.log('Gerado:');
  console.log(`  ${path.relative(process.cwd(), op.saidaJson)}`);
  console.log(`  ${path.relative(process.cwd(), op.saidaSql)}`);
  console.log('');
}

principal();
