/**
 * layout.js — O topo e o rodapé que todas as telas compartilham.
 */

import { ICONES, escapar, iniciais, pintarIcones } from './ui.js';
import * as sessao from './sessao.js';
import { EH_DEMO, dados } from './dados.js';

/**
 * Monta o topo.
 * @param {{visao:'inicio'|'cliente'|'operador', destino:HTMLElement}} opcoes
 */
export function montarTopo({ visao, destino }) {
  const ehOperador = sessao.ehOperador();
  const nome = sessao.nomeExibicao();
  const email = sessao.usuario()?.email ?? '';

  // O alternador só existe para quem tem as duas telas. Um solicitante comum
  // não vê botão nenhum aqui — não há nada para ele alternar.
  const alternador = ehOperador
    ? `<nav class="alternador-visao" aria-label="Trocar de visão">
         <a href="./operador.html" class="alternador-visao__opcao"
            ${visao === 'operador' ? 'aria-current="page"' : ''}>
           ${ICONES.equipe}<span>Operador</span>
         </a>
         <a href="./cliente.html" class="alternador-visao__opcao"
            ${visao === 'cliente' ? 'aria-current="page"' : ''}>
           ${ICONES.usuario}<span>Cliente</span>
         </a>
       </nav>`
    : '';

  destino.innerHTML = `
    <header class="topo">
      <a class="topo__logo" href="./index.html" aria-label="Início">
        <img src="./assets/logos/serena-coral-horizontal.png" alt="Serena" />
      </a>
      <span class="topo__divisor" aria-hidden="true"></span>
      <span class="topo__nome-portal">Associação de boletos</span>

      ${alternador}

      <span class="topo__espaco"></span>

      <div class="chip-usuario">
        <span class="chip-usuario__iniciais" aria-hidden="true">${escapar(iniciais(nome))}</span>
        <span class="chip-usuario__texto">
          <span class="chip-usuario__nome">${escapar(nome)}</span>
          <span class="chip-usuario__papel">
            ${escapar(sessao.rotuloDoEscopo())}${sessao.souTerceirizado() ? ' · externo' : ''}
          </span>
        </span>
      </div>

      <button class="botao botao--fantasma botao--pequeno" id="botao-sair" title="${escapar(email)}">
        ${ICONES.saida}<span class="oculto-no-celular">Sair</span>
      </button>
    </header>
    ${EH_DEMO ? faixaDemo() : ''}`;

  pintarIcones(destino);
  destino.querySelector('#botao-sair')?.addEventListener('click', () => sessao.sair());
}

function faixaDemo() {
  return `
    <div class="faixa-demo">
      ${ICONES.alerta}
      <span>
        <strong>Modo demonstração.</strong>
        Os dados ficam só neste navegador. Para valer de verdade, preencha as
        chaves do Supabase em <code>frontend/js/config.js</code>.
      </span>
      <button class="botao botao--contorno botao--pequeno" id="botao-reiniciar-demo">
        Restaurar exemplo
      </button>
    </div>`;
}

/** Liga o botão que devolve os dados de exemplo ao estado original. */
export function ligarBotaoDemo(depois) {
  const botao = document.querySelector('#botao-reiniciar-demo');
  if (!botao) return;
  botao.addEventListener('click', async () => {
    botao.disabled = true;
    botao.textContent = 'Restaurando...';
    await dados.reiniciarDemo();
    depois?.();
  });
}

export function montarRodape(destino) {
  if (!destino) return;
  const ano = new Date().getFullYear();
  destino.innerHTML = `
    <footer class="rodape">
      <span>Serena Energia · Portal de associação de boletos</span>
      <span class="rodape__separador">·</span>
      <span>${ano}</span>
    </footer>`;
}

/**
 * O alternador NF / MD do painel do operador.
 * Só aparece para quem tem escopo 'ambos'. Para quem tem escopo fixo,
 * mostramos um selo dizendo o que a pessoa vê — sem botão, porque não há
 * escolha (e o banco não devolveria as outras linhas nem se houvesse).
 */
export function montarSeletorDeTipo({ destino, tipoAtivo, aoTrocar }) {
  if (!destino) return;

  if (!sessao.veOsDoisTipos()) {
    const meu = sessao.escopo();
    destino.innerHTML = `
      <div class="selo-escopo">
        ${meu === 'NF' ? ICONES.documento : ICONES.planilha}
        <span>Você trabalha com <strong>${meu === 'NF' ? 'notas fiscais' : 'medições'}</strong></span>
      </div>`;
    pintarIcones(destino);
    return;
  }

  destino.innerHTML = `
    <div class="seletor-tipo" role="tablist" aria-label="Tipo de documento">
      <button role="tab" data-tipo="NF" aria-selected="${tipoAtivo === 'NF'}">
        ${ICONES.documento}
        <span>Notas fiscais</span>
        <span class="seletor-tipo__contador" id="contador-nf"></span>
      </button>
      <button role="tab" data-tipo="MD" aria-selected="${tipoAtivo === 'MD'}">
        ${ICONES.planilha}
        <span>Medições</span>
        <span class="seletor-tipo__contador" id="contador-md"></span>
      </button>
    </div>`;

  pintarIcones(destino);

  destino.querySelectorAll('[data-tipo]').forEach((botao) => {
    botao.addEventListener('click', () => {
      const tipo = botao.dataset.tipo;
      destino.querySelectorAll('[data-tipo]').forEach((b) =>
        b.setAttribute('aria-selected', String(b === botao))
      );
      sessao.definirTipoAtivo(tipo);
      aoTrocar?.(tipo);
    });
  });
}
