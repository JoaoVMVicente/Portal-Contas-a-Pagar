/**
 * leitor-grafico.js — Ler os códigos DESENHADOS no boleto, como imagem.
 * ===========================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ===========================================================================
 * Até agora o portal lia o boleto como TEXTO: pegava o texto de dentro do PDF
 * e procurava padrões. Isso funciona bem quando o PDF foi gerado por
 * computador e tem texto de verdade lá dentro.
 *
 * Aí apareceu uma fatura da Enel que quebrou tudo. O PDF tinha 197 caracteres
 * de texto — e eram só isto:
 *
 *     "17/07/2026, 17:23 Caixa de Entrada - João ... - Outlook"
 *     "https://outlook.cloud.microsoft/mail/id/AAQk..."
 *
 * O carimbo que o navegador põe ao imprimir um e-mail. A fatura inteira era
 * uma IMAGEM. E o portal, procurando datas no texto, achou a data da
 * impressão e a ofereceu como vencimento. Errado de um jeito perigoso: um
 * número plausível, no campo certo, e nada indicando que era lixo.
 *
 * ===========================================================================
 * A IDEIA
 * ===========================================================================
 * Todo boleto tem um código de barras DESENHADO. Faturas modernas têm também
 * QR codes. Esses desenhos são feitos para máquina ler — têm redundância e
 * detecção de erro embutidas. Ler o desenho é muito mais confiável do que ler
 * os números impressos embaixo dele.
 *
 * Comparando os três caminhos, do melhor para o pior:
 *
 *   1. DECODIFICAR O DESENHO   acerta ou não devolve nada. Sem meio-termo.
 *   2. TEXTO DE DENTRO DO PDF   confiável, mas só existe em PDF digital.
 *   3. OCR                      palpite: 8 e 3 são parecidos, 1 e 7 também.
 *
 * Este arquivo faz o nível 1, que antes não existia.
 *
 * ===========================================================================
 * O QUE DÁ PARA TIRAR DE CADA CÓDIGO
 * ===========================================================================
 * CÓDIGO DE BARRAS (ITF, o do boleto):
 *   44 dígitos que o boleto-parser.js transforma em valor e vencimento, com
 *   dígito verificador conferindo. É a fonte mais confiável que existe.
 *
 * QR CODE DO PIX (padrão EMV do Banco Central):
 *   campo 54 = valor, campo 59 = nome de quem recebe, campo 60 = cidade.
 *   Na fatura da Enel: "603.84" e "ENEL DISTRIBUICAO RIO".
 *
 * QR CODE DA NOTA FISCAL (NFe, NFCe, NF3e, CTe):
 *   a chave de acesso, 44 dígitos, que contém o CNPJ de quem emitiu e o
 *   número da nota. Na fatura da Enel: CNPJ 33.050.071/0001-58 e nota
 *   136.637.983 — exatamente o "Nº do Documento" que precisamos.
 *
 * Ou seja: numa fatura em que o texto não serviu para nada, os três códigos
 * gráficos entregam valor, vencimento, fornecedor, CNPJ e número da nota.
 */

import { CONFIG } from './config.js';

/* ========================================================================== *
 * Carregar a biblioteca de decodificação
 * ========================================================================== *
 * Usamos a zxing-wasm: é o motor ZXing em C++ compilado para WebAssembly.
 * Escolhi ela em vez da versão em JavaScript puro por dois motivos: continua
 * mantida, e foi com esse motor que eu consegui decodificar o código de
 * barras da sua fatura da Enel nos testes — a versão JS falhava na mesma
 * imagem.
 */
let leitor = null;

async function carregarLeitor() {
  if (leitor) return leitor;

  let ultimoErro = null;
  for (const endereco of CONFIG.CDN_ZXING) {
    try {
      const modulo = await import(/* @vite-ignore */ endereco);
      if (typeof modulo.readBarcodes === 'function') {
        leitor = modulo;
        return leitor;
      }
    } catch (erro) {
      ultimoErro = erro;
    }
  }

  throw new Error(
    'Não consegui carregar o leitor de códigos de barras. ' +
      `Último erro: ${ultimoErro?.message ?? 'desconhecido'}`
  );
}

/* ========================================================================== *
 * 1. Decodificar os códigos de uma imagem
 * ========================================================================== */
/**
 * @param {HTMLCanvasElement} canvas Uma página já desenhada.
 * @returns {Promise<{formato:string, texto:string}[]>}
 */
export async function decodificarCanvas(canvas) {
  const zxing = await carregarLeitor();
  const contexto = canvas.getContext('2d', { willReadFrequently: true });
  const imagem = contexto.getImageData(0, 0, canvas.width, canvas.height);

  const resultados = await zxing.readBarcodes(imagem, {
    // Só os formatos que interessam. Restringir deixa mais rápido e evita
    // que um pedaço de tabela seja confundido com um código de barras.
    formats: ['ITF', 'QRCode', 'Code128', 'DataMatrix'],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 8,
  });

  return (resultados ?? [])
    .filter((r) => r?.text)
    .map((r) => ({ formato: String(r.format ?? ''), texto: String(r.text) }));
}

/* ========================================================================== *
 * 2. O código de barras do boleto
 * ========================================================================== */
const so = (v) => String(v ?? '').replace(/\D+/g, '');

/**
 * Escolhe, entre os códigos lidos, o que é o código de barras do boleto.
 *
 * Boleto de cobrança tem 44 dígitos. Conta de consumo e tributo têm 44 também
 * (o de 48 é a linha digitável, não o código de barras). Qualquer outra
 * quantidade não é boleto.
 */
export function acharCodigoDeBoleto(codigos) {
  for (const c of codigos) {
    if (!/ITF|Code128/i.test(c.formato)) continue;
    const digitos = so(c.texto);
    if (digitos.length === 44) return digitos;
  }
  return null;
}

/* ========================================================================== *
 * 3. QR code do PIX (padrão EMV do Banco Central)
 * ========================================================================== */
/**
 * O "BR Code" é uma sequência de blocos no formato TLV: dois dígitos de
 * etiqueta, dois de tamanho, e o conteúdo. Assim:
 *
 *     54 06 603.84        etiqueta 54 (valor), 6 caracteres, "603.84"
 *     59 21 ENEL DIST...  etiqueta 59 (nome), 21 caracteres
 *
 * Lemos bloco a bloco em vez de procurar por padrão, porque o conteúdo de um
 * bloco pode conter qualquer coisa — inclusive algo que pareça outra etiqueta.
 */
export function interpretarPix(texto) {
  const bruto = String(texto ?? '');
  if (!/^0002\d{2}/.test(bruto) && !/BR\.GOV\.BCB\.PIX/i.test(bruto)) return null;

  const campos = {};
  let i = 0;
  while (i + 4 <= bruto.length) {
    const etiqueta = bruto.slice(i, i + 2);
    const tamanho = Number(bruto.slice(i + 2, i + 4));
    if (!Number.isFinite(tamanho) || tamanho <= 0) break;
    campos[etiqueta] = bruto.slice(i + 4, i + 4 + tamanho);
    i += 4 + tamanho;
  }

  const valorBruto = campos['54'];
  const valor = valorBruto ? Number(valorBruto.replace(',', '.')) : null;

  return {
    valor: Number.isFinite(valor) && valor > 0 ? valor : null,
    nomeRecebedor: campos['59']?.trim() || null,
    cidade: campos['60']?.trim() || null,
  };
}

/* ========================================================================== *
 * 4. QR code da nota fiscal (NFe, NFCe, NF3e, CTe)
 * ========================================================================== */
/**
 * A chave de acesso tem 44 dígitos e é montada assim:
 *
 *   33  2607  33050071000158  66  000  136637983  1  05870060  4
 *   UF  AAMM      CNPJ        mod série  número   tp  código  DV
 *   └2┘  └4┘      └──14──┘    └2┘ └3┘    └──9──┘  └1┘  └─8─┘  └1┘
 *
 * O CNPJ ali é o de quem EMITIU a nota — o fornecedor. E o número é o número
 * da nota fiscal, que é justamente o campo "Nº do documento" do formulário.
 *
 * Cuidado com a confusão fácil: esses 44 dígitos NÃO são o código de barras
 * do boleto, que também tem 44. São coisas diferentes que por acaso têm o
 * mesmo tamanho.
 */
export function interpretarChaveFiscal(texto) {
  const bruto = String(texto ?? '');

  // A chave pode vir na URL de consulta ou solta.
  let chave = null;

  const naUrl = bruto.match(/ch(?:NFe|NF3e|CTe|BPe)=(\d{44})/i);
  if (naUrl) chave = naUrl[1];

  // NFCe usa "?p=<chave>|versao|ambiente|..."
  if (!chave) {
    const nfce = bruto.match(/[?&]p=(\d{44})\|/);
    if (nfce) chave = nfce[1];
  }

  if (!chave && /^\d{44}$/.test(bruto.trim())) chave = bruto.trim();

  if (!chave) return null;

  const modelo = chave.slice(20, 22);
  const MODELOS = {
    55: 'NF-e',
    65: 'NFC-e',
    57: 'CT-e',
    66: 'NF3e (energia elétrica)',
    59: 'CF-e',
  };

  return {
    chave,
    cnpjEmitente: chave.slice(6, 20),
    modelo,
    modeloNome: MODELOS[modelo] ?? `modelo ${modelo}`,
    serie: chave.slice(22, 25),
    numeroNota: String(Number(chave.slice(25, 34))),
    anoMes: `${chave.slice(4, 6)}/20${chave.slice(2, 4)}`,
  };
}

/* ========================================================================== *
 * 5. Tudo junto
 * ========================================================================== */
/**
 * Lê todos os códigos gráficos de um conjunto de páginas já desenhadas.
 *
 * @param {HTMLCanvasElement[]} canvases
 * @param {(mensagem:string)=>void} aoProgredir
 */
export async function lerCodigosDasPaginas(canvases, aoProgredir) {
  const resultado = {
    codigoBarras: null,
    pix: null,
    fiscal: null,
    brutos: [],
    avisos: [],
  };

  for (let i = 0; i < canvases.length; i += 1) {
    aoProgredir?.(`Procurando códigos na página ${i + 1} de ${canvases.length}...`);

    let codigos = [];
    try {
      codigos = await decodificarCanvas(canvases[i]);
    } catch (erro) {
      resultado.avisos.push(`Não consegui ler os códigos da página ${i + 1}.`);
      console.warn('leitor-grafico:', erro);
      continue;
    }

    resultado.brutos.push(...codigos.map((c) => ({ ...c, pagina: i + 1 })));

    if (!resultado.codigoBarras) {
      resultado.codigoBarras = acharCodigoDeBoleto(codigos);
    }

    for (const c of codigos) {
      if (!/QR/i.test(c.formato)) continue;
      if (!resultado.pix) resultado.pix = interpretarPix(c.texto);
      if (!resultado.fiscal) resultado.fiscal = interpretarChaveFiscal(c.texto);
    }

    // Achou o código de barras? Não precisa varrer o resto.
    if (resultado.codigoBarras && resultado.pix && resultado.fiscal) break;
  }

  return resultado;
}

export default {
  decodificarCanvas,
  acharCodigoDeBoleto,
  interpretarPix,
  interpretarChaveFiscal,
  lerCodigosDasPaginas,
};
