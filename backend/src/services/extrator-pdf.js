/**
 * extrator-pdf.js — Le o texto de dentro de um PDF, no servidor.
 *
 * Por que isso existe se o navegador ja faz? Por tres motivos:
 *   1. Alguns PDFs travam navegadores antigos.
 *   2. Da para reprocessar em lote boletos que ja foram enviados.
 *   3. Serve de conferencia: o servidor le de novo e compara com o que o
 *      navegador leu. Se der diferente, alguem mexeu no caminho.
 *
 * A leitura de imagem (OCR) e opcional. Se a biblioteca tesseract.js nao
 * estiver instalada, avisamos em vez de quebrar.
 */

import parser from '../../../frontend/js/boleto-parser.js';

let pdfjsCarregado = null;

/** Carrega a pdfjs-dist so na primeira vez que precisar. */
async function carregarPdfjs() {
  if (pdfjsCarregado) return pdfjsCarregado;
  try {
    // A build "legacy" e a que funciona em Node sem canvas nem DOM.
    const modulo = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsCarregado = modulo;
    return modulo;
  } catch (erro) {
    throw new Error(
      'A biblioteca pdfjs-dist nao esta instalada no back-end. ' +
        'Rode "npm install" dentro da pasta backend. Detalhe: ' + erro.message
    );
  }
}

/**
 * Junta os pedacinhos de texto do PDF respeitando as linhas.
 *
 * Isto e o segredo da coisa toda: a pdfjs devolve o texto em fragmentos soltos,
 * cada um com a sua posicao na pagina. Se a gente simplesmente colar tudo, a
 * linha digitavel do boleto vem picada e nenhum padrao casa. Entao agrupamos os
 * fragmentos que estao na MESMA altura (mesmo Y) e so depois juntamos.
 */
function juntarPorLinhas(itens) {
  const linhas = new Map();

  for (const item of itens) {
    if (!item.str || !item.str.trim()) continue;
    // transform[5] e a posicao vertical do fragmento.
    const y = Math.round(item.transform[5]);
    // Tolerancia de 2 pontos: fragmentos quase na mesma altura sao a mesma linha.
    const chave = [...linhas.keys()].find((existente) => Math.abs(existente - y) <= 2) ?? y;
    if (!linhas.has(chave)) linhas.set(chave, []);
    linhas.get(chave).push({ x: item.transform[4], texto: item.str });
  }

  return [...linhas.entries()]
    .sort((a, b) => b[0] - a[0]) // de cima para baixo
    .map(([, pedacos]) =>
      pedacos
        .sort((a, b) => a.x - b.x) // da esquerda para a direita
        .map((p) => p.texto)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .join('\n');
}

/** Devolve o texto de um PDF que esta em memoria (um Buffer). */
export async function textoDoPdf(buffer, { maximoDePaginas = 5 } = {}) {
  const pdfjs = await carregarPdfjs();

  const documento = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Nao baixamos fontes nem mapas de caractere da internet.
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const paginas = Math.min(documento.numPages, maximoDePaginas);
  const partes = [];

  for (let numero = 1; numero <= paginas; numero += 1) {
    const pagina = await documento.getPage(numero);
    const conteudo = await pagina.getTextContent();
    partes.push(juntarPorLinhas(conteudo.items));
  }

  await documento.destroy();
  return partes.join('\n');
}

/**
 * O caminho completo: recebe o arquivo e devolve valor, vencimento e codigo.
 *
 * Ordem de tentativas, da mais confiavel para a menos confiavel:
 *   1. Texto do PDF -> acha a linha digitavel -> CALCULA valor e vencimento.
 *   2. Texto do PDF -> procura "R$ ..." e "Vencimento ..." escritos.
 *   3. OCR (so se for imagem, ou PDF escaneado sem texto nenhum).
 */
export async function extrairDoBuffer(buffer, { nomeArquivo = '', tipo = '' } = {}) {
  const ehPdf = /pdf/i.test(tipo) || /\.pdf$/i.test(nomeArquivo);

  if (ehPdf) {
    const texto = await textoDoPdf(buffer);
    const resultado = parser.extrairDadosDeTexto(texto);

    if (resultado.codigoBarras || resultado.valor != null) {
      return { ...resultado, origem: 'texto-do-pdf', textoEncontrado: Boolean(texto.trim()) };
    }

    // PDF sem texto = provavelmente um scan. Tentamos OCR.
    const porOcr = await tentarOcr(buffer, nomeArquivo);
    if (porOcr) return porOcr;

    return {
      ...resultado,
      origem: 'texto-do-pdf',
      textoEncontrado: Boolean(texto.trim()),
      avisos: [
        ...(resultado.avisos ?? []),
        'Nao encontrei linha digitavel nem valor no texto deste PDF.',
      ],
    };
  }

  // Imagem: o unico caminho e OCR.
  const porOcr = await tentarOcr(buffer, nomeArquivo);
  if (porOcr) return porOcr;

  return {
    codigoBarras: null,
    valor: null,
    vencimento: null,
    confianca: 'baixa',
    metodo: 'nenhum',
    origem: 'imagem',
    avisos: ['Nao consegui ler esta imagem no servidor. Preencha os campos a mao.'],
  };
}

/** Tenta o OCR. Devolve null se a biblioteca nao estiver instalada. */
async function tentarOcr(buffer, nomeArquivo) {
  let Tesseract;
  try {
    Tesseract = await import('tesseract.js');
  } catch {
    return null; // OCR e opcional: sem a biblioteca, seguimos sem ele.
  }

  try {
    const { data } = await Tesseract.recognize(buffer, 'por');
    const resultado = parser.extrairDadosDeTexto(data.text ?? '');
    return {
      ...resultado,
      origem: 'ocr',
      metodo: resultado.metodo === 'nenhum' ? 'ocr' : `ocr+${resultado.metodo}`,
      // OCR erra digito. Se o DV do codigo fechou, confiamos; se nao, avisamos.
      confianca: resultado.codigoBarras ? resultado.confianca : 'baixa',
      avisos: [
        ...(resultado.avisos ?? []),
        'Dados lidos por reconhecimento de imagem (OCR). Confira com o boleto original.',
      ],
    };
  } catch (erro) {
    void nomeArquivo;
    return null;
  }
}

export default { textoDoPdf, extrairDoBuffer };
