/**
 * pagina-inicio.js — Os cartões de serviço.
 * ---------------------------------------------------------------------------
 * O LOGIN É A PRIMEIRA TELA
 * -------------------------
 * Quem não está logado nem vê esta página: vai direto para o login. Antes o
 * portal mostrava os cartões para visitante, com um botão "Entrar" no canto.
 * Mudei porque o portal é todo interno — não existe nada aqui para quem não
 * entrou. Mostrar a vitrine antes da porta só adiciona um clique.
 */

import { ICONES, escapar, pintarIcones, abrirModal } from './ui.js';
import * as sessao from './sessao.js';
import { montarTopo, montarRodape, ligarBotaoDemo } from './layout.js';

const SERVICOS = [
  {
    id: 'associacao-boletos',
    titulo: 'Associação de Boletos',
    texto:
      'Envie o boleto do fornecedor e acompanhe a associação. A operação recebe, confere e associa.',
    icone: 'documento',
    ativo: true,
  },
  {
    id: 'excecao-pagamento',
    titulo: 'Exceção de pagamento',
    texto: 'Solicitação de pagamento fora do fluxo padrão.',
    icone: 'raio',
    ativo: false,
  },
  {
    id: 'consulta-notas',
    titulo: 'Consulta de notas fiscais',
    texto: 'Situação de escrituração e forma de pagamento das suas notas.',
    icone: 'planilha',
    ativo: false,
  },
];

async function iniciar() {
  // Portaria: sem login, nem chega a montar a tela.
  const s = await sessao.exigirLogin();
  if (!s) return;

  montarTopo({ visao: 'inicio', destino: el('topo') });
  ligarBotaoDemo(() => window.location.reload());
  montarRodape(el('rodape'));

  const primeiroNome = sessao.perfil()?.nome || '';
  document.querySelector('#saudacao').textContent = primeiroNome
    ? `Olá, ${primeiroNome}. Escolha o serviço que você precisa.`
    : 'Escolha o serviço que você precisa.';

  desenharServicos();

  // Voltou do login querendo abrir um serviço direto?
  if (new URLSearchParams(location.search).get('abrir') === 'associacao-boletos') {
    abrirAssociacao();
  }
}

const el = (id) => document.getElementById(id);

function desenharServicos() {
  const area = el('servicos');
  area.innerHTML = SERVICOS.map(
    (s) => `
    <button class="cartao-servico" data-servico="${s.id}" ${s.ativo ? '' : 'disabled'}>
      ${s.ativo ? '' : '<span class="etiqueta-breve">Em breve</span>'}
      <span class="cartao-servico__icone" data-icone="${s.icone}"></span>
      <span class="cartao-servico__titulo">${escapar(s.titulo)}</span>
      <p class="cartao-servico__texto">${escapar(s.texto)}</p>
      ${s.ativo ? `<span class="cartao-servico__rodape">Abrir ${ICONES.seta}</span>` : ''}
    </button>`
  ).join('');

  pintarIcones(area);

  area.querySelectorAll('[data-servico]').forEach((botao) => {
    botao.addEventListener('click', () => {
      if (botao.dataset.servico === 'associacao-boletos') abrirAssociacao();
    });
  });
}

function abrirAssociacao() {
  // Solicitante comum: existe uma tela só para ele.
  if (!sessao.ehOperador()) {
    window.location.href = './cliente.html';
    return;
  }

  // Operador: escolhe qual lado quer ver.
  abrirModal({
    titulo: 'Como você quer abrir?',
    corpoHtml: `
      <p class="cartao__sub">
        Você é da equipe de operação, então pode ver as duas telas.
        Dá para trocar depois, pelo botão no topo.
      </p>
      <div class="escolha-visao">
        <button class="escolha-visao__opcao" data-visao="operador">
          <span class="escolha-visao__icone" data-icone="equipe"></span>
          <span class="escolha-visao__titulo">Visão do operador</span>
          <p class="escolha-visao__texto">
            A fila de ${escapar(descricaoDaFila())}, os quatro indicadores e a ação de associar.
          </p>
        </button>
        <button class="escolha-visao__opcao" data-visao="cliente">
          <span class="escolha-visao__icone" data-icone="usuario"></span>
          <span class="escolha-visao__titulo">Visão do cliente</span>
          <p class="escolha-visao__texto">
            Enviar um boleto e acompanhar os seus próprios pedidos.
          </p>
        </button>
      </div>`,
    aoAbrir: (raiz) => {
      pintarIcones(raiz);
      raiz.querySelectorAll('[data-visao]').forEach((botao) => {
        botao.addEventListener('click', () => {
          const visao = botao.dataset.visao;
          sessao.definirVisao(visao);
          window.location.href = sessao.caminhoDaVisao(visao);
        });
      });
    },
  });
}

/** O texto muda conforme o escopo, para a escolha já dizer o que a pessoa verá. */
function descricaoDaFila() {
  return {
    NF: 'notas fiscais',
    MD: 'medições',
    ambos: 'notas fiscais e medições',
  }[sessao.escopo()] ?? 'boletos';
}

iniciar().catch((erro) => {
  console.error(erro);
  document.querySelector('#servicos').innerHTML =
    `<div class="aviso aviso--erro">Não consegui carregar o portal: ${escapar(erro.message)}</div>`;
});
