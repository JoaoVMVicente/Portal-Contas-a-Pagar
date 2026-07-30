/**
 * pagina-cliente.js — O assistente de envio de boleto, passo a passo.
 * ---------------------------------------------------------------------------
 * POR QUE UMA ETAPA DE CADA VEZ
 * -----------------------------
 * Antes, as sete seções apareciam todas juntas. Um formulário longo assusta:
 * a pessoa bate o olho, vê vinte campos e desanima antes de começar.
 *
 * Agora só a etapa atual fica aberta. As anteriores viram uma linha resumida
 * (com botão "Editar", porque ninguém deve ficar preso), e as seguintes ficam
 * acinzentadas — visíveis, para dar noção do tamanho da tarefa, mas fechadas.
 *
 * E tem um ganho que só aparece na prática: como o arquivo é a PRIMEIRA etapa,
 * quando a pessoa chega nas etapas 3, 4, 5 e 6 elas já estão preenchidas pela
 * leitura do boleto. O trabalho vira conferir, não digitar.
 */

import { CONFIG } from './config.js';
import { dados } from './dados.js';
import * as sessao from './sessao.js';
import { montarTopo, montarRodape, ligarBotaoDemo } from './layout.js';
import {
  ICONES, avisar, escapar, moeda, data as fmtData, dataHora, tamanhoArquivo,
  cnpj as fmtCnpj, pintarIcones, mascararCNPJ, cnpjValido, copiar, comBotaoOcupado,
  aguardarPausa,
} from './ui.js';
import {
  carregarContas, empresaPorDocumento, acharEmpresa, contasDaEmpresa, buscarEmpresas,
  criarVerificadorDeEmpresa, preencherSelectContas, rotuloDaConta,
  formatarDocumento, totais as totaisDeContas,
} from './contas.js';
import { extrairDoArquivo, interpretarDigitado } from './extrator.js';

const el = (id) => document.getElementById(id);
const ULTIMA_ETAPA = 8;

const TITULOS = {
  1: 'Boleto', 2: 'Solicitante', 3: 'Documento', 4: 'Empresa',
  5: 'Fornecedor', 6: 'Valores', 7: 'Classificação', 8: 'Enviar',
};

const estado = {
  etapa: 1,
  concluidas: new Set(),
  arquivo: null,
  extracao: null,
  empresa: null,
  conta: null,
  enviando: false,
};

/* ========================================================================== *
 * Início
 * ========================================================================== */
async function iniciar() {
  const s = await sessao.exigirLogin();
  if (!s) return;

  sessao.definirVisao('cliente');
  montarTopo({ visao: 'cliente', destino: el('topo') });
  ligarBotaoDemo(() => window.location.reload());
  montarRodape(el('rodape'));
  pintarIcones();

  if (new URLSearchParams(location.search).get('semPermissao')) {
    avisar('A tela do operador é só para a equipe de operação.', 'atencao', 6000);
  }

  const p = sessao.perfil();
  el('email').value = sessao.usuario()?.email ?? '';
  el('nome').value = p?.nome ?? '';
  el('sobrenome').value = p?.sobrenome ?? '';

  montarTrilha();
  ligarNavegacao();
  ligarUpload();
  ligarCamposDependentes();
  ligarBuscaDeEmpresa();
  ligarEnvio();

  await Promise.all([montarDepartamentos(), avisarTotais()]);
  await carregarMeusBoletos();
  dados.assinarMudancas(aguardarPausa(() => carregarMeusBoletos(), 400));
}

async function avisarTotais() {
  try {
    const t = await totaisDeContas();
    el('dica-conta').textContent =
      `${t.empresas} empresas e ${t.contasAtivas} contas ativas cadastradas.`;
  } catch (erro) {
    el('dica-conta').textContent = '';
    console.warn(erro);
  }
}

async function montarDepartamentos() {
  const lista = await dados.listarDepartamentos().catch(() => []);
  el('departamento').innerHTML =
    '<option value="">Selecione o departamento</option>' +
    lista.map((d) => `<option value="${escapar(d)}">${escapar(d)}</option>`).join('');
}

/* ========================================================================== *
 * A trilha de etapas
 * ========================================================================== */
function montarTrilha() {
  el('trilha').innerHTML = Object.entries(TITULOS)
    .map(
      ([n, titulo]) => `
      <li class="trilha__item" data-trilha="${n}">
        <button type="button" class="trilha__botao">
          <span class="trilha__bolinha">${n}</span>
          <span class="trilha__rotulo">${escapar(titulo)}</span>
        </button>
      </li>`
    )
    .join('');

  el('trilha').querySelectorAll('[data-trilha]').forEach((item) => {
    item.querySelector('.trilha__botao').addEventListener('click', () => {
      const n = Number(item.dataset.trilha);
      // Só dá para pular para uma etapa já concluída, ou para a atual.
      if (estado.concluidas.has(n) || n === estado.etapa) irParaEtapa(n);
    });
  });

  pintarTrilha();
}

function pintarTrilha() {
  el('trilha').querySelectorAll('[data-trilha]').forEach((item) => {
    const n = Number(item.dataset.trilha);
    item.classList.toggle('trilha__item--ativo', n === estado.etapa);
    item.classList.toggle('trilha__item--feito', estado.concluidas.has(n));
    const bolinha = item.querySelector('.trilha__bolinha');
    bolinha.innerHTML = estado.concluidas.has(n) ? ICONES.check : String(n);
    item.querySelector('.trilha__botao').disabled =
      !estado.concluidas.has(n) && n !== estado.etapa;
  });
}

function secao(n) {
  return document.querySelector(`.etapa[data-etapa="${n}"]`);
}

function irParaEtapa(n) {
  estado.etapa = n;

  document.querySelectorAll('.etapa').forEach((s) => {
    const numero = Number(s.dataset.etapa);
    const feita = estado.concluidas.has(numero);
    const ativa = numero === n;

    s.classList.toggle('etapa--ativa', ativa);
    s.classList.toggle('etapa--concluida', feita && !ativa);
    s.classList.toggle('etapa--bloqueada', !ativa && !feita);

    // A linha de resumo só aparece quando a etapa está fechada e pronta.
    const resumo = s.querySelector('.etapa__resumo');
    const editar = s.querySelector('.etapa__editar');
    const mostrarResumo = feita && !ativa;
    if (resumo) {
      resumo.hidden = !mostrarResumo;
      if (mostrarResumo) resumo.innerHTML = resumoDaEtapa(numero);
    }
    if (editar) editar.hidden = !mostrarResumo;
  });

  if (n === ULTIMA_ETAPA) desenharRevisao();

  pintarTrilha();

  // Com uma etapa por vez, o painel troca no mesmo lugar. Então o certo é
  // subir para a trilha — não rolar até a seção, que já está ali.
  const trilha = el('trilha');
  if (trilha) {
    const y = trilha.getBoundingClientRect().top + window.scrollY - 24;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  // Foca o primeiro campo, para quem usa teclado não precisar caçar.
  const alvo = secao(n);
  if (alvo) {
    setTimeout(() => {
      alvo.querySelector('input:not([readonly]):not([type=file]), select, textarea')?.focus({
        preventScroll: true,
      });
    }, 220);
  }
}

function resumoDaEtapa(n) {
  const pedaco = (t) => `<span>${escapar(t)}</span>`;
  switch (n) {
    case 1:
      return estado.arquivo
        ? pedaco(`${estado.arquivo.name} · ${tamanhoArquivo(estado.arquivo.size)}`)
        : '';
    case 2:
      return pedaco(`${el('nome').value} ${el('sobrenome').value}`.trim());
    case 3: {
      const tipo = el('tipo-documento').value;
      const numero = el('numero-documento').value;
      return pedaco(`${tipo}-${numero}`);
    }
    case 4:
      return estado.empresa
        ? pedaco(`${estado.empresa.razaoSocial} · conta ${el('conta').value}`)
        : '';
    case 5:
      return pedaco(el('fornecedor').value);
    case 6: {
      const v = valorParaNumero(el('valor').value);
      return pedaco(`${v != null ? moeda(v) : '—'} · vence ${fmtData(el('vencimento').value)}`);
    }
    case 7:
      return pedaco(el('departamento').value);
    default:
      return '';
  }
}

function ligarNavegacao() {
  document.querySelectorAll('[data-avancar]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const n = Number(botao.dataset.avancar);
      if (!validarEtapa(n)) return;
      estado.concluidas.add(n);
      irParaEtapa(Math.min(n + 1, ULTIMA_ETAPA));
    });
  });

  document.querySelectorAll('[data-voltar]').forEach((botao) => {
    botao.addEventListener('click', () => {
      irParaEtapa(Math.max(1, Number(botao.dataset.voltar) - 1));
    });
  });

  document.querySelectorAll('.etapa__editar').forEach((botao) => {
    botao.addEventListener('click', () => {
      irParaEtapa(Number(botao.closest('.etapa').dataset.etapa));
    });
  });
}

/* ========================================================================== *
 * Validação por etapa
 * ========================================================================== */
function limparErrosDaEtapa(n) {
  secao(n)?.querySelectorAll('.campo__erro').forEach((e) => e.classList.add('oculto'));
  secao(n)?.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
}

function marcarErro(campoId, mensagem) {
  const erro = el(`erro-${campoId}`);
  if (erro) {
    erro.innerHTML = `${ICONES.alerta}${escapar(mensagem)}`;
    erro.classList.remove('oculto');
  }
  const campo = el(campoId);
  campo?.setAttribute('aria-invalid', 'true');
  campo?.focus();
}

function valorParaNumero(texto) {
  const limpo = String(texto ?? '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validarEtapa(n) {
  limparErrosDaEtapa(n);

  switch (n) {
    case 1:
      if (!estado.arquivo) {
        el('erro-arquivo').innerHTML = `${ICONES.alerta}Anexe o arquivo do boleto.`;
        el('erro-arquivo').classList.remove('oculto');
        return false;
      }
      return true;

    case 2:
      if (!el('nome').value.trim()) return marcarErro('nome', 'Preencha seu nome.'), false;
      if (!el('sobrenome').value.trim()) return marcarErro('sobrenome', 'Preencha seu sobrenome.'), false;
      return true;

    case 3: {
      if (!el('tipo-documento').value) {
        return marcarErro('tipo-documento', 'Escolha entre NF e MD.'), false;
      }
      const numero = el('numero-documento').value.trim();
      if (!numero) return marcarErro('numero-documento', 'Informe o número do documento.'), false;
      if (/^(req|rc|sc)/i.test(numero)) {
        return marcarErro('numero-documento',
          'Isso parece um número de requisição. Use o número da NF ou da MD.'), false;
      }
      const regularizado = document.querySelector('input[name=regularizado]:checked')?.value;
      if (!regularizado) return marcarErro('regularizado', 'Responda sim ou não.'), false;
      if (regularizado === 'nao') {
        marcarErro('regularizado',
          el('tipo-documento').value === 'MD'
            ? 'Regularize a aprovação e a forma de pagamento da MD antes de enviar.'
            : 'Regularize a escrituração e a forma de pagamento da NF antes de enviar.');
        return false;
      }
      return true;
    }

    case 4:
      if (!estado.empresa) {
        return marcarErro('busca-empresa', 'Escolha a unidade de negócio.'), false;
      }
      if (!el('conta').value) {
        return marcarErro('conta', 'Escolha a conta.'), false;
      }
      return true;

    case 5: {
      if (!el('fornecedor').value.trim()) {
        return marcarErro('fornecedor', 'Informe a razão social do fornecedor.'), false;
      }
      const doc = el('fornecedor-cnpj').value.trim();
      if (doc && !cnpjValido(doc)) {
        return marcarErro('fornecedor-cnpj', 'Este CNPJ não passa na verificação.'), false;
      }
      return true;
    }

    case 6:
      if (valorParaNumero(el('valor').value) == null) {
        return marcarErro('valor', 'Informe o valor do boleto.'), false;
      }
      if (!el('vencimento').value) {
        return marcarErro('vencimento', 'Informe o vencimento.'), false;
      }
      return true;

    case 7:
      if (!el('departamento').value) {
        return marcarErro('departamento', 'Escolha o departamento.'), false;
      }
      return true;

    default:
      return true;
  }
}

/* ========================================================================== *
 * Campos que reagem a outros
 * ========================================================================== */
function ligarCamposDependentes() {
  el('tipo-documento').addEventListener('change', () => {
    const tipo = el('tipo-documento').value;
    const rotulo = el('rotulo-regularizado');
    const dica = el('dica-regularizado');
    if (tipo === 'NF') {
      rotulo.innerHTML = 'A NF está escriturada e com a forma de pagamento atualizada? <span class="obrigatorio">*</span>';
      dica.textContent = 'Sem escrituração e forma de pagamento em ordem, o pagamento não sai.';
    } else if (tipo === 'MD') {
      rotulo.innerHTML = 'A MD está aprovada e com a forma de pagamento atualizada? <span class="obrigatorio">*</span>';
      dica.textContent = 'Sem aprovação e forma de pagamento em ordem, o pagamento não sai.';
    } else {
      rotulo.innerHTML = 'O documento está regularizado? <span class="obrigatorio">*</span>';
      dica.textContent = 'Escolha o tipo acima para ver o que precisa estar em ordem.';
    }
  });

  el('fornecedor-cnpj').addEventListener('input', (ev) => {
    ev.target.value = mascararCNPJ(ev.target.value);
  });

  el('valor').addEventListener('input', (ev) => {
    ev.target.value = ev.target.value.replace(/[^\d,.]/g, '');
  });

  // Colar a linha digitável na mão recalcula valor e vencimento.
  el('linha-digitavel').addEventListener('input', () => {
    const digitos = el('linha-digitavel').value.replace(/\D+/g, '');
    if (digitos.length < 44) return;

    const lido = interpretarDigitado(digitos);
    if (!lido.codigoBarras) return;

    estado.extracao = {
      ...(estado.extracao ?? {}),
      codigoBarras: lido.codigoBarras,
      linhaDigitavel: lido.linhaDigitavel,
      linhaDigitavelFormatada: lido.linhaDigitavelFormatada,
      banco: lido.banco,
      bancoNome: lido.bancoNome,
      valor: lido.valor ?? estado.extracao?.valor ?? null,
      vencimento: lido.vencimento ?? estado.extracao?.vencimento ?? null,
      confianca: lido.dvValido ? 'alta' : 'media',
      metodo: 'digitado',
      avisos: lido.avisos,
    };

    if (lido.valor) el('valor').value = lido.valor.toFixed(2).replace('.', ',');
    if (lido.vencimento) el('vencimento').value = lido.vencimento;

    el('dica-codigo').textContent = lido.dvValido
      ? 'Código conferido: o dígito verificador fecha.'
      : 'Atenção: o dígito verificador não fechou. Confira os números.';

    desenharPainelExtracao();
  });
}

/* ========================================================================== *
 * Upload e leitura
 * ========================================================================== */
function ligarUpload() {
  const area = el('area-upload');
  const campo = el('arquivo');

  area.addEventListener('click', () => campo.click());
  area.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      campo.click();
    }
  });

  ['dragenter', 'dragover'].forEach((e) =>
    area.addEventListener(e, (ev) => {
      ev.preventDefault();
      area.classList.add('arrastando');
    })
  );
  ['dragleave', 'drop'].forEach((e) =>
    area.addEventListener(e, (ev) => {
      ev.preventDefault();
      area.classList.remove('arrastando');
    })
  );

  area.addEventListener('drop', (ev) => {
    const arquivo = ev.dataTransfer?.files?.[0];
    if (arquivo) receberArquivo(arquivo);
  });

  campo.addEventListener('change', () => {
    const arquivo = campo.files?.[0];
    if (arquivo) receberArquivo(arquivo);
  });
}

function validarArquivo(arquivo) {
  const limite = CONFIG.TAMANHO_MAX_ARQUIVO_MB * 1024 * 1024;
  if (arquivo.size > limite) {
    return `O arquivo tem ${tamanhoArquivo(arquivo.size)}. O limite é ${CONFIG.TAMANHO_MAX_ARQUIVO_MB} MB.`;
  }
  const tipoOk =
    CONFIG.TIPOS_ACEITOS.includes(arquivo.type) || /\.(pdf|png|jpe?g|webp)$/i.test(arquivo.name);
  return tipoOk ? null : 'Envie um arquivo PDF, PNG ou JPG.';
}

async function receberArquivo(arquivo) {
  const problema = validarArquivo(arquivo);
  const erro = el('erro-arquivo');
  if (problema) {
    erro.innerHTML = `${ICONES.alerta}${escapar(problema)}`;
    erro.classList.remove('oculto');
    return;
  }
  erro.classList.add('oculto');

  estado.arquivo = arquivo;
  mostrarArquivoEscolhido(arquivo);

  el('painel-extracao').innerHTML = `
    <div class="painel-extracao">
      <div class="painel-extracao__topo">
        ${ICONES.atualizar}<span id="andamento-extracao">Abrindo o arquivo...</span>
      </div>
      <div class="painel-extracao__corpo">
        <div class="esqueleto" style="width:70%"></div>
        <div class="esqueleto" style="width:50%"></div>
      </div>
    </div>`;

  try {
    // Passamos a lista das 213 empresas para o extrator conseguir separar
    // "nosso CNPJ" de "CNPJ do fornecedor". Ver boleto-campos.js.
    await carregarContas();
    const ehNossaEmpresa = await criarVerificadorDeEmpresa();

    const lido = await extrairDoArquivo(
      arquivo,
      (mensagem) => {
        const alvo = el('andamento-extracao');
        if (alvo) alvo.textContent = mensagem;
      },
      { ehNossaEmpresa, tipoDocumento: el('tipo-documento').value || null }
    );

    estado.extracao = lido;
    await preencherComOLido(lido);
    desenharPainelExtracao();

    const quantos = contarPreenchidos(lido);
    if (lido.confianca === 'alta') {
      avisar(`Boleto lido: ${quantos} campo(s) preenchido(s). Confira e siga.`, 'ok', 5000);
    } else if (quantos > 0) {
      avisar(`Leitura parcial: ${quantos} campo(s) preenchido(s). Confira os marcados.`, 'atencao', 6500);
    } else {
      avisar('Não consegui ler este arquivo. Você vai preencher à mão.', 'atencao', 7000);
    }
  } catch (erroLeitura) {
    console.error(erroLeitura);
    estado.extracao = null;
    el('painel-extracao').innerHTML = `
      <div class="aviso aviso--atencao" style="margin-top:14px;">
        ${ICONES.alerta}
        <div>
          <span class="aviso__titulo">Não consegui ler o arquivo automaticamente</span>
          ${escapar(erroLeitura.message)}<br />
          Sem problema: os campos das próximas etapas ficam abertos para você preencher.
        </div>
      </div>`;
  }
}

function contarPreenchidos(lido) {
  return [
    lido.valor, lido.vencimento, lido.codigoBarras, lido.numeroDocumento,
    lido.unidadeCnpj, lido.fornecedorCnpj, lido.fornecedorRazaoSocial,
  ].filter(Boolean).length;
}

function mostrarSelo(id, mostrar) {
  el(id)?.classList.toggle('oculto', !mostrar);
}

/**
 * Espalha o que foi lido pelas etapas 3, 4, 5 e 6.
 * Cada campo preenchido automaticamente ganha um selo, para a pessoa saber
 * o que veio do arquivo e o que ela mesma digitou.
 */
async function preencherComOLido(lido) {
  // ---------------------------------------------------------- ETAPA 3
  if (lido.numeroDocumento) {
    el('numero-documento').value = lido.numeroDocumento;
    mostrarSelo('selo-numero', true);
  }
  if (lido.numeroDocumentoTipoSugerido && !el('tipo-documento').value) {
    el('tipo-documento').value = lido.numeroDocumentoTipoSugerido;
    el('tipo-documento').dispatchEvent(new Event('change'));
  }

  // Mais de um candidato: mostramos fichas para a pessoa escolher em um clique
  // em vez de apagar e digitar.
  const candidatos = (lido.numeroDocumentoCandidatos ?? []).slice(0, 4);
  if (candidatos.length > 1) {
    el('bloco-candidatos-numero').hidden = false;
    el('candidatos-numero').innerHTML = candidatos
      .map(
        (c, i) => `
        <button type="button" class="ficha-escolha ${i === 0 ? 'ficha-escolha--ativa' : ''}"
                data-numero="${escapar(c.numero)}" title="${escapar(c.contexto)}">
          ${escapar(c.numero)}
          ${c.tipoSugerido ? `<small>${c.tipoSugerido}</small>` : ''}
        </button>`
      )
      .join('');

    el('candidatos-numero').querySelectorAll('[data-numero]').forEach((botao) => {
      botao.addEventListener('click', () => {
        el('numero-documento').value = botao.dataset.numero;
        el('candidatos-numero')
          .querySelectorAll('.ficha-escolha')
          .forEach((b) => b.classList.toggle('ficha-escolha--ativa', b === botao));
      });
    });
  } else {
    el('bloco-candidatos-numero').hidden = true;
  }

  // ---------------------------------------------------------- ETAPA 4
  if (lido.unidadeCnpj) {
    // acharEmpresa também casa pela RAIZ do CNPJ: o boleto costuma vir contra
    // uma filial (0002, 0003...) enquanto a planilha cadastra a matriz (0001).
    const achado = await acharEmpresa(lido.unidadeCnpj);
    if (achado) {
      await escolherEmpresa(achado.empresa, {
        lidaDoBoleto: true,
        porRaiz: achado.porRaiz,
        filialDoBoleto: achado.filialDoBoleto,
        cnpjDoBoleto: lido.unidadeCnpj,
      });
    }
  }

  // ---------------------------------------------------------- ETAPA 5
  if (lido.fornecedorRazaoSocial) {
    el('fornecedor').value = lido.fornecedorRazaoSocial;
    mostrarSelo('selo-fornecedor', true);
  }
  if (lido.fornecedorCnpj) {
    el('fornecedor-cnpj').value = mascararCNPJ(lido.fornecedorCnpj);
    const selo = el('selo-fornecedor-cnpj');
    selo.classList.remove('oculto');
    // Se o dígito verificador não fechou, o selo avisa em vez de tranquilizar.
    if (lido.fornecedorCnpjConferido === false) {
      selo.textContent = 'confira os dígitos';
      selo.classList.add('selo-lido--atencao');
    } else {
      selo.textContent = 'lido do boleto';
      selo.classList.remove('selo-lido--atencao');
    }
  }

  // ---------------------------------------------------------- ETAPA 6
  if (lido.valor != null) {
    el('valor').value = Number(lido.valor).toFixed(2).replace('.', ',');
    mostrarSelo('selo-valor', true);
  }
  if (lido.vencimento) {
    el('vencimento').value = lido.vencimento;
    mostrarSelo('selo-vencimento', true);
  }
  if (lido.linhaDigitavelFormatada || lido.codigoBarras) {
    el('linha-digitavel').value = lido.linhaDigitavelFormatada ?? lido.codigoBarras;
  }
}

function mostrarArquivoEscolhido(arquivo) {
  const area = el('arquivo-escolhido');
  area.classList.remove('oculto');
  area.innerHTML = `
    <div class="arquivo-escolhido">
      <div class="arquivo-escolhido__icone" data-icone="documento"></div>
      <div class="arquivo-escolhido__info">
        <div class="arquivo-escolhido__nome">${escapar(arquivo.name)}</div>
        <div class="arquivo-escolhido__meta">${tamanhoArquivo(arquivo.size)}</div>
      </div>
      <button type="button" class="acao-icone" id="botao-trocar-arquivo" title="Trocar arquivo">
        ${ICONES.x}
      </button>
    </div>`;
  pintarIcones(area);
  el('area-upload').classList.add('oculto');

  el('botao-trocar-arquivo').addEventListener('click', () => {
    estado.arquivo = null;
    estado.extracao = null;
    el('arquivo').value = '';
    area.classList.add('oculto');
    el('painel-extracao').innerHTML = '';
    el('area-upload').classList.remove('oculto');
  });
}

function desenharPainelExtracao() {
  const lido = estado.extracao;
  const painel = el('painel-extracao');
  if (!lido) {
    painel.innerHTML = '';
    return;
  }

  const rotulo = {
    alta: 'Conferido pelo dígito verificador',
    media: 'Confira estes dados',
    baixa: 'Não deu para conferir',
    manual: 'Preenchido à mão',
  }[lido.confianca] ?? '';

  const item = (titulo, valor, calculado = false) => `
    <div class="dado-lido">
      <div class="dado-lido__rotulo">${escapar(titulo)}${calculado ? ' <small>calculado</small>' : ''}</div>
      <div class="dado-lido__valor">${valor ?? '—'}</div>
    </div>`;

  const avisos = (lido.avisos ?? []).length
    ? `<div class="aviso aviso--atencao" style="grid-column:1/-1;">
         ${ICONES.alerta}
         <div><span class="aviso__titulo">Atenção</span>
           <ul>${lido.avisos.map((a) => `<li>${escapar(a)}</li>`).join('')}</ul></div>
       </div>`
    : '';

  painel.innerHTML = `
    <div class="painel-extracao">
      <div class="painel-extracao__topo">
        ${lido.confianca === 'alta' ? ICONES.checkCirculo : ICONES.alerta}
        <span>O que eu li do arquivo</span>
        <span class="selo-confianca selo-confianca--${lido.confianca}">${escapar(rotulo)}</span>
      </div>
      <div class="painel-extracao__corpo">
        ${item('Valor', lido.valor != null ? moeda(lido.valor) : null, true)}
        ${item('Vencimento', lido.vencimento ? fmtData(lido.vencimento) : null, true)}
        ${item('Nº do documento', lido.numeroDocumento ? escapar(lido.numeroDocumento) : null)}
        ${item('Banco', escapar(lido.bancoNome ?? lido.banco ?? ''))}
        ${item('Nossa empresa', lido.unidadeCnpj ? escapar(fmtCnpj(lido.unidadeCnpj)) : null)}
        ${item('Fornecedor', lido.fornecedorCnpj ? escapar(fmtCnpj(lido.fornecedorCnpj)) : null)}
        <div class="dado-lido" style="grid-column:1/-1;">
          <div class="dado-lido__rotulo">Código de barras</div>
          <div class="dado-lido__valor" style="display:flex;align-items:center;gap:8px;">
            <span>${escapar(lido.codigoBarras ?? '—')}</span>
            ${lido.codigoBarras ? `<button type="button" class="acao-icone" id="copiar-codigo" title="Copiar">${ICONES.copiar}</button>` : ''}
          </div>
        </div>
        ${avisos}
      </div>
    </div>`;

  el('copiar-codigo')?.addEventListener('click', () =>
    copiar(lido.codigoBarras, 'Código de barras copiado.')
  );
}

/* ========================================================================== *
 * Empresa e conta
 * ========================================================================== */
function ligarBuscaDeEmpresa() {
  const entrada = el('busca-empresa');
  const lista = el('resultados-empresa');

  const buscar = aguardarPausa(async () => {
    const termo = entrada.value.trim();
    if (termo.length < 2) {
      lista.classList.add('oculto');
      return;
    }

    const achadas = await buscarEmpresas(termo, 8);
    if (!achadas.length) {
      lista.classList.remove('oculto');
      lista.innerHTML = `<div class="resultados-busca__vazio">
        Nenhuma empresa encontrada. Confira o nome ou o CNPJ.
      </div>`;
      return;
    }

    lista.classList.remove('oculto');
    lista.innerHTML = achadas
      .map(
        (e) => `
        <button type="button" class="resultados-busca__item" data-documento="${escapar(e.documento)}">
          <span class="resultados-busca__nome">${escapar(e.razaoSocial)}</span>
          <span class="resultados-busca__meta">
            ${escapar(formatarDocumento(e))} ·
            ${e.contas.filter((c) => c.ativa).length} conta(s)
            ${e.grupo ? ` · ${escapar(e.grupo)}` : ''}
          </span>
        </button>`
      )
      .join('');

    lista.querySelectorAll('[data-documento]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const empresa = await empresaPorDocumento(botao.dataset.documento);
        if (empresa) await escolherEmpresa(empresa, { lidaDoBoleto: false });
        lista.classList.add('oculto');
      });
    });
  }, 220);

  entrada.addEventListener('input', buscar);
  entrada.addEventListener('focus', () => {
    if (entrada.value.trim().length >= 2) buscar();
  });

  // Clicar fora fecha a lista.
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#bloco-busca-empresa')) lista.classList.add('oculto');
  });
}

/**
 * O textinho embaixo do nome da empresa, explicando de onde ela veio.
 *
 * O caso da filial merece explicação na tela, não só no código: o boleto vem
 * contra 30.866.542/0002-93 e a planilha cadastra 30.866.542/0001-02. É a
 * mesma empresa — a raiz do CNPJ é igual, muda a unidade. Como a conta
 * bancária cadastrada é a da matriz, é ela que vai ser usada, e quem envia
 * precisa saber disso para conferir se está certo.
 */
function notaDaEmpresa({ lidaDoBoleto, porRaiz, filialDoBoleto, cnpjDoBoleto }) {
  if (!lidaDoBoleto) return '';

  if (porRaiz && filialDoBoleto) {
    return `<div class="cartao-empresa__nota cartao-empresa__nota--atencao">
      O boleto foi emitido contra a filial <strong>${escapar(filialDoBoleto)}</strong>
      (${escapar(fmtCnpj(cnpjDoBoleto))}), e a planilha cadastra esta empresa pela matriz.
      É a mesma empresa — a raiz do CNPJ é igual. As contas abaixo são as cadastradas.
    </div>`;
  }

  return '<div class="cartao-empresa__nota">Este CNPJ estava no boleto e bate com a nossa planilha.</div>';
}

async function escolherEmpresa(
  empresa,
  { lidaDoBoleto = false, porRaiz = false, filialDoBoleto = null, cnpjDoBoleto = null } = {}
) {
  estado.empresa = empresa;

  const contas = await contasDaEmpresa(empresa.documento);
  preencherSelectContas(el('conta'), contas);
  estado.conta = el('conta').value || null;

  el('busca-empresa').value = empresa.razaoSocial;
  mostrarSelo('selo-empresa', lidaDoBoleto);

  el('empresa-identificada').classList.remove('oculto');
  el('empresa-identificada').innerHTML = `
    <div class="cartao-empresa ${lidaDoBoleto ? 'cartao-empresa--lida' : ''}">
      <div class="cartao-empresa__icone" data-icone="${lidaDoBoleto ? 'checkCirculo' : 'planilha'}"></div>
      <div class="cartao-empresa__texto">
        <div class="cartao-empresa__nome">${escapar(empresa.razaoSocial)}</div>
        <div class="cartao-empresa__meta">
          ${escapar(formatarDocumento(empresa))}
          ${empresa.grupo ? ` · grupo ${escapar(empresa.grupo)}` : ''}
          · ${contas.length} conta(s) ativa(s)
        </div>
        ${notaDaEmpresa({ lidaDoBoleto, porRaiz, filialDoBoleto, cnpjDoBoleto })}
      </div>
      <button type="button" class="botao botao--fantasma botao--pequeno" id="trocar-empresa">Trocar</button>
    </div>`;
  pintarIcones(el('empresa-identificada'));

  el('trocar-empresa').addEventListener('click', () => {
    estado.empresa = null;
    estado.conta = null;
    el('empresa-identificada').classList.add('oculto');
    el('busca-empresa').value = '';
    el('busca-empresa').focus();
    mostrarSelo('selo-empresa', false);
    el('conta').innerHTML = '<option value="">Escolha a empresa primeiro</option>';
    el('conta').disabled = true;
  });

  el('dica-conta').textContent =
    contas.length === 1
      ? 'Esta empresa tem uma conta ativa só, e ela já está selecionada.'
      : `Esta empresa tem ${contas.length} contas ativas. Escolha a certa para este pagamento.`;

  el('conta').addEventListener('change', () => {
    estado.conta = el('conta').value || null;
  });
}

/* ========================================================================== *
 * Revisão
 * ========================================================================== */
function desenharRevisao() {
  const contaEscolhida = el('conta').selectedOptions[0];
  const v = valorParaNumero(el('valor').value);

  const linha = (rotulo, valor, alerta = false) => `
    <div class="lista-detalhes__item${alerta ? ' lista-detalhes__item--alerta' : ''}">
      <span class="lista-detalhes__rotulo">${escapar(rotulo)}</span>
      <span class="lista-detalhes__valor">${valor ?? '—'}</span>
    </div>`;

  const avisos = [];
  if (estado.extracao?.confianca && estado.extracao.confianca !== 'alta') {
    avisos.push('O valor e o vencimento não vieram conferidos pelo dígito verificador.');
  }
  if (estado.extracao?.vencimentoAmbiguo) {
    avisos.push('A data de vencimento ficou ambígua na leitura. Confira no boleto.');
  }
  if (el('vencimento').value && new Date(el('vencimento').value) < new Date().setHours(0, 0, 0, 0)) {
    avisos.push('Este boleto já está vencido.');
  }

  el('revisao').innerHTML = `
    ${
      avisos.length
        ? `<div class="aviso aviso--atencao" style="margin-bottom:18px;">
             ${ICONES.alerta}
             <div><span class="aviso__titulo">Confira antes de enviar</span>
               <ul>${avisos.map((a) => `<li>${escapar(a)}</li>`).join('')}</ul></div>
           </div>`
        : ''
    }
    <div class="lista-detalhes">
      ${linha('Arquivo', `${escapar(estado.arquivo?.name ?? '')} <small>(${tamanhoArquivo(estado.arquivo?.size)})</small>`)}
      ${linha('Solicitante', `${escapar(el('nome').value)} ${escapar(el('sobrenome').value)}`)}
      ${linha('Documento', `<strong>${escapar(el('tipo-documento').value)}-${escapar(el('numero-documento').value)}</strong>`)}
      ${linha('Unidade de negócio', `${escapar(estado.empresa?.razaoSocial ?? '')}<br /><small>${escapar(formatarDocumento(estado.empresa))}</small>`)}
      ${linha('Código de conta (CC)', escapar(contaEscolhida?.textContent ?? el('conta').value))}
      ${linha('Fornecedor', `${escapar(el('fornecedor').value)}${el('fornecedor-cnpj').value ? `<br /><small>${escapar(el('fornecedor-cnpj').value)}</small>` : ''}`)}
      ${linha('Valor', `<strong>${v != null ? moeda(v) : '—'}</strong>`)}
      ${linha('Vencimento', fmtData(el('vencimento').value))}
      ${linha('Data desejada de pagamento', el('data-pagamento').value ? fmtData(el('data-pagamento').value) : '—')}
      ${linha('Departamento', escapar(el('departamento').value))}
      ${linha('Código de barras', estado.extracao?.codigoBarras ? `<code>${escapar(estado.extracao.codigoBarras)}</code>` : '—')}
      ${linha('Observações', escapar(el('observacoes').value) || '—')}
    </div>`;
}

/* ========================================================================== *
 * Envio
 * ========================================================================== */
function coletar() {
  const codigo = estado.extracao ?? {};
  const contaEscolhida = el('conta').selectedOptions[0];

  return {
    solicitante_nome: el('nome').value.trim(),
    solicitante_sobrenome: el('sobrenome').value.trim(),
    tipo_documento: el('tipo-documento').value,
    numero_documento: el('numero-documento').value.trim(),
    documento_regularizado:
      document.querySelector('input[name=regularizado]:checked')?.value === 'sim',

    cc: el('conta').value,
    conta_banco: contaEscolhida?.dataset.banco || null,
    conta_agencia: contaEscolhida?.dataset.agencia || null,
    conta_tipo: contaEscolhida?.dataset.tipo || null,
    unidade_negocio: estado.empresa?.razaoSocial ?? '',
    unidade_cnpj: estado.empresa?.documento ?? '',

    fornecedor_razao_social: el('fornecedor').value.trim(),
    fornecedor_cnpj: el('fornecedor-cnpj').value.replace(/\D+/g, '') || null,

    valor: valorParaNumero(el('valor').value),
    vencimento: el('vencimento').value,
    data_pagamento_desejada: el('data-pagamento').value || null,

    codigo_barras: codigo.codigoBarras ?? null,
    linha_digitavel: codigo.linhaDigitavel ?? null,
    banco_emissor: codigo.bancoNome ?? codigo.banco ?? null,
    extracao_confianca: codigo.confianca ?? 'manual',
    extracao_metodo: codigo.metodo ?? 'manual',
    extracao_avisos: codigo.avisos ?? [],

    departamento: el('departamento').value,
    observacoes_cliente: el('observacoes').value.trim() || null,
  };
}

function ligarEnvio() {
  el('formulario-boleto').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (estado.enviando) return;

    // Última conferência: todas as etapas de novo, para o caso de alguém ter
    // editado algo depois de já ter concluído.
    for (let n = 1; n <= 7; n += 1) {
      if (!validarEtapa(n)) {
        irParaEtapa(n);
        avisar('Faltou algo nesta etapa.', 'atencao');
        return;
      }
    }

    estado.enviando = true;
    el('progresso-envio').classList.remove('oculto');
    const barra = el('barra-progresso');
    const texto = el('texto-progresso');
    texto.textContent = 'Enviando o arquivo...';

    try {
      await comBotaoOcupado(el('botao-enviar'), 'Enviando...', () =>
        dados.criarBoleto(coletar(), estado.arquivo, (pct) => {
          barra.style.width = `${pct}%`;
          if (pct >= 65) texto.textContent = 'Gravando os dados...';
          if (pct >= 100) texto.textContent = 'Pronto.';
        })
      );

      avisar('Boleto enviado. A operação já pode ver na fila.', 'ok', 5000);
      reiniciarFormulario();
      await carregarMeusBoletos();
    } catch (erro) {
      console.error(erro);
      avisar(erro.message, 'erro', 9000);
      texto.textContent = '';
    } finally {
      estado.enviando = false;
      el('progresso-envio').classList.add('oculto');
      barra.style.width = '0';
    }
  });

  el('botao-atualizar-meus').addEventListener('click', () => carregarMeusBoletos());
}

function reiniciarFormulario() {
  el('formulario-boleto').reset();
  estado.arquivo = null;
  estado.extracao = null;
  estado.empresa = null;
  estado.conta = null;
  estado.concluidas.clear();

  el('arquivo-escolhido').classList.add('oculto');
  el('area-upload').classList.remove('oculto');
  el('painel-extracao').innerHTML = '';
  el('empresa-identificada').classList.add('oculto');
  el('bloco-candidatos-numero').hidden = true;
  el('conta').innerHTML = '<option value="">Escolha a empresa primeiro</option>';
  el('conta').disabled = true;
  document.querySelectorAll('.selo-lido').forEach((s) => s.classList.add('oculto'));
  document.querySelectorAll('.campo__erro').forEach((e) => e.classList.add('oculto'));

  const p = sessao.perfil();
  el('email').value = sessao.usuario()?.email ?? '';
  el('nome').value = p?.nome ?? '';
  el('sobrenome').value = p?.sobrenome ?? '';

  irParaEtapa(1);
}

/* ========================================================================== *
 * Meus boletos
 * ========================================================================== */
async function carregarMeusBoletos() {
  const area = el('meus-boletos');
  area.innerHTML = `<div class="moldura-tabela" style="padding:20px;">
      <div class="esqueleto" style="width:100%;margin-bottom:10px;"></div>
      <div class="esqueleto" style="width:80%;"></div>
    </div>`;

  try {
    const { linhas, total } = await dados.listarBoletos({
      escopo: 'meus',
      porPagina: 20,
      ordenarPor: 'data_envio',
      ordem: 'desc',
    });

    if (!total) {
      area.innerHTML = `
        <div class="moldura-tabela">
          <div class="estado-vazio">
            <div class="estado-vazio__icone" data-icone="documento"></div>
            <h3>Você ainda não enviou nenhum boleto</h3>
            <p>Quando enviar, o andamento aparece aqui.</p>
          </div>
        </div>`;
      pintarIcones(area);
      return;
    }

    area.innerHTML = `
      <div class="moldura-tabela">
        <div class="rolagem-tabela">
          <table class="tabela" style="min-width:900px;">
            <thead>
              <tr>
                <th>Protocolo</th><th>NF/MD</th><th>Enviado em</th>
                <th>Fornecedor</th><th>Valor</th><th>Vencimento</th>
                <th>Situação</th><th class="col-neutra">Cód. barras</th>
              </tr>
            </thead>
            <tbody>${linhas.map(linhaMeuBoleto).join('')}</tbody>
          </table>
        </div>
        <div class="rodape-tabela"><span>${total} boleto(s) enviado(s) por você.</span></div>
      </div>`;

    area.querySelectorAll('[data-copiar-codigo]').forEach((b) =>
      b.addEventListener('click', () => copiar(b.dataset.copiarCodigo, 'Código copiado.'))
    );
    area.querySelectorAll('[data-motivo]').forEach((b) =>
      b.addEventListener('click', () => avisar(b.dataset.motivo, 'atencao', 9000))
    );
  } catch (erro) {
    area.innerHTML = `<div class="aviso aviso--erro">${ICONES.xCirculo}<div>${escapar(erro.message)}</div></div>`;
  }
}

function linhaMeuBoleto(b) {
  const selo = {
    pendente: '<span class="selo selo--pendente">Aguardando operação</span>',
    associado: '<span class="selo selo--associado">Associado</span>',
    recusado: '<span class="selo selo--recusado">Recusado</span>',
  }[b.status] ?? '';

  const motivo =
    b.status === 'recusado' && b.observacoes_operador
      ? `<button type="button" class="acao-icone" data-motivo="${escapar(b.observacoes_operador)}" title="Ver o motivo">${ICONES.info}</button>`
      : '';

  return `
    <tr>
      <td>#${b.numero_protocolo ?? '—'}</td>
      <td>${escapar(b.documento_rotulo ?? `${b.tipo_documento}-${b.numero_documento}`)}</td>
      <td class="data-simples">${dataHora(b.data_envio)}</td>
      <td>${escapar(b.fornecedor_razao_social ?? '—')}</td>
      <td class="valor-monetario">${moeda(b.valor)}</td>
      <td class="data-simples">${fmtData(b.vencimento)}</td>
      <td><div style="display:flex;align-items:center;gap:6px;">${selo}${motivo}</div></td>
      <td>${
        b.codigo_barras
          ? `<button type="button" class="acao-icone" data-copiar-codigo="${escapar(b.codigo_barras)}" title="Copiar">${ICONES.codigoBarras}</button>`
          : '<span class="vazio-celula">—</span>'
      }</td>
    </tr>`;
}

/* ========================================================================== */
iniciar().catch((erro) => {
  console.error(erro);
  avisar(`Erro ao abrir a tela: ${erro.message}`, 'erro', 10000);
});
