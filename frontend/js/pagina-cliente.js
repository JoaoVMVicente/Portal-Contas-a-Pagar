/**
 * pagina-cliente.js — Anexar boletos e confirmar. Nada mais.
 * ===========================================================================
 * A MUDANÇA DE RESPONSABILIDADE
 * ===========================================================================
 * A versão anterior tinha sete etapas e pedia para a pessoa conferir campo por
 * campo. Estava errado por dois motivos.
 *
 * O primeiro é aritmético: quinze boletos vezes oito etapas dá cento e vinte
 * interações, e em seis delas a pessoa só confirmava algo que o sistema já
 * havia lido do arquivo.
 *
 * O segundo é de papéis, e é o que importa: quem confere boleto é a operação,
 * não quem envia. Pedir confirmação a quem não tem como conferir produz um
 * "sim" automático — pior que não perguntar, porque cria a ilusão de que
 * alguém validou.
 *
 * Então agora: a pessoa solta os arquivos, diz se é NF ou MD, confirma o nome,
 * e envia. O que o leitor conseguir extrair vai junto como rascunho, marcado
 * para a operação revisar. O que ele não conseguir fica em branco — e o boleto
 * entra assim mesmo, porque é justamente esse que mais precisa de olho humano.
 *
 * A trava não desapareceu: mudou de lugar. O banco recusa ASSOCIAR um boleto
 * incompleto (db/10). A porta de entrada é larga; a de saída é estreita.
 */

import { CONFIG } from './config.js';
import { dados } from './dados.js';
import * as sessao from './sessao.js';
import { montarTopo, montarRodape, ligarBotaoDemo } from './layout.js';
import {
  ICONES, avisar, escapar, moeda, data as fmtData, dataHora, tamanhoArquivo,
  cnpj as fmtCnpj, pintarIcones, copiar, comBotaoOcupado, aguardarPausa,
} from './ui.js';
import { carregarContas, acharEmpresa, criarVerificadorDeEmpresa } from './contas.js';
import { extrairDoArquivo } from './extrator.js';

const el = (id) => document.getElementById(id);
const MAXIMO = 20;

// O departamento é da pessoa, não do boleto — ela não deveria escolher de novo
// a cada envio. Guardamos a escolha no navegador. Não fica no perfil do banco
// porque isso exigiria migração, e o ganho seria pequeno: quem troca de
// departamento troca uma vez na vida.
const CHAVE_TIPO = 'serena.tipo-padrao';

/**
 * O tipo vale para o LOTE inteiro, e é escolhido antes de anexar.
 *
 * A versão anterior deixava escolher boleto a boleto. A equipe pediu o
 * contrário: o tipo é do processo, não do arquivo. Um envio com sete NF e treze
 * MD misturados atrapalha a conferência do outro lado, porque cada fila é de
 * uma equipe diferente.
 *
 * Nulo até a pessoa escolher — a área de upload fica bloqueada antes disso.
 */
let tipoDoLote = null;

/**
 * Cada arquivo solto vira um item desta lista. O `estado` de cada um conta a
 * história dele: aguardando, lendo, lido, repetido, enviado, falhou.
 */
const itens = [];
let enviando = false;

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

  // A identidade é mostrada, não preenchida. O banco carimba de qualquer jeito
  // (db/13), então um campo editável só criaria a ilusão de que dá para mudar.
  const p = sessao.perfil();
  const emailDaConta = sessao.usuario()?.email ?? '';
  const nomeCompleto = [p?.nome, p?.sobrenome].filter(Boolean).join(' ') ||
                       emailDaConta.split('@')[0];
  // Mesma proteção: a tela não pode morrer por causa de um cartão informativo.
  const escrever = (id, texto) => {
    const alvo = el(id);
    if (alvo) alvo.textContent = texto;
    else console.warn(`Elemento #${id} não existe — o cliente.html está desatualizado.`);
  };
  escrever('ident-nome', nomeCompleto);
  escrever('ident-email', emailDaConta);
  escrever('ident-inicial', (nomeCompleto[0] ?? '?').toUpperCase());

  // O tipo do último envio volta marcado, mas a pessoa precisa confirmar:
  // deixar pré-selecionado sem ela olhar é como não perguntar.
  atualizarTravaDoUpload();

  ligarUpload();
  ligarEnvio();

  await Promise.all([montarDepartamento(), carregarMeusBoletos()]);

  // Ao vivo: se a operação associar ou recusar enquanto a página está aberta,
  // a lista se atualiza e um aviso aparece.
  dados.assinarMudancas(
    aguardarPausa(async () => {
      await carregarMeusBoletos({ avisarMudanca: true });
    }, 500)
  );
}

/* ========================================================================== *
 * O departamento
 * ========================================================================== *
 * Deixou de ser pergunta a cada envio. É atributo da pessoa: quem é do
 * Financeiro manda boleto do Financeiro, sempre. Perguntar cem vezes é pedir a
 * mesma resposta cem vezes, e abrir espaço para responder diferente por engano.
 *
 * Fica no perfil, informado uma vez no primeiro acesso. Aqui ele só aparece
 * para conferência, sem campo editável — e mesmo que alguém edite o HTML, o
 * banco carimba a partir do perfil (db/14).
 *
 * Quem já tinha conta antes desta mudança não passou pelo primeiro acesso de
 * novo. Para essas pessoas, e só na primeira vez, o campo aparece editável.
 */
async function montarDepartamento() {
  const area = el('bloco-departamento');

  // Se o cliente.html na pasta for de uma versão anterior, este bloco não
  // existe. Antes, isso derrubava a tela inteira com "Cannot set properties of
  // null" — e a pessoa perdia "Meus boletos" por causa de um campo opcional.
  // Um pedaço da tela que não carrega não deve levar o resto junto.
  if (!area) {
    console.warn('#bloco-departamento não existe. O cliente.html é de uma versão anterior.');
    return;
  }

  const atual = sessao.meuDepartamento();

  if (atual) {
    area.innerHTML = `
      <span class="campo__rotulo">Seu departamento</span>
      <div class="cartao-identidade">
        <span class="cartao-identidade__inicial">${escapar(atual[0].toUpperCase())}</span>
        <div><span class="cartao-identidade__nome">${escapar(atual)}</span></div>
        <span class="cartao-identidade__selo" data-icone="cadeado"
              title="Vem do seu perfil e vai junto em todo boleto"></span>
      </div>
      <span class="campo__dica">
        Vem do seu perfil. Se mudou de área, fale com quem administra o portal.
      </span>`;
    pintarIcones(area);
    return;
  }

  // Ainda não escolheu. Pedimos uma vez, aqui mesmo.
  let lista = [];
  try {
    lista = await dados.departamentosSugeridos();
  } catch (erro) {
    console.warn('Não consegui carregar a lista de departamentos:', erro);
  }

  area.innerHTML = `
    <label class="campo__rotulo" for="departamento">
      Seu departamento <span class="obrigatorio">*</span>
    </label>
    <div style="display:flex;gap:8px;align-items:flex-start;">
      <select id="departamento" style="flex:1 1 auto;">
        <option value="">Selecione</option>
        ${lista.map((n) => `<option value="${escapar(n)}">${escapar(n)}</option>`).join('')}
      </select>
      <button type="button" class="botao botao--contorno" id="salvar-departamento">Guardar</button>
    </div>
    <span class="campo__dica">
      Você escolhe uma vez só. Depois ele vai junto em todos os seus boletos.
    </span>
    <span class="campo__erro oculto" id="erro-departamento"></span>`;

  el('salvar-departamento').addEventListener('click', async (ev) => {
    const valor = el('departamento').value;
    if (!valor) {
      const erro = el('erro-departamento');
      erro.innerHTML = `${ICONES.alerta}Escolha o seu departamento.`;
      erro.classList.remove('oculto');
      return;
    }
    try {
      await comBotaoOcupado(ev.currentTarget, 'Guardando...', async () => {
        await dados.definirMeuDepartamento(valor);
        await sessao.recarregarPerfil();
      });
      avisar('Departamento guardado. Não vamos perguntar de novo.', 'ok');
      await montarDepartamento();
    } catch (erro) {
      avisar(erro.message, 'erro', 8000);
    }
  });
}

/* ========================================================================== *
 * Receber os arquivos
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

  area.addEventListener('drop', (ev) => receberArquivos(ev.dataTransfer?.files));
  campo.addEventListener('change', () => {
    receberArquivos(campo.files);
    campo.value = ''; // permite soltar o mesmo arquivo de novo depois
  });

  el('botao-limpar').addEventListener('click', () => {
    itens.length = 0;
    el('resultado-envio').innerHTML = '';
    el('motivo-prioridade').value = '';
    el('contador-motivo').textContent = '0/1000';
    document.querySelector('input[name=prioridade][value=nao]').checked = true;
    el('bloco-prioridade').classList.add('oculto');
    desenharLista();
    desenharResumo();
    avisar('Limpo. Pode começar de novo.', 'info', 2000);
  });
}

function problemaNoArquivo(arquivo) {
  const limite = CONFIG.TAMANHO_MAX_ARQUIVO_MB * 1024 * 1024;
  if (arquivo.size > limite) {
    return `tem ${tamanhoArquivo(arquivo.size)}, acima do limite de ${CONFIG.TAMANHO_MAX_ARQUIVO_MB} MB`;
  }
  const tipoOk =
    CONFIG.TIPOS_ACEITOS.includes(arquivo.type) || /\.(pdf|png|jpe?g|webp)$/i.test(arquivo.name);
  return tipoOk ? null : 'não é PDF, PNG nem JPG';
}

async function receberArquivos(listaBruta) {
  const novos = Array.from(listaBruta ?? []);
  if (!novos.length) return;

  const erro = el('erro-arquivo');
  erro.classList.add('oculto');

  const vaga = MAXIMO - itens.length;
  if (vaga <= 0) {
    erro.innerHTML = `${ICONES.alerta}Você já tem ${MAXIMO} arquivos, que é o limite de um envio.`;
    erro.classList.remove('oculto');
    return;
  }

  const aceitos = novos.slice(0, vaga);
  if (novos.length > vaga) {
    erro.innerHTML =
      `${ICONES.alerta}Peguei ${vaga} de ${novos.length} arquivos — o limite é ${MAXIMO} por envio. ` +
      'Envie estes e depois solte o resto.';
    erro.classList.remove('oculto');
  }

  for (const arquivo of aceitos) {
    const problema = problemaNoArquivo(arquivo);
    // Arquivo repetido no mesmo lote: fácil de acontecer arrastando duas vezes.
    const jaEsta = itens.some(
      (i) => i.arquivo.name === arquivo.name && i.arquivo.size === arquivo.size
    );

    itens.push({
      id: `item-${Math.random().toString(36).slice(2, 10)}`,
      arquivo,
      // O número continua por boleto: o que está impresso frequentemente NÃO é
      // o número da nota, e quem sabe é quem envia. O tipo saiu daqui — agora
      // é do lote inteiro.
      numero: '',
      prioritario: false,
      estado: problema ? 'invalido' : jaEsta ? 'duplicado_no_lote' : 'aguardando',
      motivo: problema ?? (jaEsta ? 'este arquivo já está na lista' : null),
      progresso: null,
      lido: null,
      empresa: null,
      anteriores: [],
    });
  }

  desenharLista();
  await lerPendentes();
  desenharSelecaoDeBoletos();
}

/* ========================================================================== *
 * Ler cada arquivo
 * ========================================================================== */
async function lerPendentes() {
  await carregarContas();
  const ehNossaEmpresa = await criarVerificadorDeEmpresa();

  for (const item of itens) {
    if (item.estado !== 'aguardando') continue;

    item.estado = 'lendo';
    item.progresso = 'abrindo o arquivo...';
    desenharLista();

    try {
      const lido = await extrairDoArquivo(
        item.arquivo,
        (mensagem) => {
          item.progresso = mensagem;
          atualizarLinha(item);
        },
        { ehNossaEmpresa, tipoDocumento: tipoDoLote }
      );

      item.lido = lido;
      item.empresa = lido.unidadeCnpj ? await acharEmpresa(lido.unidadeCnpj) : null;
      // O número lido é sugestão. Quem confirma é quem envia.
      if (!item.numero) item.numero = lido.numeroDocumento ?? '';

      // Este boleto já passou pelo portal?
      if (lido.codigoBarras) {
        item.anteriores = await dados.situacaoDoCodigo(lido.codigoBarras).catch(() => []);
      }
      const bloqueia = item.anteriores.some((b) => b.status !== 'recusado');

      // "Confiança alta" significa que o código de barras fechou no dígito
      // verificador — nada diz sobre os nomes. Um boleto-imagem cujo OCR falhou
      // vinha marcado como "lido por completo" com empresa e fornecedor em
      // branco, o que é justamente o contrário de informativo.
      const faltamNomes = !lido.unidadeCnpj && !lido.fornecedorRazaoSocial;
      item.estado = bloqueia
        ? 'repetido'
        : lido.confianca === 'alta' && !faltamNomes
          ? 'lido'
          : 'lido_parcial';
      item.motivo = bloqueia ? 'já está no portal' : null;
    } catch (erro) {
      console.error(erro);
      item.estado = 'lido_parcial';
      item.lido = null;
      item.motivo = 'não consegui ler o arquivo — vai em branco mesmo';
    }

    item.progresso = null;
    desenharLista();
  }

  desenharResumo();
}



/* ========================================================================== *
 * Desenhar a lista
 * ========================================================================== */
const SELOS = {
  aguardando: { icone: 'relogio', cor: 'neutro', texto: 'na fila' },
  lendo: { icone: 'atualizar', cor: 'neutro', texto: 'lendo' },
  lido: { icone: 'checkCirculo', cor: 'ok', texto: 'lido' },
  lido_parcial: { icone: 'alerta', cor: 'atencao', texto: 'leitura parcial' },
  repetido: { icone: 'xCirculo', cor: 'erro', texto: 'já está no portal' },
  invalido: { icone: 'xCirculo', cor: 'erro', texto: 'arquivo inválido' },
  duplicado_no_lote: { icone: 'xCirculo', cor: 'erro', texto: 'repetido na lista' },
  enviando: { icone: 'atualizar', cor: 'neutro', texto: 'enviando' },
  enviado: { icone: 'checkCirculo', cor: 'ok', texto: 'enviado' },
  falhou: { icone: 'xCirculo', cor: 'erro', texto: 'não enviou' },
};

function podeEnviar(item) {
  return ['lido', 'lido_parcial'].includes(item.estado);
}

function desenharLista() {
  const area = el('lista-arquivos');
  const bloco = el('bloco-dados');

  if (!itens.length) {
    area.innerHTML = '';
    bloco.classList.add('oculto');
    el('area-upload').classList.remove('oculto');
    return;
  }

  bloco.classList.remove('oculto');
  area.innerHTML = `
    <div class="lista-boletos">${itens.map(linhaDoItem).join('')}</div>
    ${
      itens.length < MAXIMO
        ? `<button type="button" class="botao botao--contorno botao--bloco" id="botao-mais-arquivos"
                   style="margin-top:12px;">
             ${ICONES.upload} Adicionar mais arquivos (${itens.length} de ${MAXIMO})
           </button>`
        : `<p class="campo__dica" style="text-align:center;margin-top:12px;">
             Você atingiu o limite de ${MAXIMO} arquivos por envio.
           </p>`
    }`;

  el('area-upload').classList.add('oculto');
  pintarIcones(area);

  el('botao-mais-arquivos')?.addEventListener('click', () => el('arquivo').click());

  area.querySelectorAll('[data-remover]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const i = itens.findIndex((x) => x.id === botao.dataset.remover);
      if (i >= 0) itens.splice(i, 1);
      desenharLista();
      desenharResumo();
    });
  });

  area.querySelectorAll('[data-copiar]').forEach((botao) => {
    botao.addEventListener('click', () => copiar(botao.dataset.copiar, 'Código copiado.'));
  });

  area.querySelectorAll('[data-numero]').forEach((campo) => {
    campo.addEventListener('input', () => {
      const item = itens.find((x) => x.id === campo.dataset.numero);
      if (item) item.numero = campo.value;
    });
  });

  atualizarBotaoEnviar();
}

function linhaDoItem(item) {
  const selo = SELOS[item.estado] ?? SELOS.aguardando;
  const l = item.lido;

  const dado = (rotulo, valor, destaque = false) => `
    <div class="lista-boletos__dado${destaque ? ' lista-boletos__dado--destaque' : ''}">
      <span class="lista-boletos__rotulo">${escapar(rotulo)}</span>
      <span class="lista-boletos__valor">${valor ?? '<em>não lido</em>'}</span>
    </div>`;

  const empresa = item.empresa
    ? `${escapar(item.empresa.empresa.razaoSocial)}` +
      (item.empresa.porRaiz
        ? ` <small>(filial ${escapar(item.empresa.filialDoBoleto)})</small>`
        : '')
    : null;

  const anteriores = item.anteriores.length
    ? `<div class="lista-boletos__nota">
         ${ICONES.info}
         <div>${item.anteriores
           .map((b) => {
             const quem = b.sou_eu ? 'você' : b.quem_enviou ?? 'outra pessoa da equipe';
             const sit =
               { pendente: 'está na fila', associado: 'foi associado', recusado: 'foi recusado' }[
                 b.status
               ] ?? b.status;
             const motivo = b.motivo_da_recusa ? ` — ${escapar(b.motivo_da_recusa)}` : '';
             return `Protocolo #${b.numero_protocolo}, enviado por ${escapar(quem)}, ${sit}${motivo}.`;
           })
           .join('<br />')}</div>
       </div>`
    : '';

  return `
  <div class="lista-boletos__item lista-boletos__item--${selo.cor}" data-id="${item.id}">
    <div class="lista-boletos__cabeca">
      <span class="lista-boletos__selo lista-boletos__selo--${selo.cor}"
            data-icone="${selo.icone}" title="${escapar(selo.texto)}"></span>
      <div class="lista-boletos__nome">
        ${escapar(item.arquivo.name)}
        <small>${tamanhoArquivo(item.arquivo.size)}</small>
      </div>
      <span class="lista-boletos__estado">${escapar(item.progresso ?? item.motivo ?? selo.texto)}</span>
      ${
        enviando
          ? ''
          : `<button type="button" class="acao-icone" data-remover="${item.id}"
                     title="Tirar da lista">${ICONES.x}</button>`
      }
    </div>

    ${
      l
        ? `<div class="lista-boletos__dados">
             ${dado('Documento', l.numeroDocumento ? escapar(l.numeroDocumento) : null)}
             ${dado('Empresa', empresa)}
             ${dado('Fornecedor', l.fornecedorRazaoSocial ? escapar(l.fornecedorRazaoSocial) : null)}
             ${dado('Valor', l.valor != null ? moeda(l.valor) : null, true)}
             ${dado('Vencimento', l.vencimento ? fmtData(l.vencimento) : null, true)}
             ${dado('Banco', escapar(l.bancoNome ?? l.banco ?? '') || null)}
             ${
               l.codigoBarras
                 ? `<div class="lista-boletos__dado lista-boletos__dado--largo">
                      <span class="lista-boletos__rotulo">Código de barras</span>
                      <span class="lista-boletos__valor">
                        <code>${escapar(l.codigoBarras)}</code>
                        <button type="button" class="acao-icone" data-copiar="${escapar(l.codigoBarras)}"
                                title="Copiar">${ICONES.copiar}</button>
                      </span>
                    </div>`
                 : ''
             }
           </div>`
        : ''
    }
    ${
      podeEnviar(item) || item.estado === 'enviando'
        ? `<div class="lista-boletos__editaveis">
             <label class="mini-campo mini-campo--largo">
               <span>Nº da ${tipoDoLote === 'MD' ? 'método direto' : 'nota fiscal'}</span>
               <input type="text" data-numero="${item.id}" ${enviando ? 'disabled' : ''}
                      value="${escapar(item.numero ?? '')}"
                      placeholder="${escapar(item.lido?.numeroDocumento ?? 'digite o número')}" />
             </label>
           </div>`
        : ''
    }
    ${anteriores}
  </div>`;
}

/** Atualiza só o texto de estado de um item, sem redesenhar a lista inteira. */
function atualizarLinha(item) {
  const alvo = document.querySelector(`[data-id="${item.id}"] .lista-boletos__estado`);
  if (alvo) alvo.textContent = item.progresso ?? item.motivo ?? '';
}

function desenharResumo() {
  const area = el('resumo-leitura');
  if (!itens.length) {
    area.innerHTML = '';
    return;
  }

  const conta = (...estados) => itens.filter((i) => estados.includes(i.estado)).length;
  const prontos = conta('lido');
  const parciais = conta('lido_parcial');
  const barrados = conta('repetido', 'invalido', 'duplicado_no_lote');
  const lendo = conta('lendo', 'aguardando');

  if (lendo) {
    area.innerHTML = `<div class="aviso aviso--info">${ICONES.atualizar}
      <div>Lendo ${lendo} de ${itens.length} arquivo(s)...</div></div>`;
    return;
  }

  const partes = [];
  if (prontos) partes.push(`<strong>${prontos}</strong> lido(s)`);
  if (parciais) partes.push(`<strong>${parciais}</strong> com leitura parcial`);
  if (barrados) partes.push(`<strong>${barrados}</strong> que não vão`);

  area.innerHTML = `
    <div class="aviso aviso--${barrados ? 'atencao' : 'ok'}">
      ${barrados ? ICONES.alerta : ICONES.checkCirculo}
      <div>
        <span class="aviso__titulo">${itens.length} arquivo(s): ${partes.join(', ')}</span>
        ${
          parciais
            ? 'Os de leitura parcial vão do mesmo jeito — a operação completa o que faltar. ' +
              'Você não precisa corrigir nada aqui.'
            : 'Estes dados vão para conferência da operação.'
        }
      </div>
    </div>`;
}

/**
 * Bloqueia a área de anexo enquanto o tipo não for escolhido.
 */
function atualizarTravaDoUpload() {
  const cartao = el('cartao-envio');
  const area = el('area-upload');
  if (!cartao || !area) return;

  const travado = !tipoDoLote;
  cartao.classList.toggle('cartao--travado', travado);
  area.setAttribute('aria-disabled', String(travado));
  area.style.pointerEvents = travado ? 'none' : '';

  const secundario = area.querySelector('.area-upload__secundario');
  if (secundario) {
    secundario.textContent = travado
      ? 'Escolha primeiro o tipo de pagamento, acima'
      : `PDF, PNG ou JPG · até ${MAXIMO} arquivos · ${CONFIG.TAMANHO_MAX_ARQUIVO_MB} MB cada`;
  }
}

/**
 * A lista de boletos que a pessoa pode marcar como prioritários.
 *
 * Só entram os que foram lidos sem erro. Um arquivo repetido ou inválido não
 * vai ser enviado, então oferecê-lo aqui seria pedir uma decisão sobre algo que
 * não vai existir.
 */
function desenharSelecaoDeBoletos() {
  const area = el('boletos-prioritarios');
  if (!area) return;

  const disponiveis = itens.filter(podeEnviar);

  if (!disponiveis.length) {
    area.innerHTML =
      '<p class="campo__dica" style="margin:0;">Anexe os boletos primeiro. ' +
      'Só os que forem lidos sem erro aparecem aqui.</p>';
    return;
  }

  area.innerHTML = disponiveis
    .map((item) => {
      const l = item.lido ?? {};
      const resumo = [
        item.numero ? `nº ${escapar(item.numero)}` : null,
        l.fornecedorRazaoSocial ? escapar(l.fornecedorRazaoSocial) : null,
        l.valor != null ? moeda(l.valor) : null,
        l.vencimento ? `vence ${fmtData(l.vencimento)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      return `
        <label class="selecao-boletos__item">
          <input type="checkbox" data-prioritario="${item.id}" ${item.prioritario ? 'checked' : ''} />
          <span>
            <strong>${escapar(item.arquivo.name)}</strong>
            <small>${resumo || 'sem dados lidos'}</small>
          </span>
        </label>`;
    })
    .join('');

  area.querySelectorAll('[data-prioritario]').forEach((caixa) => {
    caixa.addEventListener('change', () => {
      const item = itens.find((x) => x.id === caixa.dataset.prioritario);
      if (item) item.prioritario = caixa.checked;
      el('erro-boletos-prioritarios').classList.add('oculto');
    });
  });
}

function atualizarBotaoEnviar() {
  const quantos = itens.filter(podeEnviar).length;
  const botao = el('botao-enviar');
  if (!botao) return;
  botao.disabled = quantos === 0 || enviando;
  botao.textContent = quantos === 1 ? 'Enviar 1 boleto' : `Enviar ${quantos} boletos`;
}

/* ========================================================================== *
 * Enviar
 * ========================================================================== */
function ligarEnvio() {
  /* ---------------------------------------------------------------------- *
   * O tipo destrava o upload
   * ---------------------------------------------------------------------- *
   * Antes de escolher NF ou MD, a área de anexo fica bloqueada. É mais honesto
   * que deixar anexar e recusar depois — e evita ler vinte arquivos com o tipo
   * errado, o que muda o palpite do número do documento.
   */
  document.querySelectorAll('input[name=tipo]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const novo = radio.value;

      // Trocar de tipo com arquivos na lista significa começar de novo: os
      // dois não convivem no mesmo envio, e reaproveitar a leitura seria
      // guardar boletos do tipo que a pessoa acabou de dizer que não é.
      if (tipoDoLote && tipoDoLote !== novo && itens.length) {
        const ok = window.confirm(
          `Você tem ${itens.length} arquivo(s) anexado(s) como ` +
            `${tipoDoLote === 'NF' ? 'nota fiscal' : 'método direto'}. ` +
            'Trocar o tipo remove todos, porque NF e MD não podem ir no mesmo envio. Continuar?'
        );
        if (!ok) {
          // Devolve a marcação para o tipo que estava valendo.
          document.querySelector(`input[name=tipo][value="${tipoDoLote}"]`).checked = true;
          return;
        }
        itens.length = 0;
        el('resultado-envio').innerHTML = '';
      }

      tipoDoLote = novo;
      localStorage.setItem(CHAVE_TIPO, novo);
      el('erro-tipo').classList.add('oculto');
      atualizarTravaDoUpload();
      desenharLista();
      desenharResumo();
    });
  });

  // Prioridade: o bloco do motivo só aparece quando a resposta é sim.
  document.querySelectorAll('input[name=prioridade]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const querPrioridade = radio.value === 'sim' && radio.checked;
      el('bloco-prioridade').classList.toggle('oculto', !querPrioridade);
      if (querPrioridade) desenharSelecaoDeBoletos();
    });
  });

  el('motivo-prioridade').addEventListener('input', (ev) => {
    el('contador-motivo').textContent = `${ev.target.value.length}/1000`;
  });

  el('botao-atualizar-meus').addEventListener('click', () => carregarMeusBoletos());

  el('formulario-envio').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (enviando) return;

    document.querySelectorAll('.campo__erro').forEach((e) => e.classList.add('oculto'));

    if (!sessao.meuDepartamento()) {
      avisar('Informe o seu departamento antes de enviar.', 'atencao', 6000);
      el('departamento')?.focus();
      return;
    }

    if (!tipoDoLote) {
      el('erro-tipo').innerHTML = `${ICONES.alerta}Escolha o tipo de pagamento.`;
      el('erro-tipo').classList.remove('oculto');
      document.querySelector('input[name=tipo]')?.focus();
      return;
    }

    const fila = itens.filter(podeEnviar);
    if (!fila.length) return avisar('Nenhum arquivo pronto para enviar.', 'atencao');

    // Prioridade exige motivo e pelo menos um boleto escolhido. As duas travas
    // também existem no banco (db/17) — aqui é só para avisar antes.
    const querPrioridade =
      document.querySelector('input[name=prioridade]:checked')?.value === 'sim';
    const motivo = el('motivo-prioridade').value.trim();
    const marcados = fila.filter((i) => i.prioritario);

    if (querPrioridade) {
      if (motivo.length < 5) {
        el('erro-motivo-prioridade').innerHTML =
          `${ICONES.alerta}Descreva o motivo da priorização.`;
        el('erro-motivo-prioridade').classList.remove('oculto');
        el('motivo-prioridade').focus();
        return;
      }
      if (!marcados.length) {
        el('erro-boletos-prioritarios').innerHTML =
          `${ICONES.alerta}Selecione ao menos um boleto para a priorização.`;
        el('erro-boletos-prioritarios').classList.remove('oculto');
        return;
      }
    }

    // O número da nota é o único campo que só quem envia sabe: o que está
    // impresso no boleto muitas vezes é outra coisa (número do título, do
    // contrato, da fatura). Sem ele, a operação não tem como cruzar.
    const semNumero = fila.filter((i) => !String(i.numero ?? '').trim());
    if (semNumero.length) {
      el('erro-arquivo').innerHTML =
        `${ICONES.alerta}Falta o número da NF ou MD em ${semNumero.length} boleto(s). ` +
        'Preencha nos campos de cada arquivo.';
      el('erro-arquivo').classList.remove('oculto');
      document.querySelector(`[data-numero="${semNumero[0].id}"]`)?.focus();
      return;
    }

    enviando = true;
    atualizarBotaoEnviar();
    el('progresso-envio').classList.remove('oculto');

    const resultados = [];

    for (let i = 0; i < fila.length; i += 1) {
      const item = fila[i];
      item.estado = 'enviando';
      desenharLista();

      el('texto-progresso').textContent =
        `Enviando ${i + 1} de ${fila.length}: ${item.arquivo.name}`;
      el('barra-progresso').style.width = `${Math.round((i / fila.length) * 100)}%`;

      try {
        const criado = await dados.criarBoleto(
          montarRegistro(item, { prioridade: querPrioridade && item.prioritario, motivo }),
          item.arquivo
        );
        item.estado = 'enviado';
        resultados.push({ item, ok: true, protocolo: criado?.numero_protocolo });
      } catch (erro) {
        console.error(erro);
        item.estado = 'falhou';
        item.motivo = erro.message;
        resultados.push({ item, ok: false, erro: erro.message });
      }
      desenharLista();
    }

    el('barra-progresso').style.width = '100%';
    el('texto-progresso').textContent = 'Concluído.';
    enviando = false;

    desenharResultado(resultados);

    // Os que deram certo saem da lista; os que falharam ficam para tentar de novo.
    for (let i = itens.length - 1; i >= 0; i -= 1) {
      if (itens[i].estado === 'enviado') itens.splice(i, 1);
    }
    desenharLista();
    desenharResumo();
    el('progresso-envio').classList.add('oculto');
    el('barra-progresso').style.width = '0';

    await carregarMeusBoletos();
  });
}

/**
 * O registro que vai para o banco. Campos não lidos vão como null de propósito
 * — o banco aceita (db/10) e a operação completa depois.
 */
function montarRegistro(item, { prioridade, motivo }) {
  const l = item.lido ?? {};
  const empresa = item.empresa?.empresa ?? null;

  return {
    // Nome, sobrenome e e-mail NÃO vão daqui. O banco carimba a partir da conta
    // autenticada (db/13). Mandar seria inútil: seria descartado, e ainda
    // registraria uma divergência de identidade no histórico.
    tipo_documento: tipoDoLote,
    numero_documento: String(item.numero ?? '').trim() || null,
    documento_regularizado: false, // quem confirma isso é a operação

    unidade_negocio: empresa?.razaoSocial ?? null,
    unidade_cnpj: empresa?.documento ?? null,

    fornecedor_razao_social: l.fornecedorRazaoSocial ?? null,
    fornecedor_cnpj: l.fornecedorCnpj ?? null,

    valor: l.valor ?? null,
    vencimento: l.vencimento ?? null,
    data_pagamento_desejada: null,

    codigo_barras: l.codigoBarras ?? null,
    linha_digitavel: l.linhaDigitavel ?? null,
    banco_emissor: l.bancoNome ?? l.banco ?? null,
    extracao_confianca: l.confianca ?? 'manual',
    extracao_metodo: l.metodo ?? 'nenhum',
    extracao_avisos: l.avisos ?? [],

    // O departamento não vai daqui: o banco carimba a partir do perfil (db/14).
    prioridade: Boolean(prioridade),
    motivo_prioridade: prioridade ? motivo : null,
    observacoes_cliente: null,
  };
}

function desenharResultado(resultados) {
  const ok = resultados.filter((r) => r.ok);
  const falhas = resultados.filter((r) => !r.ok);

  el('resultado-envio').innerHTML = `
    <div class="aviso aviso--${falhas.length ? 'atencao' : 'ok'}" style="margin-top:18px;">
      ${falhas.length ? ICONES.alerta : ICONES.checkCirculo}
      <div>
        <span class="aviso__titulo">
          ${ok.length} boleto(s) enviado(s)${falhas.length ? `, ${falhas.length} não` : ''}
        </span>
        ${
          ok.length
            ? `Protocolos: ${ok.map((r) => `<strong>#${r.protocolo ?? '?'}</strong>`).join(', ')}.
               A operação vai conferir os dados e associar. Você acompanha em
               "Meus boletos" logo abaixo.`
            : ''
        }
        ${
          falhas.length
            ? `<ul style="margin-top:8px;">${falhas
                .map((r) => `<li>${escapar(r.item.arquivo.name)}: ${escapar(r.erro)}</li>`)
                .join('')}</ul>`
            : ''
        }
      </div>
    </div>`;

  if (ok.length) avisar(`${ok.length} boleto(s) enviado(s).`, 'ok', 4000);
}

function marcarErro(campo, mensagem) {
  const erro = el(`erro-${campo}`);
  if (erro) {
    erro.innerHTML = `${ICONES.alerta}${escapar(mensagem)}`;
    erro.classList.remove('oculto');
  }
  el(campo)?.focus();
  enviando = false;
  atualizarBotaoEnviar();
}

/* ========================================================================== *
 * Meus boletos
 * ========================================================================== */
async function carregarMeusBoletos({ avisarMudanca = false } = {}) {
  const area = el('meus-boletos');
  if (!area.innerHTML) {
    area.innerHTML = `<div class="moldura-tabela" style="padding:20px;">
        <div class="esqueleto" style="width:100%;margin-bottom:10px;"></div>
        <div class="esqueleto" style="width:80%;"></div>
      </div>`;
  }

  try {
    const { linhas, total } = await dados.listarBoletos({
      escopo: 'meus',
      porPagina: 50,
      ordenarPor: 'data_envio',
      ordem: 'desc',
    });

    desenharNovidades(
      linhas.filter((b) => b.novidade_para_solicitante),
      avisarMudanca
    );

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
          <table class="tabela tabela--meus">
            <thead>
              <tr>
                <th class="col-neutra">Boleto</th>
                <th>Protocolo</th>
                <th>NF/MD</th>
                <th>Enviado em</th>
                <th>Und. neg / CNPJ</th>
                <th>Fornecedor</th>
                <th class="col-neutra">Valor</th>
                <th class="col-neutra">Vencimento</th>
                <th>Situação</th>
                <th class="col-neutra">Associado em</th>
                <th>Executado por</th>
              </tr>
            </thead>
            <tbody>${linhas.map(linhaMeuBoleto).join('')}</tbody>
          </table>
        </div>
        <div class="rodape-tabela">
          <span>${total} boleto(s) enviado(s) por você.</span>
        </div>
      </div>`;

    pintarIcones(area);
    area.querySelectorAll('[data-motivo]').forEach((b) =>
      b.addEventListener('click', () => avisar(b.dataset.motivo, 'atencao', 10000))
    );
    area.querySelectorAll('[data-copiar-codigo]').forEach((b) =>
      b.addEventListener('click', () => copiar(b.dataset.copiarCodigo, 'Código copiado.'))
    );
  } catch (erro) {
    area.innerHTML = `<div class="aviso aviso--erro">${ICONES.xCirculo}<div>${escapar(erro.message)}</div></div>`;
  }
}

/**
 * O aviso de novidade.
 *
 * Enquanto não houver e-mail configurado, este é o canal: um resumo no topo da
 * própria tela, que fica até a pessoa marcar como visto. Não é tão bom quanto
 * e-mail, mas não depende de limite de envio e funciona hoje.
 */
function desenharNovidades(novidades, comAviso) {
  const area = el('aviso-novidades');
  if (!novidades.length) {
    area.innerHTML = '';
    return;
  }

  const associados = novidades.filter((b) => b.status === 'associado');
  const recusados = novidades.filter((b) => ['recusado', 'descartado'].includes(b.status));

  area.innerHTML = `
    <div class="aviso aviso--${recusados.length ? 'atencao' : 'ok'} aviso--novidade">
      ${recusados.length ? ICONES.alerta : ICONES.checkCirculo}
      <div>
        <span class="aviso__titulo">
          ${
            novidades.length === 1
              ? 'Um boleto seu mudou de situação'
              : `${novidades.length} boletos seus mudaram de situação`
          }
        </span>
        ${
          associados.length
            ? `<div>${associados.length} associado(s): ${associados
                .map((b) => `<strong>#${b.numero_protocolo}</strong>`)
                .join(', ')}</div>`
            : ''
        }
        ${
          recusados.length
            ? `<div>${recusados.length} recusado(s):
                 <ul>${recusados
                   .map(
                     (b) =>
                       `<li><strong>#${b.numero_protocolo}</strong> ${escapar(b.documento_rotulo)} — ${escapar(b.observacoes_operador ?? 'sem motivo informado')}</li>`
                   )
                   .join('')}</ul></div>`
            : ''
        }
      </div>
      <button type="button" class="botao botao--contorno botao--pequeno" id="botao-marcar-vistos">
        Entendi
      </button>
    </div>`;

  pintarIcones(area);

  el('botao-marcar-vistos').addEventListener('click', async (ev) => {
    await comBotaoOcupado(ev.currentTarget, 'Ok...', () => dados.marcarComoVistos());
    await carregarMeusBoletos();
  });

  if (comAviso) {
    avisar(
      recusados.length
        ? `${recusados.length} boleto(s) seu(s) foi(ram) recusado(s). Veja o motivo no topo.`
        : `${associados.length} boleto(s) seu(s) foi(ram) associado(s).`,
      recusados.length ? 'atencao' : 'ok',
      8000
    );
  }
}

function linhaMeuBoleto(b) {
  const selo =
    {
      pendente: '<span class="selo selo--pendente">Aguardando operação</span>',
      associado: '<span class="selo selo--associado">Associado</span>',
      recusado: '<span class="selo selo--recusado">Recusado</span>',
      descartado: '<span class="selo selo--descartado">Descartado</span>',
    }[b.status] ?? '';

  const motivo =
    ['recusado', 'descartado'].includes(b.status) && b.observacoes_operador
      ? `<button type="button" class="acao-icone" data-motivo="${escapar(b.observacoes_operador)}"
                 title="Ver o motivo">${ICONES.info}</button>`
      : '';

  const novidade = b.novidade_para_solicitante
    ? '<span class="ponto-novidade" title="Mudou desde a última vez que você olhou"></span>'
    : '';

  const vazio = '<span class="vazio-celula">—</span>';

  return `
    <tr${b.novidade_para_solicitante ? ' class="linha--novidade"' : ''}>
      <td>${
        b.codigo_barras
          ? `<button type="button" class="acao-icone" data-copiar-codigo="${escapar(b.codigo_barras)}"
                     title="Copiar o código de barras">${ICONES.codigoBarras}</button>`
          : vazio
      }</td>
      <td>${novidade}#${b.numero_protocolo ?? '—'}</td>
      <td>${escapar(b.documento_rotulo ?? b.tipo_documento)}</td>
      <td class="data-simples">${dataHora(b.data_envio)}</td>
      <td>${
        b.unidade_negocio
          ? `<div class="celula-duas-linhas">
               <span class="celula-duas-linhas__principal">${escapar(b.unidade_negocio)}</span>
               <span class="celula-duas-linhas__secundaria">${escapar(fmtCnpj(b.unidade_cnpj))}</span>
             </div>`
          : vazio
      }</td>
      <td>${b.fornecedor_razao_social ? escapar(b.fornecedor_razao_social) : vazio}</td>
      <td class="valor-monetario">${b.valor != null ? moeda(b.valor) : vazio}</td>
      <td class="data-simples">${b.vencimento ? fmtData(b.vencimento) : vazio}</td>
      <td><div style="display:flex;align-items:center;gap:6px;">${selo}${motivo}</div></td>
      <td class="data-simples">${b.data_associacao ? fmtData(b.data_associacao) : vazio}</td>
      <td>${b.associado_por_nome ? escapar(b.associado_por_nome) : vazio}</td>
    </tr>`;
}

/* ========================================================================== */
iniciar().catch((erro) => {
  console.error(erro);
  avisar(`Erro ao abrir a tela: ${erro.message}`, 'erro', 10000);
});
