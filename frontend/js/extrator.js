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
import grafico from './leitor-grafico.js';
import { acharEmpresaNoTexto } from './contas.js';

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

  const modulo = await importarPrimeiroQueFuncionar(
    CONFIG.CDN_TESSERACT,
    'o reconhecimento de imagem'
  );

  /* ------------------------------------------------------------------------ *
   * Onde as funções realmente estão
   * ------------------------------------------------------------------------ *
   * Este foi um bug meu que só apareceu no navegador, e de um jeito silencioso:
   *
   *     OCR não funcionou: TypeError: T.recognize is not a function
   *
   * Eu chamava `T.recognize(...)` supondo que o módulo exportasse a função
   * direto. O Tesseract.js v5 publica um build ESM cujo conteúdo fica em
   * `default` — então o caminho é `T.default.recognize`.
   *
   * Como o erro caía num catch que só escrevia no console, o boleto voltava sem
   * os nomes e ninguém sabia por quê. Custou uma rodada inteira de diagnóstico.
   *
   * Aqui aceitamos as duas formas: se o dia em que eles mudarem o empacotamento
   * chegar, isto continua funcionando.
   * ------------------------------------------------------------------------ */
  const alvo =
    typeof modulo?.recognize === 'function'
      ? modulo
      : typeof modulo?.default?.recognize === 'function'
        ? modulo.default
        : null;

  if (!alvo) {
    throw new Error(
      'A biblioteca de reconhecimento de imagem carregou, mas não achei a função ' +
        `recognize nela. Exportou: ${Object.keys(modulo ?? {}).join(', ') || '(nada)'}.`
    );
  }

  tesseract = alvo;
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
/**
 * Desenha as primeiras páginas do PDF, para o leitor de códigos gráficos.
 *
 * A escala importa mais do que parece. Nos testes com a fatura da Enel, o
 * código de barras só foi decodificado a partir de 3x — a 2x as barras finas
 * se fundiam e a biblioteca não achava nada. Por outro lado, escalas muito
 * altas geram imagens de dezenas de megapixels e travam máquinas modestas.
 * Por isso tentamos 2x primeiro (rápido, resolve a maioria) e só subimos
 * para 3x se não encontrarmos o código de barras.
 */
async function paginasParaImagem(documento, escala, maximoDePaginas) {
  const telas = [];
  const paginas = Math.min(documento.numPages, maximoDePaginas);

  for (let n = 1; n <= paginas; n += 1) {
    const pagina = await documento.getPage(n);
    const vista = pagina.getViewport({ scale: escala });
    const tela = document.createElement('canvas');
    tela.width = Math.floor(vista.width);
    tela.height = Math.floor(vista.height);
    await pagina.render({
      canvasContext: tela.getContext('2d', { willReadFrequently: true }),
      viewport: vista,
    }).promise;
    telas.push(tela);
  }
  return telas;
}

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

  // ---------------------------------------------------------------- NÍVEL 0
  // Os códigos DESENHADOS no boleto: código de barras e QR codes.
  //
  // Vem antes de tudo porque é a leitura mais confiável que existe: esses
  // desenhos são feitos para máquina ler, com detecção de erro embutida. Ou
  // decodificam certo, ou não decodificam — não existe "quase".
  //
  // E funciona no caso que quebrava tudo: PDF que é só imagem. Não importa se
  // há texto dentro do arquivo; o desenho está lá do mesmo jeito.
  let doGrafico = null;

  if (ehPdf && documentoPdf) {
    for (const escala of [2, 3]) {
      try {
        aoProgredir?.('Procurando o código de barras...');
        const telas = await paginasParaImagem(
          documentoPdf,
          escala,
          CONFIG.PAGINAS_PARA_LER_CODIGOS
        );
        doGrafico = await grafico.lerCodigosDasPaginas(telas, aoProgredir);
        // Libera a memória das telas assim que possível.
        telas.forEach((t) => { t.width = 0; t.height = 0; });
        if (doGrafico?.codigoBarras) break;
      } catch (erro) {
        console.warn('Leitura dos códigos gráficos falhou:', erro);
      }
    }
  } else if (!ehPdf) {
    // Imagem solta (foto ou print): desenhamos num canvas e lemos igual.
    try {
      aoProgredir?.('Procurando o código de barras...');
      const bitmap = await createImageBitmap(arquivo);
      const tela = document.createElement('canvas');
      tela.width = bitmap.width;
      tela.height = bitmap.height;
      tela.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0);
      doGrafico = await grafico.lerCodigosDasPaginas([tela], aoProgredir);
      bitmap.close?.();
    } catch (erro) {
      console.warn('Leitura dos códigos gráficos falhou:', erro);
    }
  }

  // ------------------------------------------------------- NÍVEL 2 (cálculo)
  let doCodigo = texto ? parser.extrairDadosDeTexto(texto) : null;

  // O código de barras lido do desenho ganha de qualquer coisa vinda do texto.
  if (doGrafico?.codigoBarras) {
    const doDesenho = parser.interpretarCodigo(doGrafico.codigoBarras);
    if (doDesenho?.codigoBarras) {
      doCodigo = {
        ...doDesenho,
        confianca: doDesenho.dvValido ? 'alta' : 'media',
        metodo: 'codigo-de-barras-da-imagem',
        avisos: doDesenho.avisos ?? [],
      };
      metodoTexto = 'codigo-grafico';
    }
  }

  // ------------------------------------------------------------ NÍVEL 3 (OCR)
  /* ---------------------------------------------------------------------- *
   * Quando o OCR precisa rodar
   * ---------------------------------------------------------------------- *
   * A versão anterior pulava o OCR sempre que o código de barras havia sido
   * decodificado do desenho. Parecia economia — e era um erro que custou os
   * campos mais difíceis.
   *
   * Boleto que é imagem tem código de barras perfeitamente legível pelo leitor
   * gráfico, então valor e vencimento saíam certos. Mas NÃO tem texto: nome da
   * empresa, nome do fornecedor e CNPJs ficavam vazios, e o OCR — o único
   * caminho para eles — nunca era chamado.
   *
   * Medindo em onze boletos reais: os três que falharam eram exatamente esses,
   * PDF sem camada de texto e com o código de barras lido. Rodando o OCR neles,
   * os nove campos que faltavam foram recuperados.
   *
   * A regra certa não é "o código de barras deu certo?", é "tenho texto
   * suficiente para garimpar os nomes?". Um boleto com camada de texto de
   * verdade tem alguns milhares de caracteres; os três que falharam tinham 76,
   * 139 e 395 — só cabeçalho de impressão.
   */
  let erroDoOcr = null;
  const TEXTO_MINIMO = 600;

  // Não dá para consultar o garimpo aqui: ele roda depois. Mas não precisa —
  // dois sinais bastam e são baratos. Texto curto não tem nome de empresa
  // dentro. E texto sem nenhum CNPJ não tem CNPJ para achar.
  const textoLimpo = texto.trim();
  const temAlgumCnpj = /\d{2}[.,:\s]?\d{3}[.,:\s]?\d{3}\s?[/\s]?\s?\d{4}/.test(textoLimpo);
  const textoInsuficiente = textoLimpo.length < TEXTO_MINIMO || !temAlgumCnpj;

  const precisaOcr =
    CONFIG.USAR_OCR &&
    (
      // Nada de código de barras: o OCR pode ser o único caminho para tudo.
      (!doGrafico?.codigoBarras &&
        (!doCodigo?.codigoBarras || doCodigo.confianca === 'baixa')) ||
      // Ou: temos o código de barras, mas não temos texto para os nomes.
      textoInsuficiente
    );

  // Guardamos o que aconteceu com o OCR para poder dizer na tela. Antes, uma
  // falha de carregamento do Tesseract virava um console.warn que ninguém lia —
  // e o boleto voltava sem os nomes, sem explicação nenhuma.
  let situacaoOcr = precisaOcr ? 'tentando' : 'nao-precisou';

  if (precisaOcr) {
    try {
      const origem = ehPdf && documentoPdf ? await pdfParaImagem(documentoPdf) : arquivo;
      const textoOcr = await textoPorOcr(origem, aoProgredir);

      situacaoOcr = textoOcr.trim() ? 'funcionou' : 'nao-leu-nada';

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
      situacaoOcr = 'falhou';
      erroDoOcr = erro?.message ?? String(erro);
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

  /* ---------------------------------------------------------------------- *
   * Os QR codes preenchem o que o texto não conseguiu
   * ---------------------------------------------------------------------- *
   * Ordem de preferência: o que veio do texto primeiro (porque ali sabemos o
   * contexto — qual rótulo, qual linha), e o QR code como reserva. A exceção
   * é o número da nota: a chave fiscal é o número OFICIAL do documento, então
   * ela ganha de um palpite de rótulo.
   */
  const avisos = [...(base.avisos ?? []), ...(doTexto.avisos ?? [])];
  const doQr = { usados: [] };

  if (doGrafico?.fiscal) {
    const f = doGrafico.fiscal;

    // O CNPJ de quem emitiu a nota é o do fornecedor, salvo se for do grupo.
    if (!doTexto.fornecedorCnpj && !ehNossaEmpresa(f.cnpjEmitente)) {
      doTexto.fornecedorCnpj = f.cnpjEmitente;
      doTexto.fornecedorCnpjConferido = true;
      doQr.usados.push('CNPJ do fornecedor');
    }

    // O número da nota vindo da chave fiscal é oficial, não é palpite.
    if (f.numeroNota && f.numeroNota !== '0') {
      doTexto.numeroDocumento = f.numeroNota;
      doTexto.numeroDocumentoConfianca = 'alta';
      doQr.usados.push('número da nota');
    }

    // Se a nota é do nosso grupo, o CNPJ dela identifica a nossa empresa.
    if (!doTexto.unidadeCnpj && ehNossaEmpresa(f.cnpjEmitente)) {
      doTexto.unidadeCnpj = f.cnpjEmitente;
    }
  }

  /* ---------------------------------------------------------------------- *
   * A nossa empresa pelo NOME, quando o CNPJ não deu
   * ---------------------------------------------------------------------- *
   * Último recurso, e vale só para a NOSSA empresa: o nome dela está na nossa
   * planilha, então casar por nome é consulta, não palpite. Para fornecedor
   * não daria — não temos a lista deles (ainda).
   */
  if (!doTexto.unidadeCnpj && texto.trim()) {
    try {
      const achado = await acharEmpresaNoTexto(texto);
      if (achado) {
        doTexto.unidadeCnpj = achado.empresa.documento;
        doTexto.unidadePorNome = achado.nomeQueCasou;
        avisos.push(
          `O boleto não trouxe um CNPJ do grupo legível. Identifiquei a empresa pelo nome ` +
            `"${achado.nomeQueCasou}" — confira se está certo.`
        );
        if (achado.ambiguo) {
          avisos.push('Mais de uma empresa do grupo casou com o nome. Confira com atenção.');
        }
      }
    } catch (erro) {
      console.warn('Busca da empresa por nome falhou:', erro);
    }
  }

  if (doGrafico?.pix) {
    const p = doGrafico.pix;
    if (!doTexto.fornecedorRazaoSocial && p.nomeRecebedor) {
      doTexto.fornecedorRazaoSocial = p.nomeRecebedor;
      doTexto.fornecedorRazaoSocialConfianca = 'media';
      doQr.usados.push('nome do fornecedor');
    }
    // O valor do PIX serve de conferência quando não temos código de barras.
    if (base.valor == null && p.valor != null) {
      base.valor = p.valor;
      doQr.usados.push('valor');
    }
  }


  if (doGrafico?.codigoBarras) {
    avisos.push('Valor e vencimento vieram do código de barras lido da imagem, e o dígito verificador fechou.');
  }
  if (doQr.usados.length) {
    avisos.push(`Do QR code eu aproveitei: ${doQr.usados.join(', ')}.`);
  }
  if (situacaoOcr === 'falhou') {
    avisos.push(
      'Este boleto é uma imagem e eu precisava da leitura ótica para achar os nomes, ' +
        `mas ela não carregou (${erroDoOcr}). Empresa e fornecedor podem ter ficado em ` +
        'branco. Recarregar a página costuma resolver.'
    );
  } else if (situacaoOcr === 'nao-leu-nada') {
    avisos.push(
      'Este boleto é uma imagem e a leitura ótica não decifrou nada dela. Se o arquivo ' +
        'estiver muito claro, torto ou de baixa resolução, uma cópia melhor ajudaria.'
    );
  } else if (situacaoOcr === 'funcionou') {
    avisos.push(
      'Este boleto é uma imagem: empresa e fornecedor vieram de leitura ótica, que erra ' +
        'mais que texto. Vale conferir esses dois.'
    );
  }

  if (!doGrafico?.codigoBarras && ehPdf && texto.trim().length < 400) {
    avisos.push(
      'Este PDF quase não tem texto — provavelmente é uma imagem. Confira todos os campos com atenção.'
    );
  }

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
    // Vai para a coluna extracao_metodo do banco. É o que permite consultar
    // depois quantos boletos passaram por leitura ótica, e quantos falharam
    // nela — informação que antes se perdia num console.warn.
    metodo: `${metodoTexto}/${base.metodo ?? 'nenhum'}${
      situacaoOcr === 'funcionou'
        ? '+ocr'
        : situacaoOcr === 'falhou'
          ? '+ocr-falhou'
          : situacaoOcr === 'nao-leu-nada'
            ? '+ocr-vazio'
            : ''
    }`,

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

    // O que os códigos gráficos entregaram, para a tela poder mostrar
    codigosGraficos: doGrafico
      ? {
          codigoBarras: doGrafico.codigoBarras,
          pix: doGrafico.pix,
          fiscal: doGrafico.fiscal,
          quantidade: doGrafico.brutos?.length ?? 0,
        }
      : null,

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
