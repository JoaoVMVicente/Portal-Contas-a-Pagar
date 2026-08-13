/**
 * boleto-parser.js
 * ---------------------------------------------------------------------------
 * Biblioteca PURA (sem dependências, sem acesso a rede) que entende boletos
 * brasileiros. É usada tanto pelo front-end (navegador) quanto pelo back-end
 * (Node), por isso não usa nada específico de um ambiente.
 *
 * O que ela faz:
 *   1. Acha a "linha digitável" dentro de um texto solto (o texto que o pdf.js
 *      ou o OCR extraiu do arquivo).
 *   2. Valida essa linha com dígito verificador (módulo 10 / módulo 11).
 *   3. Converte linha digitável (47 ou 48 dígitos) em código de barras (44).
 *   4. Tira de dentro do código de barras o VALOR e o VENCIMENTO.
 *
 * Por que isso é melhor que "OCR do valor":
 *   O valor e o vencimento estão CODIFICADOS dentro do próprio código de
 *   barras, com dígito verificador. Ou seja: se o DV fecha, o número está
 *   certo. É determinístico, não é "chute" de leitura de imagem.
 *
 * Referências: layout FEBRABAN de boleto de cobrança (47 dígitos) e de
 * arrecadação/convênio (48 dígitos, começa com 8).
 * ---------------------------------------------------------------------------
 */

/* ========================================================================== *
 * 1. Helpers de dígito verificador
 * ========================================================================== */

/** Deixa só os números de uma string. */
export function somenteDigitos(txt) {
  return String(txt ?? '').replace(/\D+/g, '');
}

/**
 * Módulo 10 (usado nos blocos da linha digitável de cobrança).
 * Multiplica da direita para a esquerda por 2,1,2,1... Se der 10+, soma os
 * algarismos. O DV é o que falta para a próxima dezena.
 */
export function modulo10(bloco) {
  const d = somenteDigitos(bloco);
  let soma = 0;
  let peso = 2;
  for (let i = d.length - 1; i >= 0; i--) {
    let p = Number(d[i]) * peso;
    if (p > 9) p -= 9;
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/**
 * Módulo 11 com pesos 2..9 (DV geral do código de barras de cobrança).
 * Resultado 0, 10 ou 11 vira 1, por convenção FEBRABAN.
 */
export function modulo11Cobranca(base43) {
  const d = somenteDigitos(base43);
  let soma = 0;
  let peso = 2;
  for (let i = d.length - 1; i >= 0; i--) {
    soma += Number(d[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/**
 * Módulo 11 de arrecadação (pesos 2..9, mas a regra do resultado é outra).
 */
export function modulo11Arrecadacao(base) {
  const d = somenteDigitos(base);
  let soma = 0;
  let peso = 2;
  for (let i = d.length - 1; i >= 0; i--) {
    soma += Number(d[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  if (resto === 0) return 0;
  if (resto === 1) return 1;
  return 11 - resto;
}

/** Módulo 10 usado nos blocos de arrecadação. */
export function modulo10Arrecadacao(bloco) {
  return modulo10(bloco);
}

/* ========================================================================== *
 * 2. Fator de vencimento -> data
 * ========================================================================== */

/**
 * O boleto não guarda a data "12/07/2026". Ele guarda um NÚMERO de 4 dígitos
 * chamado fator de vencimento, que é a quantidade de dias desde 07/10/1997
 * (esse dia é o fator 1000).
 *
 * Problema: o contador só vai até 9999, o que aconteceu em 21/02/2025. A
 * FEBRABAN definiu que depois disso ele volta para 1000 (em 22/02/2025).
 * Então um fator como 1522 é ambíguo: pode ser 2001 ou 2026.
 *
 * Solução: calculamos as duas datas possíveis e escolhemos a que faz sentido
 * para um boleto (perto de hoje). Boleto de 2001 não existe na prática.
 */
const BASE_CICLO_1 = Date.UTC(1997, 9, 7); // data-base: fator 0. Fator 1000 = 03/07/2000
const BASE_CICLO_2 = Date.UTC(2025, 1, 22); // 22/02/2025 = fator 1000 (reinício do ciclo)
const UM_DIA_MS = 86400000;

/**
 * Versão detalhada: além da data, diz se houve ambiguidade entre os dois
 * ciclos. Regra: um boleto de verdade vence perto de hoje. Definimos uma
 * "janela plausível" de 5 anos para trás e 3 anos para frente.
 *   - Só um dos dois ciclos cai na janela -> é esse, sem dúvida.
 *   - Os dois caem na janela -> pega o mais perto de hoje e avisa.
 *   - Nenhum cai na janela -> pega o mais perto e marca como ambíguo.
 */
export function fatorVencimentoDetalhado(fator, hoje = new Date()) {
  const f = Number(somenteDigitos(fator));
  if (!f || f < 1 || f > 9999) return { data: null, ambiguo: false, ciclo: null };

  const c1 = new Date(BASE_CICLO_1 + f * UM_DIA_MS);
  const c2 = new Date(BASE_CICLO_2 + (f - 1000) * UM_DIA_MS);

  const pisoJanela = hoje.getTime() - 5 * 365.25 * UM_DIA_MS;
  const tetoJanela = hoje.getTime() + 3 * 365.25 * UM_DIA_MS;
  const plausivel = (d) => d.getTime() >= pisoJanela && d.getTime() <= tetoJanela;

  const p1 = plausivel(c1);
  const p2 = f >= 1000 && plausivel(c2);

  if (p1 && !p2) return { data: c1, ambiguo: false, ciclo: 1 };
  if (p2 && !p1) return { data: c2, ambiguo: false, ciclo: 2 };

  const dist = (d) => Math.abs(d.getTime() - hoje.getTime());
  const escolhido = dist(c1) <= dist(c2) ? { data: c1, ciclo: 1 } : { data: c2, ciclo: 2 };
  return { ...escolhido, ambiguo: true };
}

/** Versão simples: só a data. */
export function fatorVencimentoParaData(fator, hoje = new Date()) {
  return fatorVencimentoDetalhado(fator, hoje).data;
}

/** Data -> 'YYYY-MM-DD' (formato que o Postgres gosta). */
export function paraISODate(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return null;
  return data.toISOString().slice(0, 10);
}

/* ========================================================================== *
 * 3. Conversões linha digitável <-> código de barras
 * ========================================================================== */

/** Cobrança: 47 dígitos da linha digitável -> 44 do código de barras. */
export function linha47ParaCodigo44(linha47) {
  const l = somenteDigitos(linha47);
  if (l.length !== 47) return null;
  const banco = l.slice(0, 3);
  const moeda = l.slice(3, 4);
  const dvGeral = l.slice(32, 33);
  const fatorEValor = l.slice(33, 47); // 4 de fator + 10 de valor
  const campoLivre = l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31); // 25
  return banco + moeda + dvGeral + fatorEValor + campoLivre;
}

/** Cobrança: 44 do código de barras -> 47 da linha digitável. */
export function codigo44ParaLinha47(codigo44) {
  const c = somenteDigitos(codigo44);
  if (c.length !== 44) return null;
  const banco = c.slice(0, 3);
  const moeda = c.slice(3, 4);
  const dvGeral = c.slice(4, 5);
  const fatorEValor = c.slice(5, 19);
  const livre = c.slice(19, 44);

  const c1 = banco + moeda + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);

  return (
    c1 + modulo10(c1) + c2 + modulo10(c2) + c3 + modulo10(c3) + dvGeral + fatorEValor
  );
}

/** Arrecadação: 48 dígitos -> 44 (tira o DV de cada bloco de 12). */
export function linha48ParaCodigo44(linha48) {
  const l = somenteDigitos(linha48);
  if (l.length !== 48) return null;
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += l.slice(i * 12, i * 12 + 11); // 11 dígitos, descarta o 12º (DV)
  }
  return out.length === 44 ? out : null;
}

/** Arrecadação: 44 -> 48. */
export function codigo44ParaLinha48(codigo44) {
  const c = somenteDigitos(codigo44);
  if (c.length !== 44) return null;
  const usaModulo10 = c[2] === '6' || c[2] === '7';
  let out = '';
  for (let i = 0; i < 4; i++) {
    const bloco = c.slice(i * 11, i * 11 + 11);
    const dv = usaModulo10 ? modulo10Arrecadacao(bloco) : modulo11Arrecadacao(bloco);
    out += bloco + dv;
  }
  return out;
}

/* ========================================================================== *
 * 4. Validação
 * ========================================================================== */

export function validarCobranca47(linha47) {
  const l = somenteDigitos(linha47);
  if (l.length !== 47) return false;
  const c1 = l.slice(0, 9);
  const c2 = l.slice(10, 20);
  const c3 = l.slice(21, 31);
  if (modulo10(c1) !== Number(l[9])) return false;
  if (modulo10(c2) !== Number(l[20])) return false;
  if (modulo10(c3) !== Number(l[31])) return false;

  const codigo = linha47ParaCodigo44(l);
  const base43 = codigo.slice(0, 4) + codigo.slice(5);
  return modulo11Cobranca(base43) === Number(codigo[4]);
}

export function validarArrecadacao48(linha48) {
  const l = somenteDigitos(linha48);
  if (l.length !== 48 || l[0] !== '8') return false;
  const codigo = linha48ParaCodigo44(l);
  if (!codigo) return false;
  const usaModulo10 = codigo[2] === '6' || codigo[2] === '7';
  const base = codigo.slice(0, 3) + codigo.slice(4);
  const dvEsperado = usaModulo10 ? modulo10(base) : modulo11Arrecadacao(base);
  return dvEsperado === Number(codigo[3]);
}

/* ========================================================================== *
 * 4b. Nome do banco a partir dos três primeiros dígitos
 * ========================================================================== *
 * Isto é só conveniência para a tela: é bem mais útil ler "Banco do Brasil"
 * do que "001". Se o código não estiver na lista, devolvemos null e a tela
 * mostra o número mesmo — nunca inventamos um nome.
 */

export const NOMES_DE_BANCOS = {
  '001': 'Banco do Brasil',
  '003': 'Banco da Amazônia',
  '004': 'Banco do Nordeste',
  '021': 'Banestes',
  '033': 'Santander',
  '036': 'Banco Bradesco BBI',
  '037': 'Banpará',
  '041': 'Banrisul',
  '047': 'Banco do Estado de Sergipe',
  '070': 'BRB — Banco de Brasília',
  '077': 'Banco Inter',
  '084': 'Uniprime Norte do Paraná',
  '085': 'Cecred / Ailos',
  '097': 'Credisis',
  '099': 'Uniprime',
  '104': 'Caixa Econômica Federal',
  '107': 'Banco Bocom BBM',
  '121': 'Banco Agibank',
  '136': 'Unicred',
  '151': 'Banco Nossa Caixa',
  '197': 'Stone',
  '208': 'Banco BTG Pactual',
  '212': 'Banco Original',
  '218': 'Banco BS2',
  '222': 'Banco Credit Agricole',
  '224': 'Banco Fibra',
  '237': 'Bradesco',
  '246': 'Banco ABC Brasil',
  '260': 'Nu Pagamentos (Nubank)',
  '274': 'Money Plus',
  '290': 'PagSeguro',
  '318': 'Banco BMG',
  '320': 'China Construction Bank',
  '323': 'Mercado Pago',
  '336': 'Banco C6',
  '341': 'Itaú Unibanco',
  '364': 'Gerencianet',
  '380': 'PicPay',
  '389': 'Banco Mercantil do Brasil',
  '399': 'HSBC',
  '422': 'Banco Safra',
  '461': 'Asaas',
  '473': 'Banco Caixa Geral',
  '479': 'Banco ItauBank',
  '505': 'Banco Credit Suisse',
  '604': 'Banco Industrial do Brasil',
  '611': 'Banco Paulista',
  '612': 'Banco Guanabara',
  '613': 'Omni Banco',
  '623': 'Banco PAN',
  '633': 'Banco Rendimento',
  '637': 'Banco Sofisa',
  '652': 'Itaú Unibanco Holding',
  '653': 'Banco Voiter',
  '655': 'Banco Votorantim',
  '707': 'Banco Daycoval',
  '741': 'Banco Ribeirão Preto',
  '745': 'Citibank',
  '746': 'Banco Modal',
  '748': 'Sicredi',
  '751': 'Scotiabank Brasil',
  '755': 'Bank of America Merrill Lynch',
  '756': 'Sicoob',
  '757': 'Banco KEB Hana',
};

/**
 * Devolve o nome do banco, ou null se não conhecermos o código.
 * @param {string|null} codigo Os três primeiros dígitos do código de barras.
 */
export function nomeDoBanco(codigo) {
  if (!codigo) return null;
  const chave = somenteDigitos(codigo).slice(0, 3).padStart(3, '0');
  return NOMES_DE_BANCOS[chave] ?? null;
}

/* ========================================================================== *
 * 5. Interpretação: tirar valor e vencimento de dentro do código
 * ========================================================================== */

/**
 * Recebe uma linha digitável (47 ou 48 dígitos) OU um código de barras (44)
 * e devolve tudo o que conseguir entender.
 *
 * @returns {{
 *   ok: boolean, tipo: 'cobranca'|'arrecadacao'|null,
 *   linhaDigitavel: string|null, codigoBarras: string|null,
 *   linhaDigitavelFormatada: string|null,
 *   valor: number|null, vencimento: string|null,
 *   banco: string|null, dvValido: boolean, avisos: string[]
 * }}
 */
export function interpretarCodigo(entrada, hoje = new Date()) {
  const d = somenteDigitos(entrada);
  const r = {
    ok: false,
    tipo: null,
    linhaDigitavel: null,
    codigoBarras: null,
    linhaDigitavelFormatada: null,
    valor: null,
    vencimento: null,
    banco: null,
    bancoNome: null,
    dvValido: false,
    vencimentoAmbiguo: false,
    avisos: [],
  };
  if (!d) return r;

  let linha = null;
  let codigo = null;

  if (d.length === 47) {
    r.tipo = 'cobranca';
    linha = d;
    codigo = linha47ParaCodigo44(d);
  } else if (d.length === 48) {
    r.tipo = 'arrecadacao';
    linha = d;
    codigo = linha48ParaCodigo44(d);
  } else if (d.length === 44) {
    if (d[0] === '8') {
      r.tipo = 'arrecadacao';
      codigo = d;
      linha = codigo44ParaLinha48(d);
    } else {
      r.tipo = 'cobranca';
      codigo = d;
      linha = codigo44ParaLinha47(d);
    }
  } else {
    r.avisos.push(`Tamanho inesperado: ${d.length} dígitos (esperado 44, 47 ou 48).`);
    return r;
  }

  r.linhaDigitavel = linha;
  r.codigoBarras = codigo;

  if (r.tipo === 'cobranca') {
    r.dvValido = validarCobranca47(linha);
    r.banco = codigo.slice(0, 3);
    r.bancoNome = nomeDoBanco(r.banco);

    const fator = codigo.slice(5, 9);
    const centavos = Number(codigo.slice(9, 19));
    r.valor = centavos > 0 ? centavos / 100 : null;
    if (r.valor === null) r.avisos.push('Boleto sem valor fixo no código de barras.');

    const venc = fatorVencimentoDetalhado(fator, hoje);
    r.vencimento = paraISODate(venc.data);
    r.vencimentoAmbiguo = venc.ambiguo;
    if (venc.ambiguo) {
      r.avisos.push(
        'O fator de vencimento pode se referir a dois ciclos diferentes (o contador FEBRABAN reiniciou em 22/02/2025). Confira a data no boleto.'
      );
    }
    if (fator === '0000') {
      r.vencimento = null;
      r.avisos.push('Boleto sem data de vencimento no código de barras.');
    }
    r.linhaDigitavelFormatada = formatarLinha47(linha);
  } else {
    r.dvValido = validarArrecadacao48(linha);
    const centavos = Number(codigo.slice(4, 15));
    r.valor = centavos > 0 ? centavos / 100 : null;
    r.vencimento = null;
    r.avisos.push(
      'Guia de arrecadação/convênio não carrega vencimento no código de barras — precisa ser preenchido à mão.'
    );
    r.linhaDigitavelFormatada = formatarLinha48(linha);
  }

  if (!r.dvValido) r.avisos.push('Dígito verificador não fechou — confira o número.');
  r.ok = Boolean(r.codigoBarras) && r.dvValido;
  return r;
}

/** 00000.00000 00000.000000 00000.000000 0 00000000000000 */
export function formatarLinha47(l) {
  const d = somenteDigitos(l);
  if (d.length !== 47) return d;
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`;
}

/** 4 blocos de 12 separados por espaço. */
export function formatarLinha48(l) {
  const d = somenteDigitos(l);
  if (d.length !== 48) return d;
  return [d.slice(0, 12), d.slice(12, 24), d.slice(24, 36), d.slice(36, 48)].join(' ');
}

/* ========================================================================== *
 * 6. Encontrar a linha digitável dentro de um texto grande
 * ========================================================================== */

/**
 * Estratégia em 3 camadas, da mais confiável para a menos:
 *   A) Procura o padrão "bonito" (com pontos e espaços) que os PDFs usam.
 *   B) Procura sequências longas de dígitos linha por linha.
 *   C) Junta TODO o texto num único número gigante e varre em janelas de
 *      47/48/44 dígitos, aceitando só o que passar no DV.
 */
export function acharCodigoNoTexto(texto, hoje = new Date()) {
  const candidatos = [];
  const txt = String(texto ?? '');

  const add = (valor, origem) => {
    const d = somenteDigitos(valor);
    if (d.length === 44 || d.length === 47 || d.length === 48) {
      candidatos.push({ digitos: d, origem });
    }
  };

  // --- Camada A: padrão formatado de cobrança
  const reFormatada =
    /(\d{5})[.\s-]?(\d{5})\s*[.\s-]?\s*(\d{5})[.\s-]?(\d{6})\s*[.\s-]?\s*(\d{5})[.\s-]?(\d{6})\s*[.\s-]?\s*(\d)\s*[.\s-]?\s*(\d{14})/g;
  for (const m of txt.matchAll(reFormatada)) add(m.slice(1).join(''), 'padrao-formatado');

  // --- Camada A2: padrão formatado de arrecadação (8xxxx.xxxxx ...)
  const reArrec = /(8\d{10})[-\s.]?(\d)\s*(\d{11})[-\s.]?(\d)\s*(\d{11})[-\s.]?(\d)\s*(\d{11})[-\s.]?(\d)/g;
  for (const m of txt.matchAll(reArrec)) add(m.slice(1).join(''), 'padrao-arrecadacao');

  // --- Camada B: linha por linha
  for (const linha of txt.split(/[\r\n]+/)) {
    const d = somenteDigitos(linha);
    if (d.length === 44 || d.length === 47 || d.length === 48) add(d, 'linha-inteira');
  }

  // --- Camada C: varredura em janela
  const tudo = somenteDigitos(txt);
  if (tudo.length >= 44) {
    for (const tam of [47, 48, 44]) {
      for (let i = 0; i + tam <= tudo.length; i++) {
        const janela = tudo.slice(i, i + tam);
        const okCobranca = tam !== 48 && validarCobranca47(tam === 44 ? codigo44ParaLinha47(janela) : janela);
        const okArrec = janela[0] === '8' && (tam === 48 ? validarArrecadacao48(janela) : false);
        if (okCobranca || okArrec) candidatos.push({ digitos: janela, origem: 'varredura' });
      }
    }
  }

  // Interpreta cada candidato e devolve o melhor (DV válido ganha sempre).
  const vistos = new Set();
  const resultados = [];
  for (const c of candidatos) {
    const chave = c.digitos;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const info = interpretarCodigo(c.digitos, hoje);
    if (info.codigoBarras) resultados.push({ ...info, origem: c.origem });
  }

  resultados.sort((a, b) => {
    if (a.dvValido !== b.dvValido) return a.dvValido ? -1 : 1;
    const pontos = (x) => (x.valor ? 2 : 0) + (x.vencimento ? 1 : 0);
    return pontos(b) - pontos(a);
  });

  return resultados[0] ?? null;
}

/* ========================================================================== *
 * 7. Rede de segurança: ler valor e vencimento do texto (quando o código falha)
 * ========================================================================== */

export function acharValorNoTexto(texto) {
  const txt = String(texto ?? '');
  const re = /(?:R\$|VALOR\s*(?:DO\s*)?(?:DOCUMENTO|COBRADO)?\s*:?)\s*([\d.]{1,15},\d{2})/gi;
  const achados = [...txt.matchAll(re)].map((m) =>
    Number(m[1].replace(/\./g, '').replace(',', '.'))
  );
  const validos = achados.filter((v) => Number.isFinite(v) && v > 0);
  return validos.length ? Math.max(...validos) : null;
}

/**
 * O vencimento escrito no papel, para quando o código de barras não traz.
 *
 * QUANDO ISSO ACONTECE
 * --------------------
 * O código de barras guarda o vencimento num campo de quatro dígitos chamado
 * fator. Quando o fator é 0000, a especificação FEBRABAN diz que o boleto NÃO
 * tem vencimento codificado — e aí não há o que calcular.
 *
 * Acontece em fatura de concessionária. Numa da Equatorial Maranhão o código
 * trazia o valor certo, R$ 101,42, e fator 0000. O vencimento estava só
 * impresso, na ficha de compensação.
 *
 * O CUIDADO COM A SEGUNDA DATA
 * ----------------------------
 * Essa mesma fatura tinha DUAS datas:
 *
 *   Vencimento 24/03/2026    no cabeçalho da conta
 *   VENCIMENTO 25/03/2026    na ficha de compensação
 *
 * A segunda é a que vale para pagar — é a que o banco vai cobrar. Por isso
 * procuramos primeiro na parte de baixo do documento, depois da linha
 * digitável, e só caímos para o resto do texto se não acharmos nada lá.
 */
export function acharVencimentoNoTexto(texto) {
  const linhas = String(texto ?? '').split('\n');

  // Onde começa a ficha de compensação.
  //
  // Só a LINHA DIGITÁVEL serve como marca, nunca uma sequência solta de 44
  // dígitos: a chave de acesso da nota fiscal eletrônica também tem 44, e numa
  // fatura da Equatorial ela aparecia bem no topo do documento. Usá-la como
  // início da ficha fazia a busca começar antes da conta e pegar a data errada
  // — 24/03 em vez de 25/03, que é a que o banco cobra.
  const RE_FICHA =
    /\d{5}[.\s]?\d{5}\s+\d{5}[.\s]?\d{6}\s+\d{5}[.\s]?\d{6}\s+\d\s+\d{14}/;
  const linhaDaFicha = linhas.findIndex((l) => RE_FICHA.test(l));

  const RE_DATA = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/;

  const paraData = (m) => {
    if (!m) return null;
    const [, dd, mm, aaaaRaw] = m;
    const dia = Number(dd);
    const mes = Number(mm);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
    const aaaa = aaaaRaw.length === 2 ? `20${aaaaRaw}` : aaaaRaw;
    return paraISODate(new Date(Date.UTC(Number(aaaa), mes - 1, dia)));
  };

  /**
   * Procura por rótulo dentro de uma faixa de linhas.
   *
   * O rótulo costuma ficar numa linha e o valor na de baixo — é assim que os
   * bancos desenham as caixas da ficha. Procurar por distância em caracteres
   * não funciona: numa fatura da Equatorial havia 45 caracteres entre
   * "VENCIMENTO" e a data, e uma janela de 40 perdia a data certa.
   *
   * "REAVISO DE VENCIMENTO" fica de fora: é uma caixa informativa, quase
   * sempre vazia, e casar com ela traria a data errada.
   */
  const procurarComRotulo = (de, ate) => {
    for (let i = de; i < ate; i += 1) {
      const linha = linhas[i];
      if (!/VENCIMENTO/i.test(linha)) continue;
      if (/REAVISO/i.test(linha)) continue;

      // Na própria linha, depois do rótulo.
      const depois = linha.slice(linha.search(/VENCIMENTO/i));
      const naLinha = paraData(depois.match(RE_DATA));
      if (naLinha) return naLinha;

      // Ou na linha de baixo.
      const abaixo = paraData((linhas[i + 1] ?? '').match(RE_DATA));
      if (abaixo) return abaixo;
    }
    return null;
  };

  // A ficha de compensação primeiro.
  //
  // Uma fatura de concessionária costuma ter DUAS datas: a do cabeçalho da
  // conta e a da ficha. Na Equatorial eram 24/03 e 25/03. A da ficha é a que
  // o banco vai cobrar, então é ela que vale.
  if (linhaDaFicha >= 0) {
    const naFicha = procurarComRotulo(linhaDaFicha, linhas.length);
    if (naFicha) return naFicha;
  }

  const emQualquerLugar = procurarComRotulo(0, linhas.length);
  if (emQualquerLugar) return emQualquerLugar;

  // Último recurso: qualquer data completa no documento. Pouco confiável —
  // pode ser emissão, processamento ou leitura de medidor.
  for (const linha of linhas) {
    const solta = paraData(linha.match(/\b(\d{2})[/\-.](\d{2})[/\-.](\d{4})\b/));
    if (solta) return solta;
  }
  return null;
}

/* ========================================================================== *
 * 8. Função principal usada pelo app
 * ========================================================================== */

/**
 * Recebe o texto extraído do arquivo e devolve o "pacote" que o formulário
 * do cliente precisa preencher, já com um nível de confiança.
 *
 * confianca:
 *   'alta'   -> achou código de barras com DV válido (pode confiar)
 *   'media'  -> achou código mas o DV não fechou, ou só achou por texto
 *   'baixa'  -> não achou nada, precisa digitar
 */
export function extrairDadosDeTexto(texto, hoje = new Date()) {
  const achado = acharCodigoNoTexto(texto, hoje);
  const resultado = {
    codigoBarras: achado?.codigoBarras ?? null,
    linhaDigitavel: achado?.linhaDigitavel ?? null,
    linhaDigitavelFormatada: achado?.linhaDigitavelFormatada ?? null,
    tipoCodigo: achado?.tipo ?? null,
    banco: achado?.banco ?? null,
    bancoNome: nomeDoBanco(achado?.banco ?? null),
    valor: achado?.valor ?? null,
    vencimento: achado?.vencimento ?? null,
    vencimentoAmbiguo: achado?.vencimentoAmbiguo ?? false,
    confianca: 'baixa',
    metodo: 'nenhum',
    avisos: achado?.avisos ? [...achado.avisos] : [],
  };

  if (achado?.dvValido) {
    resultado.confianca = 'alta';
    resultado.metodo = `codigo-barras:${achado.origem}`;
  } else if (achado) {
    resultado.confianca = 'media';
    resultado.metodo = `codigo-barras-sem-dv:${achado.origem}`;
  }

  // Completa os buracos usando o texto.
  if (resultado.valor == null) {
    const v = acharValorNoTexto(texto);
    if (v != null) {
      resultado.valor = v;
      resultado.metodo += '+valor-texto';
      if (resultado.confianca === 'baixa') resultado.confianca = 'media';
      resultado.avisos.push('Valor lido do texto do boleto, não do código de barras. Confira.');
    }
  }
  if (resultado.vencimento == null) {
    const dt = acharVencimentoNoTexto(texto);
    if (dt) {
      resultado.vencimento = dt;
      resultado.metodo += '+vencimento-texto';
      if (resultado.confianca === 'baixa') resultado.confianca = 'media';
      resultado.avisos.push('Vencimento lido do texto do boleto. Confira.');
    }
  }

  return resultado;
}

export default {
  somenteDigitos,
  modulo10,
  modulo11Cobranca,
  modulo11Arrecadacao,
  fatorVencimentoParaData,
  fatorVencimentoDetalhado,
  paraISODate,
  modulo10Arrecadacao,
  linha47ParaCodigo44,
  codigo44ParaLinha47,
  linha48ParaCodigo44,
  codigo44ParaLinha48,
  validarCobranca47,
  validarArrecadacao48,
  interpretarCodigo,
  formatarLinha47,
  formatarLinha48,
  acharCodigoNoTexto,
  acharValorNoTexto,
  acharVencimentoNoTexto,
  extrairDadosDeTexto,
  nomeDoBanco,
  NOMES_DE_BANCOS,
};
