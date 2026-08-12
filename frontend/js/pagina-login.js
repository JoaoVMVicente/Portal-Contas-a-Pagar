/**
 * pagina-login.js — A porta de entrada do portal.
 * ---------------------------------------------------------------------------
 * TRÊS PAINÉIS, UM DE CADA VEZ:
 *
 *   1. Entrar             e-mail + senha
 *   2. Primeiro acesso    manda o link de ativação para o e-mail
 *   3. Escolher a senha   só abre quem chegou pelo link
 *
 * A DECISÃO DE SEGURANÇA QUE MOLDA ESTA TELA
 * ------------------------------------------
 * O pedido original era: ao tentar entrar com um e-mail já cadastrado como
 * operador, dar erro e mostrar um botão "Primeiro acesso" onde a pessoa define
 * a senha ali mesmo.
 *
 * A primeira metade está aqui, igualzinho. A segunda eu mudei, e o motivo é o
 * próprio risco que motivou o pedido: "eu poderia criar uma senha para todo
 * mundo do meu time sem eles saberem". Se o primeiro acesso deixasse escolher a
 * senha na hora, isso continuaria possível — bastaria digitar o e-mail do
 * colega. O que impede é exigir a prova de que a caixa de e-mail é sua, e a
 * única prova que existe é abrir o link enviado para ela.
 *
 * Um detalhe a mais: o botão "Primeiro acesso" aparece depois de QUALQUER
 * tentativa que não deu certo, não só quando o e-mail está pré-cadastrado. Se
 * ele aparecesse apenas para os pré-cadastrados, a tela viraria uma lista de
 * quem trabalha aqui: bastaria testar e-mails e ver em quais o botão aparece.
 */

import { CONFIG, problemaComEmail } from './config.js';
import { dados, EH_DEMO } from './dados.js';
import { avisar, escapar, ICONES, comBotaoOcupado, pintarIcones } from './ui.js';
import * as sessao from './sessao.js';

const el = (id) => document.getElementById(id);
const parametros = new URLSearchParams(window.location.search);

/* ========================================================================== *
 * Painéis
 * ========================================================================== */
const PAINEIS = ['painel-entrar', 'painel-primeiro-acesso', 'painel-definir-senha'];

function mostrarPainel(qual) {
  PAINEIS.forEach((p) => el(p).classList.toggle('oculto', p !== qual));
  window.scrollTo({ top: 0 });
}

function mensagemTopo(html, tipo = 'info') {
  el('mensagem-topo').innerHTML = `
    <div class="aviso aviso--${tipo}" style="margin-bottom:20px;">
      ${{ info: ICONES.info, ok: ICONES.checkCirculo, atencao: ICONES.alerta, erro: ICONES.xCirculo }[tipo]}
      <div>${html}</div>
    </div>`;
}

function limparMensagemTopo() {
  el('mensagem-topo').innerHTML = '';
}

/* ========================================================================== *
 * Erros de campo
 * ========================================================================== */
function limparErros() {
  document.querySelectorAll('.campo__erro').forEach((e) => e.classList.add('oculto'));
  document.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
}

function marcarErro(campo, mensagem) {
  const erro = el(`erro-${campo}`);
  if (erro) {
    erro.innerHTML = `${ICONES.alerta}${escapar(mensagem)}`;
    erro.classList.remove('oculto');
  }
  const entrada = el(campo);
  entrada?.setAttribute('aria-invalid', 'true');
  entrada?.focus();
}

/* ========================================================================== *
 * Mostrar / esconder senha
 * ========================================================================== */
function ligarOlhoDaSenha(idBotao, idCampo) {
  const botao = el(idBotao);
  const campo = el(idCampo);
  if (!botao || !campo) return;
  botao.innerHTML = ICONES.olho;
  botao.addEventListener('click', () => {
    const escondida = campo.type === 'password';
    campo.type = escondida ? 'text' : 'password';
    botao.setAttribute('aria-label', escondida ? 'Esconder a senha' : 'Mostrar a senha');
    campo.focus();
  });
}

/* ========================================================================== *
 * 1. ENTRAR
 * ========================================================================== */
el('form-entrar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErros();
  limparMensagemTopo();

  const email = el('email').value.trim();
  const senha = el('senha').value;

  const problema = problemaComEmail(email);
  if (problema) return marcarErro('email', problema);
  if (!senha) return marcarErro('senha', 'Digite sua senha.');

  try {
    await comBotaoOcupado(el('botao-entrar'), 'Entrando...', () => dados.entrar({ email, senha }));
    avisar('Bem-vindo de volta.', 'ok', 2000);
    irParaDestino();
  } catch (erro) {
    // O e-mail existe mas a conta não foi ativada: mensagem específica.
    if (erro.codigo === 'precisa_primeiro_acesso') {
      mensagemTopo(
        `<span class="aviso__titulo">Sua conta ainda não foi ativada</span>
         Use o <strong>Primeiro acesso</strong> abaixo para receber o link e escolher sua senha.`,
        'atencao'
      );
    } else if (erro.codigo === 'nao_confirmado') {
      mensagemTopo(
        `<span class="aviso__titulo">Confirme seu e-mail</span>
         Abra o link que enviamos. Não achou? Use o Primeiro acesso para receber outro.`,
        'atencao'
      );
    } else {
      mensagemTopo(
        `<span class="aviso__titulo">Não consegui entrar</span>${escapar(erro.message)}`,
        'erro'
      );
    }

    // O caminho de saída aparece aqui, com o e-mail já preenchido.
    el('caixa-primeiro-acesso').classList.remove('oculto');
    el('email-primeiro').value = email;
    el('senha').value = '';
    el('senha').focus();
  }
});

el('botao-ir-primeiro-acesso').addEventListener('click', () => {
  el('email-primeiro').value = el('email').value.trim();
  limparErros();
  limparMensagemTopo();
  mostrarPainel('painel-primeiro-acesso');
  el('email-primeiro').focus();
});

el('botao-esqueci').addEventListener('click', () => {
  el('email-primeiro').value = el('email').value.trim();
  limparMensagemTopo();
  mostrarPainel('painel-primeiro-acesso');
  el('painel-primeiro-acesso').querySelector('h1').textContent = 'Redefinir a senha';
  el('painel-primeiro-acesso').querySelector('.caixa-login__sub').textContent =
    'Vamos enviar um link para o seu e-mail. É por ele que você escolhe a nova senha.';
  el('email-primeiro').focus();
});

/* ========================================================================== *
 * 2. PRIMEIRO ACESSO
 * ========================================================================== */
el('voltar-do-primeiro').addEventListener('click', () => {
  limparMensagemTopo();
  mostrarPainel('painel-entrar');
});

el('form-primeiro-acesso').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErros();

  const email = el('email-primeiro').value.trim();
  const problema = problemaComEmail(email);
  if (problema) return marcarErro('email-primeiro', problema);

  try {
    const r = await comBotaoOcupado(el('botao-enviar-link'), 'Enviando...', () =>
      dados.solicitarPrimeiroAcesso(email)
    );

    // No modo demonstração não existe e-mail de verdade, então mostramos o
    // link na tela — deixando claro que é simulação.
    if (r.simulado && r.linkSimulado) {
      mensagemTopo(
        `<span class="aviso__titulo">Link gerado (simulação)</span>
         Como esta é a demonstração, não há e-mail de verdade. No portal em
         produção este link chega na caixa de entrada de
         <strong>${escapar(email)}</strong>.
         <div style="margin-top:12px;">
           <a class="botao botao--principal botao--pequeno" href="${escapar(r.linkSimulado)}">
             Abrir o link de ativação
           </a>
         </div>`,
        'atencao'
      );
    } else {
      mensagemTopo(
        `<span class="aviso__titulo">Link enviado</span>${escapar(r.mensagem)}`,
        'ok'
      );
    }

    el('form-primeiro-acesso').classList.add('oculto');
  } catch (erro) {
    mensagemTopo(`<span class="aviso__titulo">Não consegui enviar</span>${escapar(erro.message)}`, 'erro');
  }
});

/* ========================================================================== *
 * 3. ESCOLHER A SENHA
 * ========================================================================== */
function forcaDaSenha(senha) {
  let pontos = 0;
  if (senha.length >= 8) pontos += 1;
  if (senha.length >= 12) pontos += 1;
  if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) pontos += 1;
  if (/\d/.test(senha)) pontos += 1;
  if (/[^A-Za-z0-9]/.test(senha)) pontos += 1;
  return Math.min(pontos, 4);
}

el('senha-nova')?.addEventListener('input', () => {
  const senha = el('senha-nova').value;
  const forca = forcaDaSenha(senha);
  const barra = el('barra-senha');
  const rotulos = ['muito fraca', 'fraca', 'razoável', 'boa', 'forte'];
  barra.style.width = `${(forca / 4) * 100}%`;
  barra.dataset.forca = String(forca);
  el('dica-forca').textContent = senha
    ? `Senha ${rotulos[forca]}. Mínimo de ${CONFIG.TAMANHO_MINIMO_SENHA} caracteres.`
    : `Use pelo menos ${CONFIG.TAMANHO_MINIMO_SENHA} caracteres.`;
});

el('form-definir-senha').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErros();

  const senha = el('senha-nova').value;
  const repetida = el('senha-repetir').value;

  if (senha.length < CONFIG.TAMANHO_MINIMO_SENHA) {
    return marcarErro('senha-nova', `Use pelo menos ${CONFIG.TAMANHO_MINIMO_SENHA} caracteres.`);
  }
  if (senha !== repetida) {
    return marcarErro('senha-repetir', 'As duas senhas não são iguais.');
  }

  // O departamento é escolhido aqui porque é aqui que a pessoa entra pela
  // primeira vez. Depois fica no perfil e ninguém escolhe de novo.
  const departamento = el('departamento-ativacao')?.value ?? '';
  if (!departamento) {
    const erro = el('erro-departamento-ativacao');
    if (erro) {
      erro.innerHTML = `${ICONES.alerta}Escolha o seu departamento.`;
      erro.classList.remove('oculto');
    }
    el('departamento-ativacao')?.focus();
    return;
  }

  try {
    await comBotaoOcupado(el('botao-salvar-senha'), 'Ativando...', () =>
      dados.concluirPrimeiroAcesso({
        token: parametros.get('ativar'),
        email: parametros.get('email'),
        senha,
        nome: el('nome-ativacao').value.trim() || undefined,
        sobrenome: el('sobrenome-ativacao').value.trim() || undefined,
        departamento,
      })
    );

    avisar('Conta ativada. Entrando...', 'ok');
    setTimeout(() => window.location.replace('./index.html'), 800);
  } catch (erro) {
    mensagemTopo(`<span class="aviso__titulo">Não consegui ativar</span>${escapar(erro.message)}`, 'erro');
  }
});

/* ========================================================================== *
 * Ao abrir a página
 * ========================================================================== */
/** Preenche o seletor de departamento do primeiro acesso. */
async function montarDepartamentosDaAtivacao() {
  const seletor = el('departamento-ativacao');
  if (!seletor) return;
  try {
    const lista = await dados.departamentosSugeridos();
    seletor.innerHTML =
      '<option value="">Selecione</option>' +
      lista.map((n) => `<option value="${escapar(n)}">${escapar(n)}</option>`).join('');
  } catch (erro) {
    seletor.innerHTML = '<option value="">Não consegui carregar</option>';
    console.warn('Lista de departamentos indisponível:', erro);
  }
}

async function iniciar() {
  ligarOlhoDaSenha('ver-senha', 'senha');
  ligarOlhoDaSenha('ver-senha-nova', 'senha-nova');
  pintarIcones();
  montarDepartamentosDaAtivacao();

  el('rodape-modo').innerHTML = EH_DEMO
    ? 'Modo demonstração · os dados ficam só neste navegador'
    : '<a href="./index.html">Voltar ao portal</a>';

  // Chegou pelo link de ativação?
  const token = parametros.get('ativar');
  const definirSenha = parametros.get('definir-senha');

  if (token || definirSenha) {
    try {
      const info = await dados.conferirTokenAtivacao(token, parametros.get('email'));
      mostrarPainel('painel-definir-senha');
      el('sub-definir').textContent = info?.email
        ? `Ativando o acesso de ${info.email}.`
        : 'Última etapa.';
      if (info?.nome) el('nome-ativacao').value = info.nome;
      if (info?.sobrenome) el('sobrenome-ativacao').value = info.sobrenome;
      el('senha-nova').focus();
      return;
    } catch (erro) {
      mensagemTopo(
        `<span class="aviso__titulo">Este link não funciona mais</span>${escapar(erro.message)}`,
        'erro'
      );
      mostrarPainel('painel-primeiro-acesso');
      return;
    }
  }

  if (parametros.get('verificado')) {
    mensagemTopo('<span class="aviso__titulo">E-mail confirmado.</span>Agora você já pode entrar.', 'ok');
  }
  if (parametros.get('destino')) {
    mensagemTopo('Entre para continuar de onde você parou.', 'info');
  }
  if (EH_DEMO && !parametros.get('destino')) {
    mensagemTopo(
      `<span class="aviso__titulo">Modo demonstração</span>
       Os e-mails da equipe já estão cadastrados, mas <strong>sem senha</strong> —
       igual ao portal de verdade. Tente entrar com
       <code>kelly.silva@srna.co</code> e siga pelo <strong>Primeiro acesso</strong>.`,
      'info'
    );
  }

  mostrarPainel('painel-entrar');

  // Já está logado? Não faz sentido mostrar o login.
  await sessao.prontaASessao();
  if (sessao.estaLogado()) irParaDestino();
  else el('email').focus();
}

function irParaDestino() {
  const destino = parametros.get('destino');
  const alvo = destino ? decodeURIComponent(destino) : 'index.html';
  // Só aceitamos caminho interno: ninguém redireciona para fora colando na URL.
  const seguro = /^[a-zA-Z0-9._%?=&/-]+$/.test(alvo) && !alvo.startsWith('//');
  window.location.replace(seguro ? `./${alvo.replace(/^\.?\//, '')}` : './index.html');
}

iniciar().catch((erro) => {
  console.error(erro);
  mensagemTopo(`Erro ao abrir a tela: ${escapar(erro.message)}`, 'erro');
});
