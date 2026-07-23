/* =========================================================
   Portal Financeiro — Contas a Pagar | Serena
   Estrutura base do front-end. As ações dos botões estão
   preparadas como pontos de integração ( ver TODO ).
   ========================================================= */

/* ---------- Ícones (inline SVG) ---------- */
const ICONS = {
  associacao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  excecao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="2"/><line x1="12" y1="17" x2="12" y2="18"/></svg>',
  cancelamento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  estornado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  inconsistencia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  notas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
  comprovantes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 12"/></svg>',
  manuais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'
};

/* ---------- Dados dos serviços (cards) ---------- */
const SERVICOS = [
  { id: 'associacao',      icone: 'associacao',      titulo: 'Associação de Boletos',        desc: 'Solicite a associação de boletos a uma nota fiscal.' },
  { id: 'excecao',         icone: 'excecao',         titulo: 'Solicitação de Exceção de Pagamentos', desc: 'Solicite exceções para regras de pagamento.' },
  { id: 'cancelamento',    icone: 'cancelamento',    titulo: 'Cancelamentos de MD',           desc: 'Solicite o cancelamento de pagamentos (MD).' },
  { id: 'estornado',       icone: 'estornado',       titulo: 'Pagamentos Estornados',         desc: 'Acompanhe e solicite informações sobre pagamentos estornados.' },
  { id: 'inconsistencia',  icone: 'inconsistencia',  titulo: 'Lançamentos com Inconsistências', desc: 'Reporte ou acompanhe lançamentos com inconsistências.' },
  { id: 'notas',           icone: 'notas',           titulo: 'Notas de O&M',                  desc: 'Solicite emissão ou consulte notas de O&M.' },
  { id: 'comprovantes',    icone: 'comprovantes',    titulo: 'Comprovantes de Pagamentos',    desc: 'Consulte e baixe comprovantes de pagamentos realizados.' },
  { id: 'manuais',         icone: 'manuais',         titulo: 'Manuais',                       desc: 'Acesse manuais, guias e documentações úteis.' }
];

/* ---------- Comunicados ---------- */
const COMUNICADOS = [
  {
    titulo: 'Alteração no dia do lote de pagamentos',
    importante: true,
    texto: 'Devido ao feriado de Corpus Christi (30/05), o lote de pagamentos previsto para quinta-feira (30/05) será antecipado para quarta-feira (29/05).',
    data: '22/05/2026',
    origem: 'Contas a Pagar'
  },
  {
    titulo: 'Novo fluxo para associação de boletos',
    importante: false,
    texto: 'A partir de junho, a associação de boletos passa a ser feita diretamente pelo portal. Confira o manual atualizado na seção Manuais.',
    data: '18/05/2026',
    origem: 'Contas a Pagar'
  },
  {
    titulo: 'Horário de corte para solicitações urgentes',
    importante: false,
    texto: 'Solicitações urgentes devem ser abertas até as 15h para processamento no mesmo dia útil.',
    data: '10/05/2026',
    origem: 'Contas a Pagar'
  }
];

/* ---------- Render dos cards ---------- */
function renderCards() {
  const wrap = document.getElementById('cards');
  wrap.innerHTML = SERVICOS.map(s => `
    <article class="card">
      <div class="card__icon">${ICONS[s.icone]}</div>
      <h3 class="card__title">${s.titulo}</h3>
      <p class="card__desc">${s.desc}</p>
      <button class="btn btn--outline" data-servico="${s.id}">
        Acessar ${ICONS.seta}
      </button>
    </article>
  `).join('');

  wrap.querySelectorAll('[data-servico]').forEach(btn => {
    btn.addEventListener('click', () => abrirServico(btn.dataset.servico));
  });
}

/* ---------- Comunicados: carrossel ---------- */
let comIndex = 0;
function renderComunicado() {
  const c = COMUNICADOS[comIndex];
  document.getElementById('comunicado-body').innerHTML = `
    <div class="head">
      <strong>${c.titulo}</strong>
      ${c.importante ? '<span class="badge">importante</span>' : ''}
    </div>
    <p>${c.texto}</p>
    <p class="meta">${c.data} · ${c.origem}</p>
  `;
}

/* ---------- Ações dos botões (pontos de integração) ---------- */
function abrirServico(id) {
  const servico = SERVICOS.find(s => s.id === id);
  // TODO: navegar para a página / abrir modal do serviço
  toast(`Abrindo: ${servico.titulo}`);
}

function abrirTeams() {
  // TODO: substituir pelo deep link real do canal no Teams
  toast('Abrindo canal no Microsoft Teams…');
}

/* ---------- Toast utilitário ---------- */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- Inicialização ---------- */
document.addEventListener('DOMContentLoaded', () => {
  renderCards();
  renderComunicado();

  document.getElementById('com-prev').addEventListener('click', () => {
    comIndex = (comIndex - 1 + COMUNICADOS.length) % COMUNICADOS.length;
    renderComunicado();
  });
  document.getElementById('com-next').addEventListener('click', () => {
    comIndex = (comIndex + 1) % COMUNICADOS.length;
    renderComunicado();
  });

  document.getElementById('btn-teams').addEventListener('click', abrirTeams);
  document.getElementById('ver-todos').addEventListener('click', (e) => {
    e.preventDefault();
    toast('Abrindo todos os comunicados…');
  });
  document.getElementById('btn-bell').addEventListener('click', () => toast('3 notificações não lidas'));
  document.getElementById('btn-user').addEventListener('click', () => toast('Menu do usuário'));
});
