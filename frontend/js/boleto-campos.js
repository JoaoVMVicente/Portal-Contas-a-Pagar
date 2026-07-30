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
      });
      continue;
    }
    achados.push({
      tipo: 'cnpj',
      digitos,
      dvValido: true,
      posicao: m.index,
      linha: linhaEmVolta(t, m.index),
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

  const nossos = documentos.filter((d) => d.tipo === 'cnpj' && ehNossaEmpresa(d.digitos));
  const outros = documentos.filter((d) => !nossos.includes(d));

  const avisos = [];

  if (nossos.length > 1) {
    avisos.push(
      `Achei ${nossos.length} CNPJs do grupo neste boleto. Escolhi o primeiro — confira a empresa.`
    );
  }
  if (nossos.length === 0 && documentos.length > 0) {
    avisos.push('Nenhum dos CNPJs do boleto está na planilha de empresas. Escolha a empresa à mão.');
  }
  if (outros.length > 1) {
    avisos.push(`Achei ${outros.length} CNPJs de fora do grupo. Confira o fornecedor.`);
  }

  // Último recurso: nenhum CNPJ de fornecedor passou na verificação, mas havia
  // algo com cara de CNPJ. Entregamos, avisando bem alto.
  let fornecedor = outros[0] ?? null;
  const suspeitos = (documentos.suspeitos ?? []).filter((d) => !ehNossaEmpresa(d.digitos));

  if (!fornecedor && suspeitos.length) {
    fornecedor = suspeitos[0];
    avisos.push(
      'O CNPJ do fornecedor não passou na verificação do dígito — provavelmente um número ' +
        'foi lido errado. Confira dígito por dígito antes de enviar.'
    );
  }

  return {
    unidade: nossos[0] ?? null,
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
  'NOSSO NUMERO',
  'NOSSO NUM',
  'NUMERO DO BANCO',
  'CARTEIRA',
  'AGENCIA',
  'CODIGO DE BARRAS',
  'LINHA DIGITAVEL',
  'CPF',
  'CNPJ',
  'CEP',
  'USO DO BANCO',
  'NUMERO DE REQUISICAO',
  'REQUISICAO',
];

const PADROES_NUMERO = [
  // Mais confiável: o rótulo diz explicitamente nota fiscal ou medição.
  { peso: 100, re: /\b(?:NOTA\s+FISCAL|NF-?E?|NFS-?E?)\s*(?:N[º°O.]?\s*|NUMERO\s*|:\s*)?([0-9][0-9./-]{2,19})/g, tipo: 'NF' },
  { peso: 100, re: /\b(?:MEDICAO|MEDICOES|MD)\s*(?:N[º°O.]?\s*|NUMERO\s*|:\s*)?([0-9][0-9./-]{2,19})/g, tipo: 'MD' },
  // Rótulo padrão da ficha de compensação.
  { peso: 80, re: /\bN[º°O.]?\s*(?:DO\s+)?DOCUMENTO\s*[:\-]?\s*([0-9][0-9./-]{2,19})/g, tipo: null },
  { peso: 80, re: /\bNUMERO\s+DO\s+DOCUMENTO\s*[:\-]?\s*([0-9][0-9./-]{2,19})/g, tipo: null },
  { peso: 70, re: /\bDOCUMENTO\s*[:\-]\s*([0-9][0-9./-]{2,19})/g, tipo: null },
  // Aparece no campo de demonstrativo/instruções: "REF NF 8821".
  { peso: 60, re: /\bREF(?:ERENTE|\.)?\s*(?:A\s*)?(?:NF|NOTA)\s*[:\-]?\s*([0-9][0-9./-]{2,19})/g, tipo: 'NF' },
  { peso: 40, re: /\bFATURA\s*(?:N[º°O.]?\s*)?[:\-]?\s*([0-9][0-9./-]{2,19})/g, tipo: null },
];

/**
 * Devolve os candidatos a número do documento, do mais provável ao menos.
 * @returns {{numero:string, tipoSugerido:'NF'|'MD'|null, peso:number, contexto:string}[]}
 */
export function acharNumerosDeDocumento(texto) {
  const t = semAcento(texto).replace(/\u00a0/g, ' ');
  const candidatos = [];

  for (const padrao of PADROES_NUMERO) {
    padrao.re.lastIndex = 0;
    let m;
    while ((m = padrao.re.exec(t)) !== null) {
      const cru = m[1];
      const contexto = linhaEmVolta(t, m.index);

      // Se a linha fala de algo que não queremos, descartamos.
      if (ROTULOS_IGNORAR.some((r) => contexto.includes(r) && !contexto.includes('NOTA'))) continue;

      const limpo = cru.replace(/[^0-9]/g, '');
      if (!limpo || limpo.length < 2 || limpo.length > 15) continue;

      // Um número de 14 dígitos é CNPJ, não nota. De 11, pode ser CPF.
      if (limpo.length === 14 && cnpjValido(limpo)) continue;
      if (limpo.length === 11 && cpfValido(limpo)) continue;

      // Só zeros não serve.
      if (/^0+$/.test(limpo)) continue;

      candidatos.push({
        numero: limpo.replace(/^0+(?=\d)/, ''), // tira zeros à esquerda
        tipoSugerido: padrao.tipo,
        peso: padrao.peso,
        contexto: contexto.slice(0, 90),
      });
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
const ROTULOS_BENEFICIARIO = [
  'BENEFICIARIO',
  'CEDENTE',
  'FAVORECIDO',
  'NOME DO BENEFICIARIO',
  'BENEFICIARIO FINAL',
];

const SUFIXOS_EMPRESA = /\b(S\.?\s?A\.?|LTDA|ME|EIRELI|EPP|MEI|S\/A|SOCIEDADE|COMERCIO|SERVICOS|ENGENHARIA|CONSTRUTORA|TRANSPORTES|INDUSTRIA)\b/;

/**
 * Tenta achar o nome do fornecedor.
 *
 * Duas estratégias, na ordem:
 *   1. Uma linha que começa com "Beneficiário" e tem um nome depois.
 *   2. A linha onde o CNPJ do fornecedor apareceu — o nome quase sempre está
 *      ao lado dele. Tiramos o CNPJ e a pontuação e vemos o que sobra.
 */
export function acharRazaoSocialFornecedor(texto, cnpjFornecedorDigitos = null) {
  const linhas = String(texto ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Estratégia 1: pelo rótulo.
  for (const linha of linhas) {
    const normal = semAcento(linha);
    const rotulo = ROTULOS_BENEFICIARIO.find((r) => normal.startsWith(r));
    if (!rotulo) continue;

    let resto = linha.slice(rotulo.length).replace(/^[\s:.\-–]+/, '');
    resto = limparNome(resto);
    if (resto.length >= 4) {
      return { nome: resto, confianca: 'media', origem: `rotulo:${rotulo.toLowerCase()}` };
    }
  }

  // Estratégia 2: pela linha do CNPJ do fornecedor.
  if (cnpjFornecedorDigitos) {
    const alvo = somenteDigitos(cnpjFornecedorDigitos);
    for (const linha of linhas) {
      if (somenteDigitos(linha).includes(alvo)) {
        const nome = limparNome(linha);
        if (nome.length >= 4) {
          return { nome, confianca: 'baixa', origem: 'linha-do-cnpj' };
        }
      }
    }
  }

  // Estratégia 3: qualquer linha que pareça razão social de empresa.
  for (const linha of linhas.slice(0, 30)) {
    if (SUFIXOS_EMPRESA.test(semAcento(linha))) {
      const nome = limparNome(linha);
      if (nome.length >= 6 && nome.length <= 70) {
        return { nome, confianca: 'baixa', origem: 'formato-de-razao-social' };
      }
    }
  }

  return { nome: null, confianca: 'baixa', origem: 'nao-encontrado' };
}

/** Tira do texto tudo que claramente não faz parte de um nome de empresa. */
function limparNome(texto) {
  return String(texto ?? '')
    .replace(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g, ' ') // CNPJ
    .replace(/\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}/g, ' ')            // CPF
    .replace(/\b(CNPJ|CPF|CNPJ\/CPF|AGENCIA|CODIGO|COD)\b\.?:?/gi, ' ')
    .replace(/\d{4,}/g, ' ')                                            // números longos
    .replace(/[|;]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.\-–:]+|[\s.\-–:]+$/g, '')
    .trim();
}

/* ========================================================================== *
 * 5. Tudo junto
 * ========================================================================== */
/**
 * O pacote completo do que se consegue tirar do TEXTO (fora do código de
 * barras, que é trabalho do boleto-parser.js).
 */
export function extrairCamposDoTexto(texto, { ehNossaEmpresa = () => false, tipoDocumento = null } = {}) {
  const documentos = separarEmpresaEFornecedor(texto, ehNossaEmpresa);
  const numeros = acharNumerosDeDocumento(texto);
  const fornecedor = acharRazaoSocialFornecedor(texto, documentos.fornecedor?.digitos ?? null);

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
};
