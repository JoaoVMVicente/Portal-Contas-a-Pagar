/**
 * sessao.js — Quem está logado, qual o papel, o escopo e a visão.
 * ---------------------------------------------------------------------------
 * QUATRO CONCEITOS DIFERENTES. Confundi-los é a origem de quase todo bug de
 * permissão, então vale separar bem:
 *
 *   PAPEL   'cliente' ou 'admin'. Vem do BANCO. É a verdade. A pessoa não
 *           muda isso nem querendo.
 *
 *   ESCOPO  'NF', 'MD' ou 'ambos'. Vem do BANCO. Diz qual tipo de documento
 *           aquele operador trabalha. Quem cuida de nota fiscal não vê medição.
 *
 *   VISÃO   'cliente' ou 'operador'. Vem do NAVEGADOR. É só a preferência de
 *           qual tela a pessoa está olhando agora. Um operador pode estar na
 *           visão de cliente porque também tem boletos para enviar.
 *
 *   TIPO ATIVO  'NF' ou 'MD'. Vem do NAVEGADOR. Só existe para quem tem
 *           escopo 'ambos': é qual das duas abas está aberta.
 *
 * Os dois primeiros o banco garante. Os dois últimos são conveniência da tela.
 */

import { dados } from './dados.js';
import { CONFIG, ehTerceirizado } from './config.js';

const CHAVE_VISAO = 'serena.visao';
const CHAVE_TIPO = 'serena.tipoAtivo';

let sessao = null;
let pronta = null;
const ouvintes = new Set();

/* ========================================================================== *
 * Início
 * ========================================================================== */
function iniciar() {
  if (pronta) return pronta;

  pronta = (async () => {
    sessao = await dados.sessaoAtual();
    dados.aoMudarSessao((nova) => {
      sessao = nova;
      ouvintes.forEach((f) => f(nova));
    });
    return sessao;
  })();

  return pronta;
}

export function aoMudar(funcao) {
  ouvintes.add(funcao);
  return () => ouvintes.delete(funcao);
}

export function prontaASessao() {
  return iniciar();
}

/* ========================================================================== *
 * Leitura
 * ========================================================================== */
export function estaLogado() {
  return Boolean(sessao?.usuario);
}

export function usuario() {
  return sessao?.usuario ?? null;
}

export function perfil() {
  return sessao?.perfil ?? null;
}

export function papel() {
  return sessao?.perfil?.papel ?? 'cliente';
}

export function ehOperador() {
  return papel() === 'admin';
}

export function souTerceirizado() {
  return ehTerceirizado(usuario()?.email ?? '');
}

/** 'NF', 'MD' ou 'ambos'. Para cliente sempre 'ambos' (vê os próprios). */
export function escopo() {
  return sessao?.perfil?.escopo ?? 'ambos';
}

export function veOsDoisTipos() {
  return escopo() === 'ambos';
}

export function nomeExibicao() {
  const p = perfil();
  if (p?.nome_completo) return p.nome_completo;
  if (p?.nome) return `${p.nome} ${p.sobrenome ?? ''}`.trim();
  return usuario()?.email ?? 'Visitante';
}

/** Um texto curto do que a pessoa enxerga, para mostrar no topo. */
export function rotuloDoEscopo() {
  if (!ehOperador()) return 'Solicitante';
  return {
    NF: 'Operação · Notas fiscais',
    MD: 'Operação · Medições',
    ambos: 'Operação · NF e MD',
  }[escopo()] ?? 'Operação';
}

/* ========================================================================== *
 * Visão (cliente x operador)
 * ========================================================================== */
export function visaoAtual() {
  const guardada = localStorage.getItem(CHAVE_VISAO);
  if (guardada === 'operador' && ehOperador()) return 'operador';
  if (guardada === 'cliente') return 'cliente';
  return ehOperador() ? 'operador' : 'cliente';
}

export function definirVisao(visao) {
  if (visao === 'operador' && !ehOperador()) return;
  localStorage.setItem(CHAVE_VISAO, visao);
}

export function caminhoDaVisao(visao) {
  return visao === 'operador' ? './operador.html' : './cliente.html';
}

/* ========================================================================== *
 * Tipo ativo (NF x MD) — só para escopo 'ambos'
 * ========================================================================== */
export function tipoAtivo() {
  const meu = escopo();
  if (meu === 'NF' || meu === 'MD') return meu; // escopo fixo manda
  const guardado = localStorage.getItem(CHAVE_TIPO);
  return guardado === 'MD' ? 'MD' : 'NF';
}

export function definirTipoAtivo(tipo) {
  if (!veOsDoisTipos()) return;
  localStorage.setItem(CHAVE_TIPO, tipo === 'MD' ? 'MD' : 'NF');
}

/* ========================================================================== *
 * Portaria
 * ========================================================================== */
/**
 * Chamada no começo de cada tela protegida.
 * Sem login -> manda para o login, guardando para onde a pessoa queria ir.
 * Sem ser operador numa tela de operador -> manda para a tela de cliente.
 */
export async function exigirLogin({ exigirOperador = false } = {}) {
  await iniciar();

  if (!estaLogado()) {
    const destino = encodeURIComponent(
      window.location.pathname.split('/').pop() + window.location.search
    );
    window.location.replace(`./login.html?destino=${destino}`);
    return null;
  }

  if (exigirOperador && !ehOperador()) {
    window.location.replace('./cliente.html?semPermissao=1');
    return null;
  }

  return sessao;
}

export async function sair() {
  localStorage.removeItem(CHAVE_VISAO);
  localStorage.removeItem(CHAVE_TIPO);
  await dados.sair();
  window.location.replace('./login.html');
}

export { CONFIG };
