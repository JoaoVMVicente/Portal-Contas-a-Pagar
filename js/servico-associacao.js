/* =========================================================
   Página: Associação de Boletos
   Este arquivo é o "motor" desta página. Ele:
     1) busca as solicitações,
     2) desenha elas na tela,
     3) trata os cliques dos botões.

   Hoje os dados são SIMULADOS (uma lista fixa aqui embaixo).
   Quando o back-end estiver pronto, você troca APENAS a função
   buscarSolicitacoes() para usar a API — o resto continua igual.
   ========================================================= */


/* ---------------------------------------------------------
   PASSO 1 — De onde vêm os dados
   ---------------------------------------------------------
   Por enquanto uma lista fixa (mock), só para você ver a tela
   funcionando. Cada item é uma "fichinha" de solicitação.        */

const DADOS_SIMULADOS = [
  { id: 1024, nota: 'NF-8842', fornecedor: 'Ventos do Nordeste Ltda', valor: 15240.50, status: 'Aprovado' },
  { id: 1025, nota: 'NF-8851', fornecedor: 'Solar Peças e Serviços',  valor: 3890.00,  status: 'Em análise' },
  { id: 1026, nota: 'NF-8860', fornecedor: 'Manutenção Delta S.A.',   valor: 27500.75, status: 'Pendente' }
];


/* ---------------------------------------------------------
   Esta é a ÚNICA função que muda quando a API existir.

   async / await:
   - "async" marca uma função que faz algo demorado (esperar a
     internet responder).
   - "await" significa "espere aqui até a resposta chegar, depois
     continue". Sem isso o código seguiria sem os dados.

   Deixei o código real da API pronto e COMENTADO logo abaixo.
   Quando o back-end estiver no ar, você:
     1) apaga a linha do "return DADOS_SIMULADOS;"
     2) descomenta o bloco do fetch e ajusta a URL.                */

async function buscarSolicitacoes() {
  // ---- HOJE (dados simulados) ----
  return DADOS_SIMULADOS;

  // ---- FUTURO (dados reais da API) ----
  // const resposta = await fetch('https://SEU-BACKEND/api/associacao-boletos');
  // if (!resposta.ok) {
  //   throw new Error('Falha ao buscar do servidor');
  // }
  // const dados = await resposta.json(); // transforma a resposta em lista
  // return dados;
}


/* ---------------------------------------------------------
   PASSO 2 — Desenhar as solicitações na tela

   Recebe a lista e monta o HTML de uma tabela.
   Funciona igual ao renderCards() da home: percorre a lista
   com .map() e preenche um molde para cada linha.               */

function desenharLista(lista) {
  const alvo = document.getElementById('lista');

  // Se a lista veio vazia, mostramos uma mensagem amigável.
  if (lista.length === 0) {
    alvo.innerHTML = '<p class="estado">Nenhuma solicitação encontrada.</p>';
    return;
  }

  // Monta as linhas da tabela, uma por solicitação.
  const linhas = lista.map(item => `
    <tr>
      <td>#${item.id}</td>
      <td>${item.nota}</td>
      <td>${item.fornecedor}</td>
      <td>${formatarValor(item.valor)}</td>
      <td><span class="status status--${classeStatus(item.status)}">${item.status}</span></td>
    </tr>
  `).join('');

  // Coloca a tabela pronta dentro da área "lista".
  alvo.innerHTML = `
    <table class="tabela">
      <thead>
        <tr>
          <th>Solicitação</th>
          <th>Nota fiscal</th>
          <th>Fornecedor</th>
          <th>Valor</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
  `;
}


/* ---------------------------------------------------------
   Dois ajudantes pequenos:

   formatarValor: transforma 15240.5 em "R$ 15.240,50".
   classeStatus: transforma "Em análise" numa palavra sem acento
                 e sem espaço, para usar como classe de CSS (cor). */

function formatarValor(n) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function classeStatus(status) {
  if (status === 'Aprovado')   return 'ok';
  if (status === 'Pendente')   return 'pendente';
  return 'analise'; // "Em análise" e qualquer outro caem aqui
}


/* ---------------------------------------------------------
   Toast: aquele avisinho que sobe na parte de baixo da tela.
   (Mesma função da home, copiada para esta página.)             */

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}


/* ---------------------------------------------------------
   PASSO 3 — Ligar tudo quando a página carrega

   "async" aqui também, porque vamos usar "await" para esperar
   os dados chegarem antes de desenhar.                           */

document.addEventListener('DOMContentLoaded', async () => {

  // try / catch: tenta rodar o que está no "try". Se der erro
  // (ex.: a API caiu), pula para o "catch" e mostra uma mensagem
  // em vez de quebrar a página inteira.
  try {
    const solicitacoes = await buscarSolicitacoes(); // espera os dados
    desenharLista(solicitacoes);                     // desenha na tela
  } catch (erro) {
    document.getElementById('lista').innerHTML =
      '<p class="estado">Não foi possível carregar. Tente novamente.</p>';
  }

  // Clique do botão "Nova solicitação".
  // Por enquanto só mostra um aviso; depois abrirá um formulário.
  document.getElementById('btn-nova').addEventListener('click', () => {
    toast('Em breve: formulário de nova solicitação.');
  });
});
