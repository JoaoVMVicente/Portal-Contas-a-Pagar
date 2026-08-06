/**
 * pagina-operador.js — O painel de quem faz a associação.
 * ---------------------------------------------------------------------------
 * NF E MD: DUAS FILAS, NÃO DUAS TELAS
 * -----------------------------------
 * A tela é a mesma para nota fiscal e para medição. O que muda é o conteúdo.
 * Fiz assim de propósito, em vez de duas páginas separadas:
 *
 *   - Duas páginas com o mesmo layout seriam duas cópias para dar manutenção.
 *     Consertar a coluna de vencimento em uma e esquecer a outra é questão de
 *     tempo.
 *   - Quem só vê NF nunca percebe que existe MD: sem alternador, sem coluna
 *     estranha, sem aba vazia. A experiência é de uma tela feita para ela.
 *   - Quem vê as duas ganha um alternador no topo, com o contador de pendentes
 *     de cada lado. Assim dá para saber que tem medição esperando sem trocar.
 *
 * E o filtro não é só visual: o RLS do banco não devolve as linhas do tipo
 * errado. Se alguém do time de NF forçar o filtro no console, o banco continua
 * respondendo com uma lista vazia.
 */

import { CONFIG } from './config.js';
import { dados } from './dados.js';
import * as sessao from './sessao.js';
import { montarTopo, montarRodape, ligarBotaoDemo, montarSeletorDeTipo } from './layout.js';
import {
  ICONES, avisar, escapar, moeda, moedaCurta, numero, data as fmtData, dataHora,
  tamanhoArquivo, cnpj as fmtCnpj, pintarIcones, copiar, abrirModal, confirmar,
  pedirTexto, aguardarPausa, comBotaoOcupado,
} from './ui.js';
import parser from './boleto-parser.js';
import {
  buscarEmpresas, acharEmpresa, contasDaEmpresa, empresaPorDocumento,
  preencherSelectContas, formatarDocumento,
} from './contas.js';

const el = (id) => document.getElementById(id);

const NOME_DO_TIPO = { NF: 'notas fiscais', MD: 'medições' };

const estado = {
  tipo: 'NF',
  status: 'todos',
  busca: '',
  pagina: 1,
  // A fila abre pelo que vence primeiro — é a ordem em que o trabalho precisa
  // ser feito, não a ordem em que os boletos chegaram.
  ordenarPor: 'vencimento',
  ordem: 'asc',
  total: 0,
  linhas: [],
  kpisAnteriores: {},
  idsConhecidos: new Set(),
};

/* ========================================================================== *
 * Início
 * ========================================================================== */
async function iniciar() {
  const s = await sessao.exigirLogin({ exigirOperador: true });
  if (!s) return;

  sessao.definirVisao('operador');
  montarTopo({ visao: 'operador', destino: el('topo') });
  ligarBotaoDemo(() => window.location.reload());
  montarRodape(el('rodape'));
  pintarIcones();

  estado.tipo = sessao.tipoAtivo();

  montarSeletorDeTipo({
    destino: el('seletor-tipo'),
    tipoAtivo: estado.tipo,
    aoTrocar: async (tipo) => {
      estado.tipo = tipo;
      estado.pagina = 1;
      estado.idsConhecidos.clear();
      atualizarTitulo();
      await Promise.all([atualizarKpis(), carregarTabela()]);
    },
  });

  atualizarTitulo();

  // A aba de descartados só existe para quem tem a permissão. Quem não tem
  // nem vê que a ação existe — e se forçar o filtro, o banco recusa a ação.
  if (sessao.podeDescartar()) el('aba-descartados')?.classList.remove('oculto');

  ligarFiltros();
  ligarOrdenacao();
  ligarBotoes();

  await Promise.all([atualizarKpis(), carregarTabela()]);

  // Ao vivo. Quando o aviso trouxer o tipo do boleto, só recarregamos se o
  // aviso for da fila que está na tela — evita piscar a tela por nada.
  dados.assinarMudancas(
    aguardarPausa(async (aviso) => {
      if (aviso?.tipoDocumento && aviso.tipoDocumento !== estado.tipo) {
        // Não é a nossa fila, mas o contador do outro lado pode ter mudado.
        await atualizarContadoresDosTipos();
        return;
      }
      await Promise.all([atualizarKpis(), carregarTabela({ silencioso: true })]);
    }, 400)
  );
}

function atualizarTitulo() {
  const nome = NOME_DO_TIPO[estado.tipo];
  el('titulo-painel').textContent =
    estado.tipo === 'NF' ? 'Associação de notas fiscais' : 'Associação de medições';
  el('rotulo-total').textContent = estado.tipo === 'NF' ? 'Total de NFs' : 'Total de MDs';
  el('sub-painel').textContent =
    `Fila de ${nome} enviadas pelos solicitantes. Você está como ${sessao.nomeExibicao()}.`;
}

/* ========================================================================== *
 * Os quatro cartões
 * ========================================================================== */
async function atualizarKpis() {
  try {
    const k = await dados.kpis(estado.tipo);

    pintarKpi('valor-total-boletos', 'kpi-total', numero(k.total_boletos));
    pintarKpi('valor-soma', 'kpi-valor', moedaCurta(k.valor_total));
    pintarKpi('valor-pendentes', 'kpi-pendentes', numero(k.pendentes));
    pintarKpi('valor-associados', 'kpi-associados', numero(k.associados));

    el('cont-todos').textContent = k.total_boletos ?? 0;
    el('cont-pendente').textContent = k.pendentes ?? 0;
    el('cont-associado').textContent = k.associados ?? 0;
    el('cont-recusado').textContent = k.recusados ?? 0;
    if (el('cont-descartado')) el('cont-descartado').textContent = k.descartados ?? 0;

    document.title = k.pendentes
      ? `(${k.pendentes}) ${estado.tipo} · Painel de associação`
      : `${estado.tipo} · Painel de associação`;

    estado.kpisAnteriores = k;
    await atualizarContadoresDosTipos();
  } catch (erro) {
    console.error(erro);
    avisar(`Não consegui atualizar os indicadores: ${erro.message}`, 'erro', 8000);
  }
}

/** Os numerozinhos de pendentes ao lado de "Notas fiscais" e "Medições". */
async function atualizarContadoresDosTipos() {
  if (!sessao.veOsDoisTipos()) return;
  try {
    const [nf, md] = await Promise.all([dados.kpis('NF'), dados.kpis('MD')]);
    const pintar = (id, valor) => {
      const alvo = el(id);
      if (!alvo) return;
      alvo.textContent = valor ? String(valor) : '';
      alvo.classList.toggle('seletor-tipo__contador--vazio', !valor);
    };
    pintar('contador-nf', nf.pendentes);
    pintar('contador-md', md.pendentes);
  } catch {
    /* contador é enfeite: se falhar, a tela continua funcionando */
  }
}

function pintarKpi(idValor, idCartao, texto) {
  const alvo = el(idValor);
  const mudou = alvo.textContent !== texto && alvo.textContent !== '—';
  alvo.textContent = texto;
  alvo.classList.remove('kpi__valor--carregando');
  if (mudou) {
    const cartao = el(idCartao);
    cartao.classList.remove('kpi--mudou');
    void cartao.offsetWidth;
    cartao.classList.add('kpi--mudou');
  }
}

/* ========================================================================== *
 * Filtros
 * ========================================================================== */
function ligarFiltros() {
  el('busca').addEventListener(
    'input',
    aguardarPausa(() => {
      estado.busca = el('busca').value.trim();
      estado.pagina = 1;
      carregarTabela();
    }, 320)
  );

  document.querySelectorAll('.abas-status__item').forEach((botao) => {
    botao.addEventListener('click', () => {
      document
        .querySelectorAll('.abas-status__item')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === botao)));
      estado.status = botao.dataset.status;
      estado.pagina = 1;
      carregarTabela();
    });
  });

  el('pagina-anterior').addEventListener('click', () => {
    if (estado.pagina > 1) {
      estado.pagina -= 1;
      carregarTabela();
    }
  });

  el('pagina-proxima').addEventListener('click', () => {
    const ultima = Math.ceil(estado.total / CONFIG.LINHAS_POR_PAGINA) || 1;
    if (estado.pagina < ultima) {
      estado.pagina += 1;
      carregarTabela();
    }
  });
}

function ligarOrdenacao() {
  document.querySelectorAll('th[data-ordenar]').forEach((th) => {
    th.style.cursor = 'pointer';
    th.title = 'Clique para ordenar';
    th.addEventListener('click', () => {
      const campo = th.dataset.ordenar;
      if (estado.ordenarPor === campo) {
        estado.ordem = estado.ordem === 'asc' ? 'desc' : 'asc';
      } else {
        estado.ordenarPor = campo;
        estado.ordem = 'asc';
      }
      estado.pagina = 1;
      pintarOrdenacao();
      carregarTabela();
    });
  });
  pintarOrdenacao();
}

/**
 * Mostra qual coluna está ordenando e em que sentido.
 *
 * Sem isso, a tabela abre ordenada por vencimento e ninguém sabe por quê —
 * parece aleatório. Uma seta resolve.
 */
function pintarOrdenacao() {
  document.querySelectorAll('th[data-ordenar]').forEach((th) => {
    const ativa = th.dataset.ordenar === estado.ordenarPor;
    th.classList.toggle('ordenando', ativa);
    th.classList.toggle('ordenando--desc', ativa && estado.ordem === 'desc');
    th.setAttribute(
      'aria-sort',
      ativa ? (estado.ordem === 'asc' ? 'ascending' : 'descending') : 'none'
    );
  });
}

function ligarBotoes() {
  el('botao-atualizar').addEventListener('click', async () => {
    await Promise.all([atualizarKpis(), carregarTabela()]);
    avisar('Painel atualizado.', 'ok', 1800);
  });
  el('botao-exportar').addEventListener('click', exportarCsv);
}

/* ========================================================================== *
 * A tabela
 * ========================================================================== */
async function carregarTabela({ silencioso = false } = {}) {
  const corpo = el('corpo-tabela');

  if (!silencioso) {
    corpo.innerHTML = Array.from({ length: 5 })
      .map(
        () =>
          `<tr>${Array.from({ length: 14 })
            .map(() => '<td><div class="esqueleto"></div></td>')
            .join('')}</tr>`
      )
      .join('');
  }

  try {
    const { linhas, total, pagina, porPagina } = await dados.listarBoletos({
      escopo: 'todos',
      tipo: estado.tipo,
      status: estado.status,
      busca: estado.busca,
      pagina: estado.pagina,
      ordenarPor: estado.ordenarPor,
      ordem: estado.ordem,
    });

    estado.linhas = linhas;
    estado.total = total;

    if (!linhas.length) {
      const filtrando = estado.busca || estado.status !== 'todos';
      corpo.innerHTML = `
        <tr><td colspan="14">
          <div class="estado-vazio">
            <div class="estado-vazio__icone" data-icone="documento"></div>
            <h3>${filtrando ? 'Nada encontrado com esses filtros' : `Nenhuma ${estado.tipo === 'NF' ? 'nota fiscal' : 'medição'} na fila`}</h3>
            <p>${
              filtrando
                ? 'Tente limpar a busca ou trocar a situação.'
                : 'Quando um solicitante enviar, aparece aqui na hora.'
            }</p>
          </div>
        </td></tr>`;
      pintarIcones(corpo);
      atualizarRodape(0, pagina, porPagina);
      return;
    }

    corpo.innerHTML = linhas.map(montarLinha).join('');
    pintarIcones(corpo);
    ligarAcoesDaTabela();
    atualizarRodape(total, pagina, porPagina);

    linhas.forEach((b) => {
      if (!estado.idsConhecidos.has(b.id)) {
        if (estado.idsConhecidos.size > 0) {
          corpo.querySelector(`tr[data-id="${b.id}"]`)?.classList.add('linha--nova');
        }
        estado.idsConhecidos.add(b.id);
      }
    });
  } catch (erro) {
    console.error(erro);
    corpo.innerHTML = `<tr><td colspan="14">
      <div class="aviso aviso--erro" style="margin:16px;">${ICONES.xCirculo}
        <div><span class="aviso__titulo">Não consegui carregar a fila</span>${escapar(erro.message)}</div>
      </div></td></tr>`;
  }
}

/**
 * O sinal de revisão que a chefia pediu.
 *
 * O valor vem calculado do banco (coluna sinal_revisao da visão), então a tela
 * não decide nada — só pinta. Isso importa: se a regra estivesse aqui, ela
 * discordaria da regra que barra a associação, e um dia alguém veria verde num
 * boleto que o banco recusa.
 *
 *   incompleto  falta dado. Não dá para associar. Vermelho.
 *   conferir    completo, mas o dígito verificador não fechou. Abra o PDF.
 *   ok          completo e conferido pela matemática do código de barras.
 */
function celulaDeRevisao(b) {
  const pendencias = b.pendencias ?? [];

  const mapa = {
    incompleto: {
      icone: ICONES.alerta,
      classe: 'sinal-revisao--incompleto',
      titulo: `Falta preencher: ${pendencias.join(', ')}`,
    },
    conferir: {
      icone: ICONES.olho,
      classe: 'sinal-revisao--conferir',
      titulo: 'Os dados não vieram conferidos pelo dígito verificador. Abra o PDF e confira.',
    },
    ok: {
      icone: ICONES.checkCirculo,
      classe: 'sinal-revisao--ok',
      titulo: 'Completo, e o código de barras fecha no dígito verificador.',
    },
  };

  const s = mapa[b.sinal_revisao] ?? mapa.conferir;
  const contador = pendencias.length ? `<span class="sinal-revisao__conta">${pendencias.length}</span>` : '';

  return `<span class="sinal-revisao ${s.classe}" title="${escapar(s.titulo)}">${s.icone}${contador}</span>`;
}

function montarLinha(b) {
  let seloVencimento = '';
  if (!b.vencimento) {
    seloVencimento = '<span class="selo selo--sem-data">Não lido</span>';
  } else if (b.status !== 'associado') {
    if (b.situacao_vencimento === 'vencido') {
      seloVencimento = '<span class="selo selo--vencido">Vencido</span>';
    } else if (b.situacao_vencimento === 'vence_em_breve') {
      seloVencimento = '<span class="selo selo--vence-breve">Vence já</span>';
    }
  }

  const seloConfianca =
    b.extracao_confianca && b.extracao_confianca !== 'alta'
      ? `<span class="selo-confianca selo-confianca--${b.extracao_confianca}"
                title="Origem dos dados: ${escapar(b.extracao_metodo ?? '')}">${
          b.extracao_confianca === 'manual' ? 'digitado' : 'conferir'
        }</span>`
      : '';

  // O botão de descartar só é desenhado para quem tem a permissão.
  const botaoDescartar = sessao.podeDescartar()
    ? `<button class="acao-icone acao-icone--perigo" data-acao="descartar" data-id="${b.id}"
               title="Descartar: tirar da fila por engano">${ICONES.x}</button>`
    : '';

  const acoes =
    b.status === 'descartado'
      ? `<button class="acao-icone" data-acao="detalhes" data-id="${b.id}" title="Ver detalhes">${ICONES.olho}</button>
         ${
           sessao.podeDescartar()
             ? `<button class="acao-icone" data-acao="restaurar" data-id="${b.id}"
                        title="Desfazer o descarte">${ICONES.desfazer}</button>`
             : ''
         }`
      : b.status === 'associado'
      ? `<button class="acao-icone" data-acao="detalhes" data-id="${b.id}" title="Ver detalhes">${ICONES.olho}</button>
         <button class="acao-icone" data-acao="reabrir" data-id="${b.id}" title="Desfazer associação">${ICONES.desfazer}</button>`
      : `<button class="acao-icone" data-acao="completar" data-id="${b.id}"
                 title="${b.qtd_pendencias ? 'Preencher o que falta' : 'Revisar os dados'}">${ICONES.documento}</button>
         <button class="acao-icone acao-icone--ok" data-acao="associar" data-id="${b.id}"
                 title="Associar">${ICONES.checkCirculo}</button>
         <button class="acao-icone" data-acao="detalhes" data-id="${b.id}" title="Ver detalhes">${ICONES.olho}</button>
         <button class="acao-icone" data-acao="recusar" data-id="${b.id}" title="Recusar e devolver">${ICONES.xCirculo}</button>
         ${botaoDescartar}`;

  // A coluna CC mostra a conta e, embaixo, o banco — porque uma empresa tem
  // várias contas e o número sozinho não diz de qual banco é.
  const conta = `
    <div class="celula-duas-linhas" style="min-width:110px;">
      <span class="celula-duas-linhas__principal">${escapar(b.cc ?? '—')}</span>
      ${b.conta_banco ? `<span class="celula-duas-linhas__secundaria">${escapar(b.conta_banco)}</span>` : ''}
    </div>`;

  return `
  <tr data-id="${b.id}">
    <td>
      <button class="acao-icone" data-acao="baixar" data-id="${b.id}"
              title="Baixar ${escapar(b.arquivo_nome ?? 'boleto')} (${tamanhoArquivo(b.arquivo_tamanho)})">
        ${ICONES.clipe}
      </button>
    </td>

    <td>${celulaDeRevisao(b)}</td>

    <td>
      <div class="celula-duas-linhas" style="min-width:96px;">
        <span class="celula-duas-linhas__principal">${escapar(b.documento_rotulo ?? `${b.tipo_documento}-${b.numero_documento ?? 's/nº'}`)}</span>
        ${b.documento_regularizado ? '' : '<span class="celula-duas-linhas__secundaria">não regularizado</span>'}
      </div>
    </td>

    <td class="data-simples">${fmtData(b.data_envio)}</td>

    <td>
      <div class="celula-duas-linhas">
        <span class="celula-duas-linhas__principal">${escapar(b.nome ?? '—')}</span>
        <span class="celula-duas-linhas__secundaria">${escapar(b.solicitante_email ?? '')}</span>
      </div>
    </td>

    <td>${conta}</td>

    <td>
      <div class="celula-duas-linhas">
        <span class="celula-duas-linhas__principal">${escapar(b.unidade_negocio ?? '—')}</span>
        <span class="celula-duas-linhas__secundaria">${escapar(fmtCnpj(b.unidade_cnpj))}</span>
      </div>
    </td>

    <td>
      <div class="celula-duas-linhas">
        <span class="celula-duas-linhas__principal">${escapar(b.fornecedor_razao_social ?? '—')}</span>
        <span class="celula-duas-linhas__secundaria">${b.fornecedor_cnpj ? escapar(fmtCnpj(b.fornecedor_cnpj)) : ''}</span>
      </div>
    </td>

    <td>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="valor-monetario">${moeda(b.valor)}</span>${seloConfianca}
      </div>
    </td>

    <td>
      <div class="celula-duas-linhas" style="min-width:110px;">
        <span class="data-simples">${b.vencimento ? fmtData(b.vencimento) : '—'}</span>
        ${seloVencimento}
      </div>
    </td>

    <td>
      ${
        b.codigo_barras
          ? `<button class="acao-icone" data-acao="copiar-codigo" data-id="${b.id}"
                     title="Copiar a linha digitável">${ICONES.codigoBarras}</button>`
          : '<span class="vazio-celula">—</span>'
      }
    </td>

    <td class="data-simples">${b.data_associacao ? fmtData(b.data_associacao) : '<span class="vazio-celula">—</span>'}</td>

    <td>${
      b.associado_por_nome
        ? escapar(b.associado_por_nome)
        : `<span class="selo selo--${b.status}">${
            { pendente: 'Pendente', recusado: 'Recusado', associado: 'Associado', descartado: 'Descartado' }[b.status] ?? b.status
          }</span>`
    }</td>

    <td><div class="grupo-acoes">${acoes}</div></td>
  </tr>`;
}

function atualizarRodape(total, pagina, porPagina) {
  const ultima = Math.ceil(total / porPagina) || 1;
  const de = total ? (pagina - 1) * porPagina + 1 : 0;
  const ate = Math.min(pagina * porPagina, total);
  const nome = estado.tipo === 'NF' ? 'nota(s) fiscal(is)' : 'medição(ões)';

  const semData = estado.linhas.filter((b) => !b.vencimento).length;

  el('resumo-tabela').innerHTML = total
    ? `Mostrando ${de}–${ate} de ${numero(total)} ${nome}, do que vence primeiro ao que vence depois.` +
      (semData
        ? ` <strong>${semData} sem vencimento lido</strong> — aparecem no topo porque
            podem vencer a qualquer momento.`
        : '')
    : `Nenhuma ${estado.tipo === 'NF' ? 'nota fiscal' : 'medição'} para mostrar.`;
  el('indicador-pagina').textContent = `${pagina} de ${ultima}`;
  el('pagina-anterior').disabled = pagina <= 1;
  el('pagina-proxima').disabled = pagina >= ultima;
}

/* ========================================================================== *
 * Ações
 * ========================================================================== */
function acharBoleto(id) {
  return estado.linhas.find((b) => b.id === id);
}

function ligarAcoesDaTabela() {
  el('corpo-tabela')
    .querySelectorAll('[data-acao]')
    .forEach((botao) => {
      botao.addEventListener('click', async () => {
        const boleto = acharBoleto(botao.dataset.id);
        if (!boleto) return;
        switch (botao.dataset.acao) {
          case 'baixar': return baixarArquivo(boleto, botao);
          case 'copiar-codigo': return copiarCodigo(boleto);
          case 'associar': return associar(boleto);
          case 'recusar': return recusar(boleto);
          case 'reabrir': return reabrir(boleto);
          case 'descartar': return descartar(boleto);
          case 'restaurar': return restaurar(boleto);
          case 'completar': return completar(boleto);
          case 'detalhes': return verDetalhes(boleto);
        }
      });
    });
}

async function baixarArquivo(boleto, botao) {
  const original = botao.innerHTML;
  botao.disabled = true;
  botao.innerHTML = ICONES.atualizar;
  try {
    const url = await dados.urlDownload(boleto);
    if (!url) {
      avisar('Este é um boleto de exemplo — não existe arquivo para baixar.', 'atencao', 5000);
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = boleto.arquivo_nome ?? 'boleto.pdf';
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (erro) {
    avisar(`Não consegui baixar: ${erro.message}`, 'erro', 7000);
  } finally {
    botao.disabled = false;
    botao.innerHTML = original;
  }
}

async function copiarCodigo(boleto) {
  // Copiamos a LINHA DIGITÁVEL, que é o número de 47 dígitos que se digita no
  // banco — não o código de barras de 44. São diferentes, e trocar um pelo
  // outro é erro clássico.
  const linha =
    boleto.linha_digitavel ||
    parser.codigo44ParaLinha47(boleto.codigo_barras) ||
    boleto.codigo_barras;
  await copiar(linha, 'Linha digitável copiada. Cole no banco.');
}

async function associar(boleto) {
  // Boleto incompleto não pode ser associado (o banco recusa). Em vez de
  // mostrar o erro e deixar a pessoa adivinhar, abrimos o formulário já.
  if (boleto.qtd_pendencias > 0) {
    avisar(`Falta preencher: ${(boleto.pendencias ?? []).join(', ')}.`, 'atencao', 7000);
    return completar(boleto);
  }

  const alertas = [];
  if (!boleto.documento_regularizado) {
    alertas.push(`O solicitante marcou a ${boleto.tipo_documento} como NÃO regularizada.`);
  }
  if (boleto.extracao_confianca !== 'alta') {
    alertas.push('O valor e o vencimento não vieram conferidos pelo dígito verificador.');
  }
  if (boleto.situacao_vencimento === 'vencido') {
    alertas.push('Este boleto já está vencido.');
  }

  const ok = await confirmar({
    titulo: `Associar o boleto #${boleto.numero_protocolo}?`,
    mensagem:
      `${boleto.fornecedor_razao_social} · ${moeda(boleto.valor)} · vence ${fmtData(boleto.vencimento)}\n` +
      `${boleto.unidade_negocio} · conta ${boleto.cc}` +
      (alertas.length ? `\n\nAtenção: ${alertas.join(' ')}` : '') +
      '\n\nSeu nome vai ficar registrado na coluna "Executado por".',
    textoConfirmar: 'Associar',
  });
  if (!ok) return;

  try {
    await dados.associarBoleto(boleto.id);
    avisar(`Boleto #${boleto.numero_protocolo} associado.`, 'ok');
    await Promise.all([atualizarKpis(), carregarTabela({ silencioso: true })]);
  } catch (erro) {
    avisar(erro.message, 'erro', 8000);
  }
}

async function recusar(boleto) {
  const motivo = await pedirTexto({
    titulo: `Recusar o boleto #${boleto.numero_protocolo}`,
    rotulo: 'O que o solicitante precisa corrigir?',
    dica: 'Este texto aparece para quem enviou o boleto. Seja específico.',
    textoConfirmar: 'Recusar e devolver',
  });
  if (!motivo) return;

  try {
    await dados.recusarBoleto(boleto.id, motivo);
    avisar('Boleto devolvido ao solicitante.', 'ok');
    await Promise.all([atualizarKpis(), carregarTabela({ silencioso: true })]);
  } catch (erro) {
    avisar(erro.message, 'erro', 8000);
  }
}

async function reabrir(boleto) {
  const ok = await confirmar({
    titulo: `Desfazer a associação de #${boleto.numero_protocolo}?`,
    mensagem: `O boleto volta para a fila de pendentes. A associação feita por ${boleto.associado_por_nome ?? 'alguém'} fica registrada no histórico.`,
    textoConfirmar: 'Desfazer',
    perigo: true,
  });
  if (!ok) return;

  try {
    await dados.reabrirBoleto(boleto.id, 'Associação desfeita pelo operador');
    avisar('Boleto reaberto.', 'ok');
    await Promise.all([atualizarKpis(), carregarTabela({ silencioso: true })]);
  } catch (erro) {
    avisar(erro.message, 'erro', 8000);
  }
}

/* ========================================================================== *
 * Descartar e restaurar
 * ========================================================================== *
 * Descartar não apaga. O registro fica, com motivo e autor, e sai da fila e
 * dos indicadores. O protocolo continua na sequência — quem procurar acha, e
 * o histórico explica.
 *
 * O motivo é obrigatório de propósito: sem ele, o protocolo faltando na
 * numeração seria um enigma para quem olhar depois.
 */
async function descartar(boleto) {
  const motivo = await pedirTexto({
    titulo: `Descartar o boleto #${boleto.numero_protocolo}?`,
    rotulo: 'Por que este boleto está sendo descartado?',
    dica:
      'O registro não é apagado: ele sai da fila e dos indicadores, e este texto ' +
      'fica no histórico. Quem enviou vai ver o motivo.',
    textoConfirmar: 'Descartar',
    perigo: true,
  });
  if (!motivo) return;

  try {
    await dados.descartarBoleto(boleto.id, motivo);
    avisar(`Boleto #${boleto.numero_protocolo} descartado.`, 'ok');
    await Promise.all([atualizarKpis(), carregarTabela({ silencioso: true })]);
  } catch (erro) {
    avisar(erro.message, 'erro', 9000);
  }
}

async function restaurar(boleto) {
  const ok = await confirmar({
    titulo: `Trazer o #${boleto.numero_protocolo} de volta?`,
    mensagem:
      `Ele volta para a fila como pendente. O motivo do descarte ` +
      `("${boleto.observacoes_operador ?? 'sem motivo'}") fica no histórico.`,
    textoConfirmar: 'Restaurar',
  });
  if (!ok) return;

  try {
    await dados.restaurarBoleto(boleto.id);
    avisar('Boleto restaurado. Está de volta na fila.', 'ok');
    await Promise.all([atualizarKpis(), carregarTabela({ silencioso: true })]);
  } catch (erro) {
    avisar(erro.message, 'erro', 9000);
  }
}

/* ========================================================================== *
 * Completar o boleto — o trabalho que saiu do cliente e veio para cá
 * ========================================================================== *
 * O cliente agora só entrega o arquivo. O que o leitor não conseguiu extrair
 * fica em branco, e é aqui que se preenche.
 *
 * A conta bancária é o caso mais importante: 69% das empresas do grupo têm mais
 * de uma conta ativa (a SERENA GERAÇÃO tem 20), então não existe jeito de
 * adivinhar. Escolher é decisão da operação, e é por isso que este formulário
 * existe.
 *
 * O que estiver preenchido vem preenchido. Campos em branco ganham um contorno
 * laranja, para o olho ir direto no que falta.
 */
async function completar(boleto) {
  const pendentes = new Set(boleto.pendencias ?? []);
  const falta = (nome) => (pendentes.has(nome) ? ' campo--falta' : '');

  const departamentos = await dados.listarDepartamentos().catch(() => []);

  const corpo = `
    <div class="aviso aviso--${boleto.qtd_pendencias ? 'atencao' : 'info'}" style="margin-bottom:18px;">
      ${boleto.qtd_pendencias ? ICONES.alerta : ICONES.info}
      <div>
        ${
          boleto.qtd_pendencias
            ? `<span class="aviso__titulo">Falta preencher ${boleto.qtd_pendencias} item(ns)</span>
               ${escapar((boleto.pendencias ?? []).join(', '))}.`
            : `<span class="aviso__titulo">Nada obrigatório em falta</span>
               Você ainda pode corrigir qualquer campo antes de associar.`
        }
        ${
          boleto.extracao_confianca !== 'alta'
            ? '<br />A leitura não fechou no dígito verificador — vale abrir o PDF e comparar.'
            : ''
        }
      </div>
    </div>

    <div class="grupo-campos">
      <div class="campo campo--largo${falta('unidade de negócio')}">
        <label class="campo__rotulo" for="c-empresa">Unidade de negócio <span class="obrigatorio">*</span></label>
        <input type="search" id="c-empresa" autocomplete="off"
               placeholder="Nome ou CNPJ da empresa"
               value="${escapar(boleto.unidade_negocio ?? '')}" />
        <span class="campo__dica" id="c-empresa-dica">
          ${boleto.unidade_cnpj ? 'Veio do CNPJ lido no boleto: ' + escapar(fmtCnpj(boleto.unidade_cnpj)) : 'O boleto não trouxe um CNPJ do grupo.'}
        </span>
        <div class="resultados-busca oculto" id="c-resultados"></div>
      </div>

      <div class="campo campo--largo${falta('conta bancária')}">
        <label class="campo__rotulo" for="c-conta">Conta bancária (CC) <span class="obrigatorio">*</span></label>
        <select id="c-conta"><option value="">Escolha a empresa primeiro</option></select>
        <span class="campo__dica" id="c-conta-dica"></span>
      </div>

      <div class="campo${falta('número do documento')}">
        <label class="campo__rotulo" for="c-numero">Nº do documento <span class="obrigatorio">*</span></label>
        <input type="text" id="c-numero" value="${escapar(boleto.numero_documento ?? '')}" />
      </div>

      <div class="campo${falta('departamento')}">
        <label class="campo__rotulo" for="c-departamento">Departamento <span class="obrigatorio">*</span></label>
        <select id="c-departamento">
          <option value="">Selecione</option>
          ${departamentos
            .map((d) => `<option value="${escapar(d)}" ${d === boleto.departamento ? 'selected' : ''}>${escapar(d)}</option>`)
            .join('')}
        </select>
      </div>

      <div class="campo campo--largo${falta('fornecedor')}">
        <label class="campo__rotulo" for="c-fornecedor">Fornecedor <span class="obrigatorio">*</span></label>
        <input type="text" id="c-fornecedor" value="${escapar(boleto.fornecedor_razao_social ?? '')}" />
      </div>

      <div class="campo">
        <label class="campo__rotulo" for="c-fornecedor-cnpj">CNPJ do fornecedor</label>
        <input type="text" id="c-fornecedor-cnpj"
               value="${escapar(boleto.fornecedor_cnpj ? fmtCnpj(boleto.fornecedor_cnpj) : '')}" />
      </div>

      <div class="campo${falta('valor')}">
        <label class="campo__rotulo" for="c-valor">Valor <span class="obrigatorio">*</span></label>
        <input type="text" id="c-valor" inputmode="decimal"
               value="${boleto.valor != null ? String(boleto.valor).replace('.', ',') : ''}" />
      </div>

      <div class="campo${falta('vencimento')}">
        <label class="campo__rotulo" for="c-vencimento">Vencimento <span class="obrigatorio">*</span></label>
        <input type="date" id="c-vencimento" value="${escapar(boleto.vencimento ?? '')}" />
      </div>

      <div class="campo campo--largo">
        <label class="opcao-radio" style="display:inline-flex;">
          <input type="checkbox" id="c-regularizado" ${boleto.documento_regularizado ? 'checked' : ''} />
          Confirmo que o documento está regularizado
        </label>
        <span class="campo__dica">
          ${boleto.tipo_documento === 'MD'
            ? 'MD precisa estar aprovada e com a forma de pagamento atualizada.'
            : 'NF precisa estar escriturada e com a forma de pagamento atualizada.'}
        </span>
      </div>
    </div>`;

  const { elemento, fechar } = abrirModal({
    titulo: `Completar o boleto #${boleto.numero_protocolo}`,
    corpoHtml: corpo,
    largo: true,
    rodapeHtml: `
      <button class="botao botao--contorno" data-acao="ver-pdf">Abrir o PDF</button>
      <button class="botao botao--fantasma" data-acao="fechar-completar">Cancelar</button>
      <button class="botao botao--principal" data-acao="salvar-completar">Salvar</button>`,
  });

  const q = (id) => elemento.querySelector(`#${id}`);
  let empresaEscolhida = boleto.unidade_cnpj ?? null;

  async function carregarContasDaEmpresa(documento, contaAtual) {
    const contas = await contasDaEmpresa(documento);
    preencherSelectContas(q('c-conta'), contas, contaAtual);
    q('c-conta-dica').textContent =
      contas.length === 1
        ? 'Esta empresa tem uma conta ativa só, e ela já está selecionada.'
        : `${contas.length} contas ativas. Escolha a que vai pagar este boleto.`;
  }

  if (empresaEscolhida) {
    const emp = await empresaPorDocumento(empresaEscolhida);
    if (emp) {
      q('c-empresa').value = emp.razaoSocial;
      await carregarContasDaEmpresa(empresaEscolhida, boleto.cc);
    }
  }

  // Busca de empresa, com os romanos normalizados (ver contas.js)
  q('c-empresa').addEventListener(
    'input',
    aguardarPausa(async () => {
      const termo = q('c-empresa').value.trim();
      const lista = q('c-resultados');
      if (termo.length < 2) return lista.classList.add('oculto');

      const achadas = await buscarEmpresas(termo, 8);
      lista.classList.remove('oculto');
      lista.innerHTML = achadas.length
        ? achadas
            .map(
              (e) => `<button type="button" class="resultados-busca__item" data-doc="${escapar(e.documento)}">
                        <span class="resultados-busca__nome">${escapar(e.razaoSocial)}</span>
                        <span class="resultados-busca__meta">${escapar(formatarDocumento(e))} ·
                          ${e.contas.filter((c) => c.ativa).length} conta(s)</span>
                        ${
                          e.achouPor === 'nome anterior' || e.achouPor === 'nome jurídico'
                            ? `<span class="resultados-busca__origem">encontrada pelo ${escapar(e.achouPor)}: ${escapar(e.nomeQueCasou)}</span>`
                            : ''
                        }
                      </button>`
            )
            .join('')
        : '<div class="resultados-busca__vazio">Nenhuma empresa encontrada.</div>';

      lista.querySelectorAll('[data-doc]').forEach((botao) => {
        botao.addEventListener('click', async () => {
          empresaEscolhida = botao.dataset.doc;
          const emp = await empresaPorDocumento(empresaEscolhida);
          q('c-empresa').value = emp?.razaoSocial ?? '';
          q('c-empresa-dica').textContent = formatarDocumento(emp);
          lista.classList.add('oculto');
          await carregarContasDaEmpresa(empresaEscolhida, null);
        });
      });
    }, 220)
  );

  elemento.querySelector('[data-acao=fechar-completar]').addEventListener('click', fechar);
  elemento.querySelector('[data-acao=ver-pdf]').addEventListener('click', (ev) =>
    baixarArquivo(boleto, ev.currentTarget)
  );

  elemento.querySelector('[data-acao=salvar-completar]').addEventListener('click', async (ev) => {
    const paraNumero = (t) => {
      const n = Number(String(t).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    try {
      await comBotaoOcupado(ev.currentTarget, 'Salvando...', () =>
        dados.completarBoleto(boleto.id, {
          conta: q('c-conta').value || null,
          empresaDocumento: empresaEscolhida,
          numeroDocumento: q('c-numero').value.trim() || null,
          valor: paraNumero(q('c-valor').value),
          vencimento: q('c-vencimento').value || null,
          fornecedor: q('c-fornecedor').value.trim() || null,
          fornecedorCnpj: q('c-fornecedor-cnpj').value.replace(/\D+/g, '') || null,
          departamento: q('c-departamento').value || null,
          regularizado: q('c-regularizado').checked,
        })
      );
      avisar('Dados salvos.', 'ok');
      fechar();
      await Promise.all([atualizarKpis(), carregarTabela({ silencioso: true })]);
    } catch (erro) {
      avisar(erro.message, 'erro', 9000);
    }
  });
}

/* ========================================================================== *
 * Detalhes
 * ========================================================================== */
async function verDetalhes(boleto) {
  const item = (rotulo, valor) => `
    <div class="lista-detalhes__item">
      <span class="lista-detalhes__rotulo">${escapar(rotulo)}</span>
      <span class="lista-detalhes__valor">${valor ?? '—'}</span>
    </div>`;

  const linhaDigitavel =
    boleto.linha_digitavel ?? parser.codigo44ParaLinha47(boleto.codigo_barras ?? '') ?? null;

  const conta = [boleto.cc, boleto.conta_banco, boleto.conta_agencia ? `ag. ${boleto.conta_agencia}` : null, boleto.conta_tipo]
    .filter(Boolean)
    .map(escapar)
    .join(' · ');

  const corpo = `
    <div class="lista-detalhes">
      ${item('Protocolo', `#${boleto.numero_protocolo}`)}
      ${item('Situação', `<span class="selo selo--${boleto.status}">${boleto.status}</span>`)}
      ${item('Documento', escapar(boleto.documento_rotulo))}
      ${item('Regularizado', boleto.documento_regularizado ? 'Sim' : '<strong>Não</strong>')}
      ${item('Solicitante', `${escapar(boleto.nome)} · ${escapar(boleto.solicitante_email)}`)}
      ${item('Enviado em', dataHora(boleto.data_envio))}
      ${item('Unidade de negócio', `${escapar(boleto.unidade_negocio)}<br /><small>${escapar(fmtCnpj(boleto.unidade_cnpj))}${boleto.grupo_economico ? ` · grupo ${escapar(boleto.grupo_economico)}` : ''}</small>`)}
      ${item('Conta (CC)', conta)}
      ${item('Fornecedor', `${escapar(boleto.fornecedor_razao_social)}${boleto.fornecedor_cnpj ? `<br /><small>${escapar(fmtCnpj(boleto.fornecedor_cnpj))}</small>` : ''}`)}
      ${item('Valor', moeda(boleto.valor))}
      ${item('Vencimento', `${fmtData(boleto.vencimento)}${boleto.dias_para_vencer != null ? ` <small>(${boleto.dias_para_vencer} dia(s))</small>` : ''}`)}
      ${item('Data desejada de pagamento', fmtData(boleto.data_pagamento_desejada))}
      ${item('Departamento', escapar(boleto.departamento))}
      ${item('Banco emissor', escapar(boleto.banco_emissor))}
      ${item('Linha digitável', linhaDigitavel ? `<code>${escapar(parser.formatarLinha47(linhaDigitavel))}</code>` : '—')}
      ${item('Código de barras', boleto.codigo_barras ? `<code>${escapar(boleto.codigo_barras)}</code>` : '—')}
      ${item('Como os dados foram lidos', `${escapar(boleto.extracao_confianca ?? '—')} · <small>${escapar(boleto.extracao_metodo ?? '')}</small>`)}
      ${item('Arquivo', `${escapar(boleto.arquivo_nome)} <small>(${tamanhoArquivo(boleto.arquivo_tamanho)})</small>`)}
      ${item('Observações do solicitante', escapar(boleto.observacoes_cliente) || '—')}
      ${item('Observações da operação', escapar(boleto.observacoes_operador) || '—')}
      ${item('Associado em', boleto.data_associacao ? dataHora(boleto.data_associacao) : '—')}
      ${item('Executado por', escapar(boleto.associado_por_nome) || '—')}
    </div>
    <h3 style="margin:22px 0 10px;">Histórico</h3>
    <div id="historico-boleto"><div class="esqueleto" style="width:60%"></div></div>`;

  const { elemento } = abrirModal({
    titulo: `Boleto #${boleto.numero_protocolo}`,
    corpoHtml: corpo,
    largo: true,
    rodapeHtml: '<button class="botao botao--contorno" data-acao="baixar-detalhe">Baixar o boleto</button>',
    aoAbrir: (raiz) => {
      raiz.querySelector('[data-acao=baixar-detalhe]')?.addEventListener('click', (ev) =>
        baixarArquivo(boleto, ev.currentTarget)
      );
    },
  });

  try {
    const eventos = await dados.historico(boleto.id);
    const area = elemento.querySelector('#historico-boleto');
    area.innerHTML = eventos.length
      ? `<div class="lista-detalhes">${eventos
          .map((ev) =>
            item(
              dataHora(ev.criado_em),
              `<strong>${escapar(ev.tipo)}</strong>${ev.usuario_email ? ` · ${escapar(ev.usuario_email)}` : ''}${ev.observacao ? `<br /><small>${escapar(ev.observacao)}</small>` : ''}`
            )
          )
          .join('')}</div>`
      : '<p class="campo__dica">Sem eventos registrados.</p>';
  } catch (erro) {
    elemento.querySelector('#historico-boleto').innerHTML =
      `<p class="campo__dica">Não consegui carregar o histórico: ${escapar(erro.message)}</p>`;
  }
}

/* ========================================================================== *
 * Exportar
 * ========================================================================== */
async function exportarCsv() {
  try {
    avisar('Montando o arquivo...', 'info', 1800);
    const { linhas } = await dados.listarBoletos({
      escopo: 'todos',
      tipo: estado.tipo,
      status: estado.status,
      busca: estado.busca,
      pagina: 1,
      porPagina: 5000,
      ordenarPor: estado.ordenarPor,
      ordem: estado.ordem,
    });

    const colunas = [
      ['Protocolo', (b) => b.numero_protocolo],
      ['Tipo', (b) => b.tipo_documento],
      ['NF/MD', (b) => b.documento_rotulo],
      ['Data de envio', (b) => fmtData(b.data_envio)],
      ['Nome', (b) => b.nome],
      ['E-mail', (b) => b.solicitante_email],
      ['CC (conta)', (b) => b.cc],
      ['Banco da conta', (b) => b.conta_banco],
      ['Tipo da conta', (b) => b.conta_tipo],
      ['Unidade de negócio', (b) => b.unidade_negocio],
      ['CNPJ da unidade', (b) => b.unidade_cnpj],
      ['Fornecedor', (b) => b.fornecedor_razao_social],
      ['CNPJ do fornecedor', (b) => b.fornecedor_cnpj],
      ['Valor', (b) => (b.valor != null ? String(b.valor).replace('.', ',') : '')],
      ['Vencimento', (b) => fmtData(b.vencimento)],
      ['Código de barras', (b) => b.codigo_barras],
      ['Situação', (b) => b.status],
      ['Data de associação', (b) => (b.data_associacao ? fmtData(b.data_associacao) : '')],
      ['Executado por', (b) => b.associado_por_nome],
      ['Departamento', (b) => b.departamento],
    ];

    const esc = (v) => {
      const t = v == null ? '' : String(v);
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };

    // Ponto e vírgula é o separador que o Excel em português espera.
    const csv = [
      colunas.map((c) => c[0]).join(';'),
      ...linhas.map((b) => colunas.map((c) => esc(c[1](b))).join(';')),
    ].join('\r\n');

    // O BOM na frente faz o Excel entender os acentos.
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `boletos-${estado.tipo.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    avisar(`${linhas.length} boleto(s) exportado(s).`, 'ok');
  } catch (erro) {
    avisar(`Não consegui exportar: ${erro.message}`, 'erro', 8000);
  }
}

/* ========================================================================== */
iniciar().catch((erro) => {
  console.error(erro);
  avisar(`Erro ao abrir o painel: ${erro.message}`, 'erro', 10000);
});
