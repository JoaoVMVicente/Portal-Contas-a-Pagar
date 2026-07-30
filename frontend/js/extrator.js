/**
 * extrator.js — Abrir o arquivo do boleto e tirar tudo o que der de dentro.
 * ---------------------------------------------------------------------------
 * SOBRE O "ORC"
 * -------------
 * O nome certo é OCR: reconhecimento óptico de caracteres. É a tecnologia que
 * olha uma imagem e adivinha quais números estão desenhados ali.
 *
 * Ele é o ÚLTIMO recurso aqui, não o primeiro. O motivo é simples: OCR é um
 * palpite. Ele olha o desenho e opina "isso parece um 8" — mas 8 e 3 são
 * parecidos, 1 e 7 são parecidos. Numa folha amassada, escaneada torta, com
 * carimbo em cima, ele erra. E errar um dígito no valor transforma R$ 980,50
 * em R$ 930,50.
 *
 * O boleto, por sorte, carrega a resposta dentro dele: o valor e o vencimento
 * estão codificados no código de barras, com um dígito verificador que permite
 * CONFERIR se a leitura está certa. Então a ordem é:
 *
 *   NÍVEL 1  texto de dentro do PDF                 (nenhum palpite)
 *   NÍVEL 2  achar a linha digitável e CALCULAR     (confere pelo dígito)
 *   NÍVEL 3  OCR, só se o PDF for uma foto          (palpite conferido)
 *   NÍVEL 4  a pessoa digita                        (último recurso)
 *
 * Mesmo no nível 3 usamos o OCR só para TENTAR ler; quem diz se ele acertou é
 * a matemática do dígito verificador.
 *
 * ---------------------------------------------------------------------------
 * O QUE SAI DAQUI
 * ---------------------------------------------------------------------------
 * Duas famílias de informação, com confiabilidade bem diferente:
 *
 *   DO CÓDIGO DE BARRAS (boleto-parser.js) — matemática, confere sozinho:
 *     valor, vencimento, código de barras, linha digitável, banco
 *
 *   DO TEXTO (boleto-campos.js) — palpite educado, sempre revisável:
 *     número do documento, CNPJ da nossa empresa, CNPJ e nome do fornecedor
 *
 * O CNPJ da nossa empresa é a exceção feliz do segundo grupo: como temos a
 * lista das 213 empresas do grupo, basta conferir qual dos CNPJs do boleto
 * está nela. Isso é quase tão confiável quanto a matemática.
 */

import { CONFIG } from './config.js';
import parser from './boleto-parser.js';
import campos from './boleto-campos.js';

/* ========================================================================== *
 * Carregar bibliotecas, com endereço alternativo se um CDN cair
 * ========================================================================== */
let pdfjs = null;
let tesseract = null;

async function importarPrimeiroQueFuncionar(enderecos, oQue) {
  let ultimo = null;
  for (const endereco of enderecos) {
    try {
      return await import(/* @vite-ignore */ endereco);
    } catch (e) {
      ultimo = e;
    }
  }
  throw new Error(`Não consegui carregar ${oQue}. Último erro: ${ultimo?.message ?? '?'}`);
}

async function carregarPdfJs() {
  if (pdfjs) return pdfjs;
  const modulo = await importarPrimeiroQueFuncionar(CONFIG.CDN_PDFJS, 'o leitor de PDF');
  // O "worker" faz o trabalho pesado numa linha separada, para a página não
  // congelar enquanto lê um PDF grande.
  modulo.GlobalWorkerOptions.workerSrc = CONFIG.CDN_PDFJS_WORKER[0];
  pdfjs = modulo;
  return modulo;
}

async function carregarTesseract() {
  if (tesseract) return tesseract;
  tesseract = await importarPrimeiroQueFuncionar(CONFIG.CDN_TESSERACT, 'o reconhecimento de imagem');
  return tesseract;
}

/* ========================================================================== *
 * Ler o texto de dentro do PDF
 * ========================================================================== */
/**
 * Junta os fragmentos de texto respeitando as LINHAS.
 *
 * Este é o detalhe que faz a coisa funcionar. A pdf.js entrega o texto em
 * pedacinhos soltos, cada um com sua posição na página. Se a gente colar tudo
 * em sequência, a linha digitável vem picada ("00190 5009" de um lado e o
 * resto do outro) e nenhum padrão casa.
 *
 * Então agrupamos os fragmentos que estão na MESMA ALTURA (mesmo Y) e só
 * depois juntamos, da esquerda para a direita.
 */
function juntarPorLinhas(itens) {
  const linhas = new Map();

  for (const item of itens) {
    if (!item.str || !item.str.trim()) continue;
    const y = Math.round(item.transform[5]);
    // Tolerância de 2 pontos: quase na mesma altura é a mesma linha.
    const chave = [...linhas.keys()].find((existente) => Math.abs(existente - y) <= 2) ?? y;
    if (!linhas.has(chave)) linhas.set(chave, []);
    linhas.get(chave).push({ x: item.transform[4], texto: item.str });
  }

  return [...linhas.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, pedacos]) =>
      pedacos
        .sort((a, b) => a.x - b.x)
        .map((p) => p.texto)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .join('\n');
}

async function textoDoPdf(arquivo, aoProgredir) {
  const pdf = await carregarPdfJs();
  const bytes = new Uint8Array(await arquivo.arrayBuffer());

  const documento = await pdf.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const paginas = Math.min(documento.numPages, 5);
  const partes = [];

  for (let n = 1; n <= paginas; n += 1) {
    aoProgredir?.(`Lendo a página ${n} de ${paginas}...`);
    const pagina = await documento.getPage(n);
    const conteudo = await pagina.getTextContent();
    partes.push(juntarPorLinhas(conteudo.items));
  }

  return { texto: partes.join('\n'), documento, paginas: documento.numPages };
}

/** Transforma a primeira página num desenho, para o OCR ter o que olhar. */
async function pdfParaImagem(documento, escala = 2.6) {
  const pagina = await documento.getPage(1);
  const vista = pagina.getViewport({ scale: escala });
  const tela = document.createElement('canvas');
  tela.width = Math.floor(vista.width);
  tela.height = Math.floor(vista.height);
  await pagina.render({ canvasContext: tela.getContext('2d'), viewport: vista }).promise;
  return tela;
}

async function textoPorOcr(origem, aoProgredir) {
  const T = await carregarTesseract();
  aoProgredir?.('Reconhecendo os números da imagem... isso leva alguns segundos.');

  const { data } = await T.recognize(origem, CONFIG.IDIOMA_OCR, {
    logger: (m) => {
      if (m.status === 'recognizing text' && m.progress != null) {
        aoProgredir?.(`Reconhecendo a imagem... ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  return data?.text ?? '';
}

/* ========================================================================== *
 * O back-end, se estiver configurado
 * ========================================================================== */
async function extrairPeloBackend(arquivo) {
  if (!CONFIG.API_URL) return null;
  try {
    const corpo = new FormData();
    corpo.append('arquivo', arquivo);
    const resposta = await fetch(`${CONFIG.API_URL.replace(/\/$/, '')}/api/extracao/arquivo`, {
      method: 'POST',
      body: corpo,
    });
    if (!resposta.ok) return null;
    return await resposta.json();
  } catch {
    return null;
  }
}

/* ========================================================================== *
 * A função principal
 * ========================================================================== */
/**
 * @param {File} arquivo
 * @param {(mensagem:string)=>void} aoProgredir
 * @param {{ehNossaEmpresa?:(doc:string)=>boolean, tipoDocumento?:'NF'|'MD'|null}} opcoes
 */
export async function extrairDoArquivo(arquivo, aoProgredir, opcoes = {}) {
  const { ehNossaEmpresa = () => false, tipoDocumento = null } = opcoes;

  const ehPdf = /pdf/i.test(arquivo.type) || /\.pdf$/i.test(arquivo.name);
  let texto = '';
  let metodoTexto = 'nenhum';
  let documentoPdf = null;

  // ---------------------------------------------------------------- NÍVEL 1
  if (ehPdf) {
    aoProgredir?.('Abrindo o PDF...');
    try {
      const r = await textoDoPdf(arquivo, aoProgredir);
      texto = r.texto;
      documentoPdf = r.documento;
      metodoTexto = 'texto-do-pdf';
    } catch (erro) {
      console.warn('Não consegui ler o texto do PDF:', erro);
    }
  }

  // ------------------------------------------------------- NÍVEL 2 (cálculo)
  let doCodigo = texto ? parser.extrairDadosDeTexto(texto) : null;

  // ------------------------------------------------------------ NÍVEL 3 (OCR)
  const precisaOcr =
    CONFIG.USAR_OCR &&
    (!doCodigo?.codigoBarras || doCodigo.confianca === 'baixa') &&
    (!ehPdf || !texto.trim() || !doCodigo?.valor);

  if (precisaOcr) {
    try {
      const origem = ehPdf && documentoPdf ? await pdfParaImagem(documentoPdf) : arquivo;
      const textoOcr = await textoPorOcr(origem, aoProgredir);

      if (textoOcr.trim()) {
        const porOcr = parser.extrairDadosDeTexto(textoOcr);
        // Só trocamos se o OCR trouxe algo melhor.
        const melhorou =
          (porOcr.codigoBarras && !doCodigo?.codigoBarras) ||
          (porOcr.confianca === 'alta' && doCodigo?.confianca !== 'alta');

        if (melhorou) {
          doCodigo = porOcr;
          metodoTexto = 'ocr';
          texto = `${texto}\n${textoOcr}`;
        } else {
          // Mesmo sem melhorar o código, o texto do OCR ajuda a achar
          // CNPJ e número do documento.
          texto = `${texto}\n${textoOcr}`;
          if (metodoTexto === 'nenhum') metodoTexto = 'ocr';
        }
      }
    } catch (erro) {
      console.warn('OCR não funcionou:', erro);
    }
  }

  // ------------------------------------------------------ back-end (opcional)
  if (!doCodigo?.codigoBarras && CONFIG.API_URL) {
    aoProgredir?.('Tentando pelo servidor...');
    const doServidor = await extrairPeloBackend(arquivo);
    if (doServidor?.codigoBarras) {
      doCodigo = doServidor;
      metodoTexto = `backend:${doServidor.origem ?? '?'}`;
    }
  }

  // --------------------------------------------- os campos que vêm do texto
  aoProgredir?.('Identificando empresa, fornecedor e número do documento...');
  const doTexto = texto
    ? campos.extrairCamposDoTexto(texto, { ehNossaEmpresa, tipoDocumento })
    : {
        unidadeCnpj: null,
        fornecedorCnpj: null,
        fornecedorRazaoSocial: null,
        numeroDocumento: null,
        numeroDocumentoCandidatos: [],
        documentosEncontrados: [],
        avisos: [],
      };

  const base = doCodigo ?? {
    codigoBarras: null,
    linhaDigitavel: null,
    linhaDigitavelFormatada: null,
    valor: null,
    vencimento: null,
    banco: null,
    bancoNome: null,
    confianca: 'baixa',
    metodo: 'nenhum',
    avisos: [],
  };

  const avisos = [...(base.avisos ?? []), ...(doTexto.avisos ?? [])];

  if (!texto.trim()) {
    avisos.push('Não consegui ler nada de dentro deste arquivo. Preencha os campos à mão.');
  }

  return {
    // ---- do código de barras (matemática)
    codigoBarras: base.codigoBarras,
    linhaDigitavel: base.linhaDigitavel,
    linhaDigitavelFormatada: base.linhaDigitavelFormatada,
    valor: base.valor,
    vencimento: base.vencimento,
    vencimentoAmbiguo: base.vencimentoAmbiguo ?? false,
    banco: base.banco,
    bancoNome: base.bancoNome ?? null,
    confianca: base.confianca ?? 'baixa',
    metodo: `${metodoTexto}/${base.metodo ?? 'nenhum'}`,

    // ---- do texto (palpite educado)
    numeroDocumento: doTexto.numeroDocumento,
    numeroDocumentoTipoSugerido: doTexto.numeroDocumentoTipoSugerido,
    numeroDocumentoConfianca: doTexto.numeroDocumentoConfianca,
    numeroDocumentoCandidatos: doTexto.numeroDocumentoCandidatos ?? [],
    unidadeCnpj: doTexto.unidadeCnpj,
    fornecedorCnpj: doTexto.fornecedorCnpj,
    fornecedorRazaoSocial: doTexto.fornecedorRazaoSocial,
    fornecedorRazaoSocialConfianca: doTexto.fornecedorRazaoSocialConfianca,
    documentosEncontrados: doTexto.documentosEncontrados ?? [],

    avisos,
    textoBruto: texto.slice(0, 20000),
  };
}

/** Quando a pessoa cola a linha digitável na mão. */
export function interpretarDigitado(entrada) {
  const r = parser.interpretarCodigo(entrada);
  return {
    codigoBarras: r.codigoBarras,
    linhaDigitavel: r.linhaDigitavel,
    linhaDigitavelFormatada: r.linhaDigitavelFormatada,
    valor: r.valor,
    vencimento: r.vencimento,
    vencimentoAmbiguo: r.vencimentoAmbiguo,
    banco: r.banco,
    bancoNome: r.bancoNome ?? null,
    tipo: r.tipo,
    dvValido: r.dvValido,
    avisos: r.avisos ?? [],
  };
}
