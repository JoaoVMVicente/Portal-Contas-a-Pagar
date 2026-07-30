/**
 * boleto-campos.js — Garimpar CNPJ, número do documento e nome do fornecedor
 * de dentro do texto do boleto.
 * ---------------------------------------------------------------------------
 * Separei isto do boleto-parser.js de propósito, e vale explicar por quê.
 *
 * O boleto-parser faz MATEMÁTICA: pega os 44 dígitos do código de barras e
 * CALCULA valor e vencimento, conferindo pelo dígito verificador. O resultado
 * é certo ou errado, sem meio-termo.
 *
 * Este arquivo faz PALPITE EDUCADO: procura padrões no texto ("Beneficiário:",
 * "Nº documento", um CNPJ solto) e tenta adivinhar o que é o quê. Não existe
 * dígito verificador para "o nome do fornecedor". Então cada coisa que sai
 * daqui vem com um nível de confiança, e a tela sempre deixa a pessoa corrigir.
 *
 * Misturar as duas coisas no mesmo arquivo faria parecer que têm a mesma
 * confiabilidade. Não têm.
 *
 * ===========================================================================
 * A IDEIA MAIS ÚTIL DESTE ARQUIVO
 * ===========================================================================
 * Um boleto tem DOIS CNPJs: o do beneficiário (o fornecedor, quem recebe) e o
 * do pagador (a empresa da Serena, quem paga). Descobrir qual é qual lendo os
 * rótulos é frágil, porque cada banco escreve diferente.
 *
 * Só que nós temos a lista das 213 empresas do grupo. Então:
 *
 *   CNPJ que ESTÁ na nossa lista   -> é a nossa empresa (o pagador)
 *   CNPJ que NÃO está na lista     -> é o fornecedor
 *
 * Isso não depende de rótulo, não depende de layout, não depende de OCR ler a
 * palavra "Beneficiário" corretamente. Depende só de conferir uma lista.
 * É de longe a parte mais confiável da leitura de texto.
 */

/* ========================================================================== *
 * Ferramentas
 * ========================================================================== */
export function somenteDigitos(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

export function semAcento(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function cnpjValido(entrada) {
  const c = somenteDigitos(entrada);
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

export function cpfValido(entrada) {
  const c = somenteDigitos(entrada);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(c[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    if ((resto === 10 ? 0 : resto) !== Number(c[tamanho])) return false;
  }
  return true;
}

/* ========================================================================== *
 * 1. Todos os CNPJs (e CPFs) que aparecem no texto
 * ========================================================================== */
/**
 * Devolve os documentos encontrados, em ordem de aparição, sem repetir.
 * Cada item traz a posição no texto e a linha inteira onde apareceu — a linha
 * é o que usamos depois para tentar pescar o nome ao lado do número.
 */
export function acharDocumentosNoTexto(texto) {
  const t = String(texto ?? '');
  const achados = [];
  const suspeitos = [];
  const jaVistos = new Set();

  // CNPJ com ou sem pontuação. Aceitamos separadores frouxos porque o PDF às
  // vezes entrega "12.345.678 / 0001-90" com espaços no meio.
  const padraoCnpj = /(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})/g;
  let m;
  while ((m = padraoCnpj.exec(t)) !== null) {
    const digitos = m.slice(1).join('');
    if (jaVistos.has(digitos)) continue;
    jaVistos.add(digitos);

    // DV que não fecha: guardamos à parte. Um OCR que troca um dígito é comum,
    // e é bem mais fácil a pessoa corrigir um número quase certo do que digitar
    // os catorze. Mas nunca misturamos com os conferidos.
    if (!cnpjValido(digitos)) {
      suspeitos.push({
        tipo: 'cnpj',
        digitos,
        dvValido: false,
        posicao: m.index,
        linha: linhaEmVolta(t, m.index),
        linhaAnterior: linhaAcima(t, m.index),
        textoAntes: textoAntesNaLinha(t, m.index),
      });
      continue;
    }
    achados.push({
      tipo: 'cnpj',
      digitos,
      dvValido: true,
      posicao: m.index,
      linha: linhaEmVolta(t, m.index),
      linhaAnterior: linhaAcima(t, m.index),
      textoAntes: textoAntesNaLinha(t, m.index),
    });
  }

  // CPF: fornecedor pessoa física existe, ainda que raro.
  const padraoCpf = /(?<![\d./-])(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})(?![\d./-])/g;
  while ((m = padraoCpf.exec(t)) !== null) {
    const digitos = m.slice(1).join('');
    if (!cpfValido(digitos) || jaVistos.has(digitos)) continue;
    jaVistos.add(digitos);
    achados.push({
      tipo: 'cpf',
      digitos,
      dvValido: true,
      posicao: m.index,
      linha: linhaEmVolta(t, m.index),
      linhaAnterior: linhaAcima(t, m.index),
      textoAntes: textoAntesNaLinha(t, m.index),
    });
  }

  achados.sort((a, b) => a.posicao - b.posicao);
  suspeitos.sort((a, b) => a.posicao - b.posicao);
  achados.suspeitos = suspeitos;
  return achados;
}

/** A linha de texto inteira em volta de uma posição. */
function linhaEmVolta(texto, posicao) {
  const inicio = texto.lastIndexOf('\n', posicao) + 1;
  let fim = texto.indexOf('\n', posicao);
  if (fim === -1) fim = texto.length;
  return texto.slice(inicio, fim).trim();
}

/** O trecho da linha que vem ANTES da posição. */
function textoAntesNaLinha(texto, posicao) {
  const inicio = texto.lastIndexOf('\n', posicao) + 1;
  return texto.slice(inicio, posicao).trim();
}

/** A linha imediatamente acima. É onde os boletos põem os rótulos. */
function linhaAcima(texto, posicao) {
  const inicioAtual = texto.lastIndexOf('\n', posicao) + 1;
  if (inicioAtual <= 1) return '';
  const inicioAnterior = texto.lastIndexOf('\n', inicioAtual - 2) + 1;
  return texto.slice(inicioAnterior, inicioAtual - 1).trim();
}

/* ========================================================================== *
 * Rótulos: quem é o pagador (nós) e quem é o beneficiário (o fornecedor)
 * ========================================================================== *
 * Um boleto tem sempre os dois, e cada banco escreve de um jeito. Esta é a
 * segunda pista que usamos para separar um do outro — a primeira é conferir
 * qual CNPJ está na nossa planilha.
 *
 * Detalhe do layout que só aparece num boleto real: o rótulo costuma ficar na
 * LINHA DE CIMA, não na mesma linha do valor. No boleto do Banco do Brasil, a
 * caixa é assim:
 *
 *     Nome do Beneficiário / Endereço      CNPJ         Nosso Número
 *     TEM TUDO COMERCIAL DE MATERIAL...    27.591...    00003286977...
 *
 * Por isso olhamos a linha atual E a de cima.
 */
const ROTULOS_DE_BENEFICIARIO = [
  'BENEFICIARIO', 'CEDENTE', 'FAVORECIDO', 'CREDOR', 'EMITENTE',
];

const ROTULOS_DE_PAGADOR = [
  'PAGADOR', 'SACADO', 'DEVEDOR', 'CLIENTE', 'TOMADOR',
];

/**
 * Diz se um documento aparece sob rótulo de beneficiário ou de pagador.
 * @returns {'beneficiario'|'pagador'|null}
 */
function classificarPeloRotulo(doc) {
  const contexto = semAcento(`${doc.linhaAnterior} ${doc.linha}`);

  // "Beneficiário Final" é outra coisa: é um campo que quase sempre vem vazio,
  // e confundir com o beneficiário de verdade daria o nome errado.
  const temBeneficiario = ROTULOS_DE_BENEFICIARIO.some(
    (r) => contexto.includes(r) && !contexto.includes(`${r} FINAL`)
  );
  const temPagador = ROTULOS_DE_PAGADOR.some((r) => contexto.includes(r));

  // Os dois na mesma vizinhança não decide nada.
  if (temBeneficiario && temPagador) return null;
  if (temBeneficiario) return 'beneficiario';
  if (temPagador) return 'pagador';
  return null;
}

/* ========================================================================== *
 * 2. Separar "nossa empresa" de "fornecedor"
 * ========================================================================== */
/**
 * @param {string} texto        O texto do boleto.
 * @param {(doc:string)=>boolean} ehNossaEmpresa
 *        Função que responde "este documento é de uma empresa do grupo?".
 *        Quem passa isso é o módulo contas.js, que tem a lista das 213.
 */
export function separarEmpresaEFornecedor(texto, ehNossaEmpresa) {
  const documentos = acharDocumentosNoTexto(texto);
  const suspeitos = documentos.suspeitos ?? [];
  const avisos = [];

  // Marcamos cada documento com as duas pistas que temos.
  const marcar = (d) => ({
    ...d,
    nosso: d.tipo === 'cnpj' && ehNossaEmpresa(d.digitos),
    rotulo: classificarPeloRotulo(d),
  });

  const todos = documentos.map(marcar);
  const todosSuspeitos = suspeitos.map(marcar);

  /* ------------------------------------------------------------------ *
   * A NOSSA EMPRESA (o pagador)
   * ------------------------------------------------------------------ *
   * Ordem de confiança:
   *   1. está na planilha (considerando a raiz do CNPJ)  -> certeza
   *   2. aparece sob rótulo de pagador                   -> boa pista
   * ------------------------------------------------------------------ */
  const naPlanilha = todos.filter((d) => d.nosso);
  const sobRotuloDePagador = todos.filter((d) => !d.nosso && d.rotulo === 'pagador');

  let unidade = naPlanilha[0] ?? null;

  if (!unidade && sobRotuloDePagador.length) {
    unidade = sobRotuloDePagador[0];
    avisos.push(
      'O CNPJ que aparece como pagador não está na planilha de empresas. ' +
        'Confira a unidade de negócio antes de enviar.'
    );
  }

  if (naPlanilha.length > 1) {
    const distintos = new Set(naPlanilha.map((d) => d.digitos));
    if (distintos.size > 1) {
      avisos.push(
        `Achei ${distintos.size} CNPJs do grupo neste boleto. Escolhi o primeiro — confira a empresa.`
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * O FORNECEDOR (o beneficiário)
   * ------------------------------------------------------------------ *
   * Ordem de confiança:
   *   1. aparece sob rótulo de beneficiário E não é do grupo  -> certeza
   *   2. não é do grupo, sem rótulo                           -> palpite
   *   3. tem cara de CNPJ mas o dígito não fecha              -> último recurso
   *
   * O passo 1 é o que consertou o boleto do Banco do Brasil: sem ele, quando
   * a nossa empresa não era reconhecida, ela virava "o primeiro de fora" e ia
   * para o campo do fornecedor.
   * ------------------------------------------------------------------ */
  const idUnidade = unidade?.digitos;
  const deFora = todos.filter((d) => !d.nosso && d.digitos !== idUnidade);

  let fornecedor =
    deFora.find((d) => d.rotulo === 'beneficiario') ??
    deFora.find((d) => d.rotulo !== 'pagador') ??
    null;

  if (!fornecedor) {
    const suspeitosDeFora = todosSuspeitos.filter(
      (d) => !d.nosso && d.digitos !== idUnidade && d.rotulo !== 'pagador'
    );
    if (suspeitosDeFora.length) {
      fornecedor = suspeitosDeFora.find((d) => d.rotulo === 'beneficiario') ?? suspeitosDeFora[0];
      avisos.push(
        'O CNPJ do fornecedor não passou na verificação do dígito — provavelmente um número ' +
          'foi lido errado. Confira dígito por dígito antes de enviar.'
      );
    }
  }

  const candidatosAFornecedor = new Set(deFora.map((d) => d.digitos));
  if (candidatosAFornecedor.size > 1 && fornecedor?.rotulo !== 'beneficiario') {
    avisos.push(
      `Achei ${candidatosAFornecedor.size} CNPJs de fora do grupo e nenhum sob rótulo de ` +
        'beneficiário. Confira o fornecedor.'
    );
  }

  if (!unidade && !naPlanilha.length && todos.length) {
    avisos.push('Nenhum CNPJ do boleto bate com a planilha de empresas. Escolha a empresa à mão.');
  }

  return {
    unidade,
    fornecedor,
    todos: documentos,
    suspeitos,
    avisos,
  };
}

/* ========================================================================== *
 * 3. O número do documento (a NF ou a MD)
 * ========================================================================== */
/**
 * Os rótulos variam muito de banco para banco, e o mesmo boleto costuma ter
 * vários campos parecidos. A ordem abaixo é por CONFIANÇA, não por frequência:
 * um rótulo que diz "nota fiscal" vale mais que um genérico "documento".
 *
 * Cuidado importante: "Nosso número" NÃO é o número da nota. É o identificador
 * que o banco dá ao boleto. Confundir os dois é o erro clássico aqui, então
 * ele está na lista de coisas a IGNORAR.
 */
const ROTULOS_IGNORAR = [
  'NOSSO NUMERO', 'NOSSO NUM', 'NUMERO DO BANCO', 'CARTEIRA', 'AGENCIA',
  'CODIGO DE BARRAS', 'LINHA DIGITAVEL', 'CEP', 'USO DO BANCO',
  'NUMERO DE REQUISICAO', 'REQUISICAO', 'CODIGO DO BENEFICIARIO',
];

/**
 * As formas de escrever "número". Cada banco escolhe uma:
 *   Nº  N°  No  N.  Nr  Nr.  Num  Num.  Numero
 * Faltar uma delas é o suficiente para não achar o campo — foi o que
 * aconteceu com o boleto do Banco do Brasil, que escreve "Nr. do Documento".
 */
const N_DE_NUMERO = '(?:N[º°O]?\\.?|NR\\.?|NUM\\.?|NUMERO)';

const PADROES_NUMERO = [
  // Mais confiável: o rótulo diz explicitamente nota fiscal ou medição.
  { peso: 100, re: new RegExp(`\\b(?:NOTA\\s+FISCAL|NF-?E?|NFS-?E?)\\s*(?:${N_DE_NUMERO}\\s*|:\\s*)?([0-9][0-9./-]{2,19})`, 'g'), tipo: 'NF' },
  { peso: 100, re: new RegExp(`\\b(?:MEDICAO|MEDICOES)\\s*(?:${N_DE_NUMERO}\\s*|:\\s*)?([0-9][0-9./-]{2,19})`, 'g'), tipo: 'MD' },
  // Rótulo padrão da ficha de compensação.
  { peso: 80, re: new RegExp(`\\b${N_DE_NUMERO}\\s*(?:DO\\s+)?DOCUMENTO\\s*[:\\-]?\\s*([0-9][0-9./-]{2,19})`, 'g'), tipo: null },
  { peso: 70, re: /\bDOCUMENTO\s*[:\-]\s*([0-9][0-9./-]{2,19})/g, tipo: null },
  // Campo de demonstrativo: "REF NF 8821".
  { peso: 60, re: /\bREF(?:ERENTE|\.)?\s*(?:A\s*)?(?:NF|NOTA)\s*[:\-]?\s*([0-9][0-9./-]{2,19})/g, tipo: 'NF' },
  { peso: 40, re: new RegExp(`\\bFATURA\\s*(?:${N_DE_NUMERO}\\s*)?[:\\-]?\\s*([0-9][0-9./-]{2,19})`, 'g'), tipo: null },
];

/** Rótulos que, quando aparecem sozinhos, mandam olhar a linha de baixo. */
const RE_ROTULO_SOZINHO = new RegExp(`\\b${N_DE_NUMERO}\\s*(?:DO\\s+)?DOCUMENTO\\b`);

const RE_DATA = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const RE_DINHEIRO = /^\d{1,3}(\.\d{3})*,\d{2}$/;

/** Um candidato a número de documento precisa passar por aqui. */
function numeroPlausivel(bruto) {
  const limpo = String(bruto).replace(/[^0-9]/g, '');
  if (!limpo || limpo.length < 2 || limpo.length > 15) return null;
  if (/^0+$/.test(limpo)) return null;
  // 14 dígitos válidos é CNPJ; 11 pode ser CPF. Nenhum dos dois é nota.
  if (limpo.length === 14 && cnpjValido(limpo)) return null;
  if (limpo.length === 11 && cpfValido(limpo)) return null;
  return limpo.replace(/^0+(?=\d)/, '');
}

/**
 * Devolve os candidatos a número do documento, do mais provável ao menos.
 *
 * DUAS ARMADILHAS TRATADAS AQUI, as duas descobertas num boleto real:
 *
 * 1. "Nosso número" NÃO é o número da nota. É o identificador que o banco dá
 *    ao boleto. Confundir os dois é o erro clássico, então ele está na lista
 *    de rótulos a ignorar.
 *
 * 2. O valor quase nunca está na mesma linha do rótulo. No layout do Banco do
 *    Brasil, os rótulos ficam numa faixa e os valores na faixa de baixo:
 *
 *        Uso do Banco   Nr. do Documento   Espécie Doc.   Aceite
 *                       44597              DM             N
 *
 *    Então, quando achamos o rótulo sem valor ao lado, olhamos a linha
 *    seguinte e pegamos o primeiro número que não seja data, dinheiro,
 *    CNPJ nem "nosso número" (que é longo).
 */
export function acharNumerosDeDocumento(texto) {
  const t = semAcento(texto).replace(/\u00a0/g, ' ');
  const linhas = t.split('\n');
  const candidatos = [];

  // ---- padrões com rótulo e valor na mesma linha ----
  for (const padrao of PADROES_NUMERO) {
    padrao.re.lastIndex = 0;
    let m;
    while ((m = padrao.re.exec(t)) !== null) {
      const contexto = linhaEmVolta(t, m.index);
      if (ROTULOS_IGNORAR.some((r) => contexto.includes(r) && !contexto.includes('NOTA'))) continue;

      const numero = numeroPlausivel(m[1]);
      if (!numero) continue;

      candidatos.push({
        numero,
        tipoSugerido: padrao.tipo,
        peso: padrao.peso,
        contexto: contexto.slice(0, 90),
      });
    }
  }

  // ---- rótulo numa linha, valor na linha de baixo ----
  for (let i = 0; i < linhas.length - 1; i += 1) {
    const linha = linhas[i];
    if (!RE_ROTULO_SOZINHO.test(linha)) continue;

    // Se o próprio rótulo já veio com número, os padrões acima resolveram.
    const depoisDoRotulo = linha.slice(linha.search(RE_ROTULO_SOZINHO));
    if (/\d/.test(depoisDoRotulo.replace(RE_ROTULO_SOZINHO, ''))) continue;

    for (const pedaco of linhas[i + 1].trim().split(/\s+/)) {
      if (RE_DATA.test(pedaco) || RE_DINHEIRO.test(pedaco)) continue;
      if (!/^[0-9][0-9./-]*$/.test(pedaco)) continue;

      const numero = numeroPlausivel(pedaco);
      if (!numero) continue;
      // "Nosso número" costuma ter 11 dígitos ou mais nessa posição.
      if (numero.length > 10) continue;

      candidatos.push({
        numero,
        tipoSugerido: null,
        peso: 85,
        contexto: `${linha.slice(0, 45)} -> ${linhas[i + 1].slice(0, 40)}`,
      });
      break; // o primeiro plausível da linha é o da coluna certa
    }
  }

  // Junta repetidos, mantendo o de maior peso.
  const porNumero = new Map();
  for (const c of candidatos) {
    const atual = porNumero.get(c.numero);
    if (!atual || c.peso > atual.peso) porNumero.set(c.numero, c);
  }

  return [...porNumero.values()].sort((a, b) => b.peso - a.peso);
}

/* ========================================================================== *
 * 4. A razão social do fornecedor
 * ========================================================================== */
const SUFIXOS_EMPRESA =
  /\b(S\.?\s?A\.?|LTDA|ME|EIRELI|EPP|MEI|S\/A|SOCIEDADE|COMERCIO|COMERCIAL|SERVICOS|ENGENHARIA|CONSTRUTORA|TRANSPORTES|INDUSTRIA|MATERIAL|MATERIAIS|DISTRIBUIDORA)\b/;

/**
 * Acha a razão social do fornecedor.
 *
 * A ESTRATÉGIA PRINCIPAL, e por que ela é boa
 * -------------------------------------------
 * O nome vem SEMPRE antes do CNPJ, na mesma linha. Olhe o boleto do Banco do
 * Brasil:
 *
 *     TEM TUDO COMERCIAL DE MATERIAL DE CONSTR   27.591.360/0001-61   00003286...
 *     └──────────── o nome está aqui ─────────┘  └── o CNPJ ───────┘  └ resto ┘
 *
 * Então basta cortar a linha na posição do CNPJ e ficar com o lado esquerdo.
 *
 * A primeira versão pegava a linha inteira e tentava limpar o que não era
 * nome. Isso trouxe lixo: no campo do pagador, a linha é
 *
 *     DELTA 7 1 ENERGIA S.A   30.866.542/0002-93   03/08/2026
 *
 * e a data de vencimento — que fica na mesma faixa, numa caixa ao lado —
 * entrava no nome, virando "DELTA 7 1 ENERGIA S.A 03/08/". Cortando no CNPJ,
 * tudo que vem depois é descartado de graça.
 */
export function acharRazaoSocialFornecedor(texto, documentoFornecedor = null) {
  // Estratégia 1: o texto imediatamente antes do CNPJ, na mesma linha.
  if (documentoFornecedor?.textoAntes) {
    const nome = limparNome(documentoFornecedor.textoAntes);
    if (nome.length >= 4) {
      return { nome, confianca: 'media', origem: 'antes-do-cnpj' };
    }
  }

  const linhas = String(texto ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Estratégia 2: rótulo de beneficiário, com o valor na linha de baixo.
  for (let i = 0; i < linhas.length; i += 1) {
    const normal = semAcento(linhas[i]);
    const temRotulo = ROTULOS_DE_BENEFICIARIO.some(
      (r) => normal.includes(r) && !normal.includes(`${r} FINAL`)
    );
    if (!temRotulo) continue;

    // Primeiro tenta o resto da própria linha, depois a linha seguinte.
    const posicao = normal.search(/BENEFICIARIO|CEDENTE|FAVORECIDO|CREDOR|EMITENTE/);
    const restoDaLinha = limparNome(linhas[i].slice(posicao).replace(/^\S+/, ''));
    if (restoDaLinha.length >= 6 && SUFIXOS_EMPRESA.test(semAcento(restoDaLinha))) {
      return { nome: restoDaLinha, confianca: 'media', origem: 'rotulo-mesma-linha' };
    }

    const abaixo = limparNome(linhas[i + 1] ?? '');
    if (abaixo.length >= 4) {
      return { nome: abaixo, confianca: 'media', origem: 'rotulo-linha-de-baixo' };
    }
  }

  // Estratégia 3: qualquer linha com cara de razão social.
  for (const linha of linhas.slice(0, 30)) {
    if (!SUFIXOS_EMPRESA.test(semAcento(linha))) continue;
    const nome = limparNome(linha);
    if (nome.length >= 6 && nome.length <= 70) {
      return { nome, confianca: 'baixa', origem: 'formato-de-razao-social' };
    }
  }

  return { nome: null, confianca: 'baixa', origem: 'nao-encontrado' };
}

/**
 * Palavras de rótulo que aparecem grudadas no nome e precisam sair.
 *
 * A comparação é feita SEM ACENTO, porque cada banco escreve de um jeito:
 * "Beneficiário", "BENEFICIARIO", "Beneficiario". Guardar as três formas na
 * lista seria fácil de esquecer — normalizar na comparação não é.
 *
 * O nome de saída mantém os acentos: "Construções Silva" precisa continuar
 * "Construções Silva".
 */
const PALAVRAS_DE_ROTULO = new Set([
  'CNPJ', 'CPF', 'AGENCIA', 'CODIGO', 'COD', 'ENDERECO', 'NOME', 'NOSSO',
  'NUMERO', 'NUM', 'NR', 'VENCIMENTO', 'DATA', 'BENEFICIARIO', 'BENEFICIARIA',
  'CEDENTE', 'FAVORECIDO', 'CREDOR', 'EMITENTE', 'PAGADOR', 'SACADO',
  'DEVEDOR', 'TOMADOR', 'CEP', 'DOCUMENTO', 'VALOR', 'ESPECIE', 'ACEITE',
  'CARTEIRA', 'PROCESSAMENTO', 'LOCAL', 'PAGAMENTO',
]);

/**
 * Tira do texto tudo que claramente não faz parte de um nome de empresa:
 * documentos, datas, CEP, números longos e as palavras de rótulo.
 *
 * A ordem importa. Primeiro saem os padrões (CNPJ, datas), depois as palavras,
 * depois a pontuação que sobrou nas beiradas.
 */
function limparNome(texto) {
  const semPadroes = String(texto ?? '')
    // documentos
    .replace(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g, ' ')
    .replace(/\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}/g, ' ')
    // datas em qualquer forma, inclusive incompletas ("03/08/")
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]?/g, ' ')
    // CEP
    .replace(/\bCEP[:\s]*\d{5}-?\d{3}\b/gi, ' ')
    // números longos (nosso número, código de barras, agência/conta)
    .replace(/\d{4,}/g, ' ')
    .replace(/[|;()]+/g, ' ');

  // Agora as palavras, comparando sem acento e sem pontuação.
  const limpo = semPadroes
    .split(/\s+/)
    .filter((palavra) => {
      const chave = semAcento(palavra).replace(/[^A-Z0-9]/g, '');
      if (!chave) return false;
      return !PALAVRAS_DE_ROTULO.has(chave);
    })
    .join(' ');

  return limpo.replace(/^[\s./\-–:]+|[\s./\-–:]+$/g, '').trim();
}

/* ========================================================================== *
 * 5. Tudo junto
 * ========================================================================== */
/**
 * O pacote completo do que se consegue tirar do TEXTO (fora do código de
 * barras, que é trabalho do boleto-parser.js).
 */
/**
 * Tira o carimbo que navegador e cliente de e-mail põem ao imprimir em PDF.
 * Foi o que fez uma fatura da Enel devolver a data da IMPRESSÃO como
 * vencimento — um número plausível, no campo certo, e nada avisando.
 */
const LINHAS_DE_CARIMBO = [
  /^\s*https?:\/\/\S+\s*(\d+\s*\/\s*\d+)?\s*$/i,
  /\boutlook\b/i,
  /caixa de entrada/i,
  /\bgmail\b/i,
  /\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}/,
  /^\s*\d+\s*\/\s*\d+\s*$/,
  /javascript:|about:blank/i,
];

export function limparCarimboDeImpressao(texto) {
  return String(texto ?? '')
    .split('\n')
    .filter((linha) => !LINHAS_DE_CARIMBO.some((padrao) => padrao.test(linha)))
    .join('\n');
}

export function extrairCamposDoTexto(texto, { ehNossaEmpresa = () => false, tipoDocumento = null } = {}) {
  const limpo = limparCarimboDeImpressao(texto);
  const documentos = separarEmpresaEFornecedor(limpo, ehNossaEmpresa);
  const numeros = acharNumerosDeDocumento(limpo);
  const fornecedor = acharRazaoSocialFornecedor(limpo, documentos.fornecedor ?? null);

  // Se sabemos que é NF, um candidato marcado como NF vale mais.
  const numerosOrdenados = tipoDocumento
    ? [...numeros].sort((a, b) => {
        const bonus = (c) => (c.tipoSugerido === tipoDocumento ? 50 : 0);
        return b.peso + bonus(b) - (a.peso + bonus(a));
      })
    : numeros;

  const escolhido = numerosOrdenados[0] ?? null;

  return {
    unidadeCnpj: documentos.unidade?.digitos ?? null,
    unidadeConferida: documentos.unidade?.nosso ?? false,
    fornecedorCnpj: documentos.fornecedor?.digitos ?? null,
    fornecedorCnpjConferido: documentos.fornecedor?.dvValido ?? false,
    fornecedorTipoDocumento: documentos.fornecedor?.tipo ?? null,
    fornecedorRazaoSocial: fornecedor.nome,
    fornecedorRazaoSocialConfianca: fornecedor.confianca,
    numeroDocumento: escolhido?.numero ?? null,
    numeroDocumentoTipoSugerido: escolhido?.tipoSugerido ?? null,
    numeroDocumentoConfianca: escolhido ? (escolhido.peso >= 80 ? 'media' : 'baixa') : 'baixa',
    numeroDocumentoCandidatos: numerosOrdenados.slice(0, 5),
    documentosEncontrados: documentos.todos.map((d) => ({ tipo: d.tipo, digitos: d.digitos })),
    avisos: documentos.avisos,
  };
}

export default {
  somenteDigitos,
  semAcento,
  cnpjValido,
  cpfValido,
  acharDocumentosNoTexto,
  separarEmpresaEFornecedor,
  acharNumerosDeDocumento,
  acharRazaoSocialFornecedor,
  extrairCamposDoTexto,
  limparCarimboDeImpressao,
};
