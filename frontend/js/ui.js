/**
 * ui.js — Peças de interface reaproveitadas em todas as telas.
 * Ícones, formatação de números/datas, avisos flutuantes e modais.
 * Nenhuma dependência externa.
 */

/* ========================================================================== *
 * Ícones (SVG desenhado à mão, sem biblioteca)
 * ========================================================================== */
const T = (d, extra = '') =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONES = {
  clipe: T('<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l8.57-8.57A4 4 0 0118 8.84l-8.59 8.57a2 2 0 01-2.83-2.83l8.49-8.48"/>'),
  codigoBarras: T('<path d="M3 5v14M6.5 5v14M10 5v14M13 5v10M16.5 5v14M20 5v14"/>'),
  documento: T('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>'),
  dinheiro: T('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  relogio: T('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  check: T('<path d="M20 6L9 17l-5-5"/>'),
  checkCirculo: T('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  x: T('<path d="M18 6L6 18M6 6l12 12"/>'),
  xCirculo: T('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'),
  alerta: T('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>'),
  info: T('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  busca: T('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.35-4.35"/>', 'width="17" height="17"'),
  upload: T('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 9l-5-5-5 5"/><path d="M12 4v12"/>'),
  download: T('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 11l5 5 5-5"/><path d="M12 16V4"/>'),
  copiar: T('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'),
  olho: T('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  usuario: T('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/>'),
  equipe: T('<circle cx="9" cy="8" r="3.5"/><path d="M2 20v-1a5.5 5.5 0 015.5-5.5h3A5.5 5.5 0 0116 19v1"/><path d="M16.5 4.5a3.5 3.5 0 010 7"/><path d="M18 13.5a5.5 5.5 0 014 5.3V20"/>'),
  saida: T('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  seta: T('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  voltar: T('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  atualizar: T('<path d="M21 12a9 9 0 11-3.2-6.9"/><path d="M21 3v5h-5"/>'),
  planilha: T('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'),
  raio: T('<path d="M13 2L4.5 13.5H11l-1 8.5L19 10h-6.5z"/>'),
  cadeado: T('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>'),
  email: T('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2.5 6.5l9.5 7 9.5-7"/>'),
  desfazer: T('<path d="M3 8h11a5 5 0 010 10H9"/><path d="M7 4L3 8l4 4"/>'),
  filtro: T('<path d="M3 5h18M6 12h12M10 19h4"/>'),
};

/* ========================================================================== *
 * Formatação
 * ========================================================================== */
const fmtMoeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const fmtMoedaCurta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});
const fmtNumero = new Intl.NumberFormat('pt-BR');

export function moeda(valor) {
  if (valor == null || valor === '') return '—';
  const n = Number(valor);
  return Number.isFinite(n) ? fmtMoeda.format(n) : '—';
}

/** Para os cartões do topo: R$ 21.090 em vez de R$ 21.090,00 */
export function moedaCurta(valor) {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return 'R$ 0';
  return Math.abs(n) < 10000 ? moeda(n) : fmtMoedaCurta.format(n);
}

export function numero(valor) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? fmtNumero.format(n) : '0';
}

/** '2026-07-12' ou ISO completo -> '12/07/2026' */
export function data(valor) {
  if (!valor) return '—';
  const txt = String(valor);
  const soData = txt.slice(0, 10);
  const [a, m, d] = soData.split('-');
  if (!a || !m || !d) return '—';
  return `${d}/${m}/${a}`;
}

/** ISO -> '12/07/2026 14:32' */
export function dataHora(valor) {
  if (!valor) return '—';
  const dt = new Date(valor);
  if (Number.isNaN(dt.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

export function tamanhoArquivo(bytes) {
  const n = Number(bytes ?? 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function cnpj(valor) {
  const d = String(valor ?? '').replace(/\D+/g, '');
  if (d.length !== 14) return valor || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Máscara aplicada enquanto a pessoa digita o CNPJ. */
export function mascararCNPJ(texto) {
  const d = String(texto ?? '').replace(/\D+/g, '').slice(0, 14);
  let saida = d;
  if (d.length > 2) saida = `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length > 5) saida = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length > 8) saida = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  if (d.length > 12) saida = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return saida;
}

/** Confere os dígitos verificadores do CNPJ. */
export function cnpjValido(valor) {
  const d = String(valor ?? '').replace(/\D+/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base) => {
    let peso = base.length === 12 ? 5 : 6;
    let soma = 0;
    for (const ch of base) {
      soma += Number(ch) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(d.slice(0, 12));
  const dv2 = calc(d.slice(0, 12) + dv1);
  return d === `${d.slice(0, 12)}${dv1}${dv2}`;
}

/** Deixa texto seguro para jogar dentro de HTML. */
export function escapar(txt) {
  return String(txt ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function iniciais(nome, email) {
  const base = String(nome || email || '?').trim();
  const partes = base.split(/[\s.@_-]+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

/* ========================================================================== *
 * Avisos flutuantes (toasts)
 * ========================================================================== */
function areaAvisos() {
  let area = document.querySelector('.area-avisos');
  if (!area) {
    area = document.createElement('div');
    area.className = 'area-avisos';
    area.setAttribute('role', 'status');
    area.setAttribute('aria-live', 'polite');
    document.body.appendChild(area);
  }
  return area;
}

/**
 * @param {string} mensagem
 * @param {'ok'|'erro'|'atencao'|'info'} tipo
 * @param {number} duracaoMs
 */
export function avisar(mensagem, tipo = 'info', duracaoMs = 4200) {
  const icone = { ok: ICONES.checkCirculo, erro: ICONES.xCirculo, atencao: ICONES.alerta, info: ICONES.info }[tipo];
  const el = document.createElement('div');
  el.className = `aviso-flutuante aviso-flutuante--${tipo}`;
  el.innerHTML = `${icone}<span>${escapar(mensagem)}</span><button class="aviso-flutuante__fechar" aria-label="Fechar aviso">${ICONES.x}</button>`;
  el.querySelector('button').addEventListener('click', () => el.remove());
  areaAvisos().appendChild(el);
  if (duracaoMs > 0) setTimeout(() => el.remove(), duracaoMs);
  return el;
}

/* ========================================================================== *
 * Copiar para a área de transferência
 * ========================================================================== */
export async function copiar(texto, mensagem = 'Copiado.') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
    } else {
      // Plano B para navegador antigo ou página sem https
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    avisar(mensagem, 'ok', 2400);
    return true;
  } catch {
    avisar('Não consegui copiar. Selecione o texto e use Ctrl+C.', 'erro');
    return false;
  }
}

/* ========================================================================== *
 * Modal
 * ========================================================================== */
/**
 * Abre um modal. Devolve { fechar() } e resolve o foco/teclado (Esc fecha,
 * clique no fundo fecha, foco vai para dentro do modal).
 */
export function abrirModal({ titulo, corpoHtml, rodapeHtml = '', largo = false, aoAbrir }) {
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.innerHTML = `
    <div class="modal ${largo ? 'modal--largo' : ''}" role="dialog" aria-modal="true" aria-label="${escapar(titulo)}">
      <div class="modal__topo">
        <h2>${escapar(titulo)}</h2>
        <button class="fechar-modal" aria-label="Fechar">${ICONES.x}</button>
      </div>
      <div class="modal__corpo">${corpoHtml}</div>
      ${rodapeHtml ? `<div class="modal__rodape">${rodapeHtml}</div>` : ''}
    </div>`;

  const elementoAnterior = document.activeElement;

  function fechar() {
    document.removeEventListener('keydown', aoTeclar);
    fundo.remove();
    if (elementoAnterior?.focus) elementoAnterior.focus();
  }

  function aoTeclar(ev) {
    if (ev.key === 'Escape') fechar();
  }

  fundo.querySelector('.fechar-modal').addEventListener('click', fechar);
  fundo.addEventListener('click', (ev) => {
    if (ev.target === fundo) fechar();
  });
  document.addEventListener('keydown', aoTeclar);
  document.body.appendChild(fundo);

  const primeiro = fundo.querySelector(
    'input:not([type=hidden]), select, textarea, button:not(.fechar-modal)'
  );
  (primeiro ?? fundo.querySelector('.fechar-modal')).focus();

  aoAbrir?.(fundo, fechar);
  return { elemento: fundo, fechar };
}

/** Pergunta de sim/não. Devolve uma promessa com true/false. */
export function confirmar({ titulo, mensagem, textoConfirmar = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    const { fechar } = abrirModal({
      titulo,
      corpoHtml: `<p>${escapar(mensagem)}</p>`,
      rodapeHtml: `
        <button class="botao botao--contorno" data-acao="nao">Cancelar</button>
        <button class="botao ${perigo ? 'botao--perigo' : 'botao--principal'}" data-acao="sim">${escapar(textoConfirmar)}</button>`,
      aoAbrir: (el, fecharModal) => {
        el.querySelector('[data-acao=nao]').addEventListener('click', () => {
          fecharModal();
          resolve(false);
        });
        el.querySelector('[data-acao=sim]').addEventListener('click', () => {
          fecharModal();
          resolve(true);
        });
      },
    });
    void fechar;
  });
}

/** Pede um texto (usado no motivo da recusa). */
export function pedirTexto({ titulo, rotulo, dica = '', obrigatorio = true, textoConfirmar = 'Enviar' }) {
  return new Promise((resolve) => {
    abrirModal({
      titulo,
      corpoHtml: `
        <div class="campo">
          <label class="campo__rotulo" for="modal-texto">${escapar(rotulo)}</label>
          <textarea id="modal-texto" rows="4"></textarea>
          ${dica ? `<span class="campo__dica">${escapar(dica)}</span>` : ''}
          <span class="campo__erro oculto" id="modal-texto-erro"></span>
        </div>`,
      rodapeHtml: `
        <button class="botao botao--contorno" data-acao="nao">Cancelar</button>
        <button class="botao botao--principal" data-acao="sim">${escapar(textoConfirmar)}</button>`,
      aoAbrir: (el, fecharModal) => {
        const campo = el.querySelector('#modal-texto');
        const erro = el.querySelector('#modal-texto-erro');
        el.querySelector('[data-acao=nao]').addEventListener('click', () => {
          fecharModal();
          resolve(null);
        });
        el.querySelector('[data-acao=sim]').addEventListener('click', () => {
          const valor = campo.value.trim();
          if (obrigatorio && !valor) {
            erro.textContent = 'Escreva algo aqui para continuar.';
            erro.classList.remove('oculto');
            campo.setAttribute('aria-invalid', 'true');
            campo.focus();
            return;
          }
          fecharModal();
          resolve(valor);
        });
      },
    });
  });
}

/* ========================================================================== *
 * Miscelânea
 * ========================================================================== */

/** Espera a pessoa parar de digitar antes de buscar. */
export function aguardarPausa(fn, ms = 280) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

/** Coloca o ícone certo dentro de cada [data-icone] do HTML. */
export function pintarIcones(raiz = document) {
  raiz.querySelectorAll('[data-icone]').forEach((el) => {
    const nome = el.dataset.icone;
    if (ICONES[nome]) el.innerHTML = ICONES[nome];
  });
}

/** Trava o botão enquanto uma ação assíncrona roda. */
export async function comBotaoOcupado(botao, textoOcupado, acao) {
  if (!botao) return acao();
  const original = botao.innerHTML;
  botao.disabled = true;
  botao.innerHTML = escapar(textoOcupado);
  try {
    return await acao();
  } finally {
    botao.disabled = false;
    botao.innerHTML = original;
  }
}
