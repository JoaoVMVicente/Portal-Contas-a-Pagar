/**
 * boleto-campos.test.mjs — Testes da leitura de campos do texto do boleto.
 *
 * ===========================================================================
 * POR QUE ESTES TESTES EXISTEM
 * ===========================================================================
 * O boleto-parser.js faz matemática: valor e vencimento saem do código de
 * barras e são conferidos por dígito verificador. Aqueles 40 testes garantem
 * que a conta está certa.
 *
 * Este arquivo cobre a outra metade, que é palpite educado: achar o número do
 * documento, o CNPJ da nossa empresa e os dados do fornecedor dentro do TEXTO.
 * Não existe dígito verificador para "nome do fornecedor", então a única forma
 * de não regredir é guardar casos reais como teste.
 *
 * O primeiro caso aqui é um boleto de verdade do Banco do Brasil, que expôs
 * quatro erros de uma vez:
 *
 *   1. O CNPJ do pagador vinha da FILIAL (0002) e a planilha cadastra a
 *      MATRIZ (0001). Comparando os 14 dígitos, a nossa própria empresa
 *      parecia ser de fora — e ia para o campo do fornecedor.
 *   2. Como consequência, o fornecedor de verdade era descartado.
 *   3. O nome vinha sujo ("DELTA 7 1 ENERGIA S.A 03/08/"), porque a data de
 *      vencimento fica na mesma faixa horizontal, numa caixa ao lado.
 *   4. "Nr. do Documento" não era reconhecido (só "Nº" e "Nº do") e, pior, o
 *      valor fica na LINHA DE BAIXO do rótulo nesse layout.
 *
 * Rode com:  node src/services/boleto-campos.test.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import campos from '../../../frontend/js/boleto-campos.js';
import * as R from './fixtures-boletos-reais.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAMINHO_JSON = resolve(AQUI, '../../../frontend/data/contas-bancarias.json');

/* ========================================================================== *
 * Um verificador de empresa igual ao do navegador, mas lendo o JSON do disco
 * ========================================================================== */
async function criarVerificador() {
  const pacote = JSON.parse(await readFile(CAMINHO_JSON, 'utf8'));

  const exatos = new Set(pacote.empresas.map((e) => e.documento));
  const raizes = new Set(
    pacote.empresas
      .filter((e) => e.documento.length === 14)
      .map((e) => e.documento.slice(0, 8))
  );

  const so = (v) => String(v ?? '').replace(/\D+/g, '');
  return {
    ehNossaEmpresa: (doc) => {
      const d = so(doc);
      return exatos.has(d) || (d.length === 14 && raizes.has(d.slice(0, 8)));
    },
    pacote,
  };
}

/* ========================================================================== *
 * Micro-framework, igual ao do outro arquivo de teste
 * ========================================================================== */
let passaram = 0;
let falharam = 0;
const VERDE = '\x1b[32m';
const VERMELHO = '\x1b[31m';
const FIM = '\x1b[0m';

function teste(nome, funcao) {
  try {
    funcao();
    passaram += 1;
    console.log(`  ${VERDE}✓${FIM} ${nome}`);
  } catch (erro) {
    falharam += 1;
    console.log(`  ${VERMELHO}✗${FIM} ${nome}`);
    console.log(`      ${erro.message}`);
  }
}

function igual(obtido, esperado, oQue) {
  if (obtido !== esperado) {
    throw new Error(`${oQue}: esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);
  }
}

function grupo(nome) {
  console.log(`\n${nome}`);
}

/* ========================================================================== *
 * CASO 1 — Boleto real do Banco do Brasil
 * ========================================================================== *
 * O texto abaixo é o que a pdf.js entrega depois de agrupar os fragmentos por
 * altura. Repare que rótulo e valor caem em linhas diferentes: é assim que o
 * layout do BB é montado, e foi isso que quebrou a leitura do número.
 */
const BANCO_DO_BRASIL = [
  'Pague agora com o seu Pix',
  'Para efetuar o pagamento via Pix, utilize a opção Pix no seu aplicativo',
  'Recibo do Pagador',
  'BANCO DO BRASIL 001-9 00190.00009 03286.977008 00003.099173 1 15270000209865',
  'Nome do Pagador / Endereço CNPJ Data de Vencimento',
  'DELTA 7 1 ENERGIA S.A 30.866.542/0002-93 03/08/2026',
  'RODOVIA MA 315 Agência / Código do Beneficiário',
  'CEP: 65585-000, PAULINO NEVES - MA 3137-2/29509-4',
  'Nome do Beneficiário / Endereço CNPJ Nosso Número',
  'TEM TUDO COMERCIAL DE MATERIAL DE CONSTR 27.591.360/0001-61 00003286977000003099-1',
  'AV DOUTOR JOAO SILVA FILHO 5056 - PIAUI (=) Valor do Documento',
  'CEP: 64208-105, PARNAIBA - PI 2.098,65',
  'Uso do Banco Nr. do Documento Espécie Doc. Aceite Data Processamento (=) Valor Pago',
  '44597 DM N 04/07/2026',
  'Autenticação Mecânica',
  'Local de Pagamento Data de Vencimento',
  'Pagar preferencialmente nos canais de autoatendimento do Banco do Brasil 03/08/2026',
  'Nome do Beneficiário / Endereço CNPJ Agência / Código do Beneficiário',
  'TEM TUDO COMERCIAL DE MATERIAL DE CONSTR 27.591.360/0001-61 3137-2/29509-4',
  'Data Documento Nr. do Documento Espécie Doc. Aceite Data Processamento Nosso Número',
  '04/07/2026 44597 DM N 04/07/2026 00003286977000003099-1',
  'Uso do Banco Carteira Espécie Quantidade (x) Valor (=) Valor do Documento',
  '17 R$ 2.098,65',
  'Informações de responsabilidade do Beneficiário (-) Desconto / Abatimento',
  'JRS: VL p/Dia Atraso R$20,98 A PARTIR DE 04/08/26 (+) Juros / Multa',
  'MULTA DE 2,00% A PARTIR DE 08/08/2026 (=) Valor Cobrado',
  'PROTESTO: A partir de 18/08/2026',
  'Nome do Pagador / Endereço CNPJ',
  'DELTA 7 1 ENERGIA S.A 30.866.542/0002-93',
  'RODOVIA MA 315',
  'CEP: 65585-000, PAULINO NEVES - MA',
  'Beneficiário Final CPF / CNPJ',
  'Autenticação Mecânica - Ficha de Compensação',
].join('\n');

/* ========================================================================== *
 * CASO 2 — Layout com rótulo e valor na mesma linha (o mais comum)
 * ========================================================================== */
const MESMA_LINHA = [
  'Beneficiário: ALFA SERVICOS LTDA    CNPJ: 47.960.950/0001-21',
  'Pagador: SERENA GERACAO S.A.    CNPJ: 09.149.503/0001-06',
  'Número do documento: 8821',
  'Vencimento: 12/08/2026   Valor: R$ 4.250,00',
].join('\n');

/* ========================================================================== *
 * Os testes
 * ========================================================================== */
const { ehNossaEmpresa } = await criarVerificador();

grupo('Banco do Brasil — o boleto que expôs os quatro erros');

const bb = campos.extrairCamposDoTexto(BANCO_DO_BRASIL, { ehNossaEmpresa });

teste('reconhece a nossa empresa mesmo vindo de uma FILIAL (0002 x matriz 0001)', () => {
  igual(bb.unidadeCnpj, '30866542000293', 'CNPJ da unidade');
});

teste('não confunde a nossa empresa com o fornecedor', () => {
  if (bb.fornecedorCnpj === '30866542000293') {
    throw new Error('o CNPJ da nossa própria empresa foi para o campo do fornecedor');
  }
});

teste('acha o CNPJ do fornecedor (o beneficiário)', () => {
  igual(bb.fornecedorCnpj, '27591360000161', 'CNPJ do fornecedor');
});

teste('acha a razão social do fornecedor, sem sujeira', () => {
  igual(bb.fornecedorRazaoSocial, 'TEM TUDO COMERCIAL DE MATERIAL DE CONSTR', 'razão social');
});

teste('não deixa a data de vencimento entrar no nome', () => {
  if (/\d{2}\/\d{2}/.test(bb.fornecedorRazaoSocial ?? '')) {
    throw new Error(`sobrou data no nome: ${bb.fornecedorRazaoSocial}`);
  }
});

teste('lê "Nr. do Documento" com o valor na linha de baixo', () => {
  igual(bb.numeroDocumento, '44597', 'número do documento');
});

teste('não confunde "Nosso Número" com o número da nota', () => {
  const nossoNumero = '00003286977000003099';
  if (bb.numeroDocumentoCandidatos.some((c) => nossoNumero.includes(c.numero) && c.numero.length > 8)) {
    throw new Error('o "nosso número" entrou como candidato a número da nota');
  }
});

teste('não sugere tipo MD por causa da espécie "DM"', () => {
  if (bb.numeroDocumentoTipoSugerido === 'MD') {
    throw new Error('"DM" (duplicata mercantil) foi confundido com "MD" (medição)');
  }
});

grupo('Layout com rótulo e valor na mesma linha');

const ml = campos.extrairCamposDoTexto(MESMA_LINHA, { ehNossaEmpresa, tipoDocumento: 'NF' });

teste('acha a nossa empresa', () => {
  igual(ml.unidadeCnpj, '09149503000106', 'CNPJ da unidade');
});

teste('acha o fornecedor', () => {
  igual(ml.fornecedorCnpj, '47960950000121', 'CNPJ do fornecedor');
});

teste('o nome do fornecedor não carrega a palavra do rótulo', () => {
  const nome = ml.fornecedorRazaoSocial ?? '';
  if (/BENEFICI|PAGADOR|CEDENTE/i.test(nome)) {
    throw new Error(`o rótulo grudou no nome: ${nome}`);
  }
  igual(nome, 'ALFA SERVICOS LTDA', 'razão social');
});

teste('acha o número do documento', () => {
  igual(ml.numeroDocumento, '8821', 'número do documento');
});

grupo('Entradas ruins não podem quebrar nada');

for (const entrada of ['', '   ', null, undefined, 'texto sem nada útil', '000000', 'CNPJ 11.111.111/1111-11']) {
  teste(`entrada ${JSON.stringify(entrada)} devolve resultado seguro`, () => {
    const r = campos.extrairCamposDoTexto(entrada, { ehNossaEmpresa });
    if (typeof r !== 'object' || r === null) throw new Error('não devolveu objeto');
    if (!Array.isArray(r.avisos)) throw new Error('avisos não é lista');
    if (!Array.isArray(r.numeroDocumentoCandidatos)) throw new Error('candidatos não é lista');
  });
}

teste('CNPJ com dígito quebrado NÃO é usado — fica em branco, com aviso', () => {
  // Mudança deliberada de comportamento. A versão anterior preenchia o campo
  // com o número suspeito. Isso é pior que deixar vazio: um número plausível,
  // no lugar certo, que a pessoa aceita sem conferir. Foi assim que os 14
  // dígitos finais da linha digitável viraram "CNPJ do fornecedor" em dois
  // boletos reais.
  const r = campos.extrairCamposDoTexto(
    'Beneficiário: BETA LTDA CNPJ 33.111.222/0001-44\nPagador: SERENA GERACAO S.A. CNPJ 09.149.503/0001-06',
    { ehNossaEmpresa }
  );
  igual(r.fornecedorCnpj, null, 'CNPJ do fornecedor');
  if (!r.avisos.some((a) => /dígito/i.test(a))) {
    throw new Error('faltou o aviso sobre o dígito verificador');
  }
});

/* ========================================================================== *
 * OS CINCO BOLETOS REAIS
 * ========================================================================== */
grupo('Boletos reais — cinco bancos, cinco falhas diferentes');

const REAIS = [
  {
    nome: 'Itaú / Ingram Micro — nenhum CNPJ no documento inteiro',
    texto: R.ITAU_INGRAM,
    empresaEsperada: null, // só o nome está no papel
    empresaPeloNome: 'SERENA GERAÇÃO',
    fornecedor: 'INGRAM MICRO BRASIL LTDA',
    fornecedorCnpj: null,
  },
  {
    nome: 'Itaú / Randstad — cedente sem CNPJ, e data grudada no número',
    texto: R.ITAU_RANDSTAD,
    empresaEsperada: '42500384000151',
    fornecedor: 'RANDSTAD BRASIL REC HUMANOS LTDA',
    fornecedorCnpj: null,
  },
  {
    nome: 'Bradesco / Consórcio — beneficiário e pagador ambos do grupo',
    texto: R.BRADESCO_CONSORCIO,
    empresaEsperada: '23598517000200',
    fornecedor: 'CONSORCIO SERENA GD 10',
    fornecedorCnpj: '54146558000109',
  },
  {
    nome: 'Itaú / Optum — CNPJ sem pontuação e rótulo "Beneficiário/Sacador"',
    texto: R.ITAU_OPTUM,
    empresaEsperada: '09149503000360',
    fornecedor: 'OHT OPTUM HEALTH TECHNOLOGY',
    fornecedorCnpj: '18522213000149',
  },
  {
    nome: 'Itaú / Neoenergia — CNPJ do pagador mascarado com asteriscos',
    texto: R.ITAU_NEOENERGIA,
    empresaEsperada: null,
    empresaPeloNome: 'VENTOS DA BAHIA',
    fornecedor: 'COMPANHIA DE ELETRICIDADE DO ESTADO DA BAHIA',
    fornecedorCnpj: '15139629000194',
  },
];

for (const caso of REAIS) {
  const r = campos.extrairCamposDoTexto(caso.texto, { ehNossaEmpresa });

  teste(`${caso.nome} — nossa empresa`, () => {
    igual(r.unidadeCnpj, caso.empresaEsperada, 'CNPJ da unidade');
  });

  teste(`${caso.nome} — fornecedor`, () => {
    igual(r.fornecedorRazaoSocial, caso.fornecedor, 'razão social do fornecedor');
  });

  teste(`${caso.nome} — CNPJ do fornecedor`, () => {
    igual(r.fornecedorCnpj, caso.fornecedorCnpj, 'CNPJ do fornecedor');
  });

  teste(`${caso.nome} — nada da linha digitável virou CNPJ`, () => {
    const soDigitos = caso.texto.replace(/\D+/g, '');
    for (const achado of [r.unidadeCnpj, r.fornecedorCnpj].filter(Boolean)) {
      // Um CNPJ de verdade aparece no texto com pontuação, ou isolado. Se ele
      // só existe dentro da sequência corrida de dígitos, veio do código de
      // barras.
      const apareceFormatado =
        caso.texto.includes(achado) ||
        new RegExp(achado.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.?\\D?$2.?\\D?$3.?\\D?$4.?\\D?$5')).test(caso.texto);
      if (!apareceFormatado && soDigitos.includes(achado)) {
        throw new Error(`${achado} parece ter saído do código de barras`);
      }
    }
  });
}

/* ========================================================================== */
console.log('');
console.log(
  falharam === 0
    ? `${VERDE}${passaram} passaram, 0 falharam${FIM}`
    : `${VERMELHO}${passaram} passaram, ${falharam} falharam${FIM}`
);
console.log('');
process.exit(falharam === 0 ? 0 : 1);
