#!/usr/bin/env node
/**
 * testar-seguranca.mjs — Ataca o seu próprio portal, de propósito.
 *
 * ===========================================================================
 * O QUE ESTE SCRIPT É
 * ===========================================================================
 * Um atacante não usa a sua tela. Ele pega a chave pública que está no código
 * do site — qualquer pessoa que abrir o portal já tem — e conversa direto com
 * a API do banco, sem passar por nenhuma validação de JavaScript.
 *
 * É exatamente isso que este script faz. Ele tenta, uma por uma, as coisas
 * que NÃO deveriam funcionar:
 *
 *   - ler boletos sem estar logado
 *   - ler os boletos de outra pessoa
 *   - se promover a operador
 *   - ler medições sendo do time de notas fiscais
 *   - criar um boleto já marcado como associado
 *   - inventar uma conta bancária
 *   - apagar um boleto
 *   - criar conta com e-mail de fora da empresa
 *   - baixar o arquivo de outra pessoa
 *
 * Cada tentativa que FALHA é uma boa notícia. Cada uma que passa é um furo.
 *
 * A diferença entre isto e uma lista de conferência: aqui não tem "acho que
 * está protegido". Ou o banco recusou, ou não recusou.
 *
 * ===========================================================================
 * É SEGURO RODAR?
 * ===========================================================================
 * Sim, e vale explicar por quê. As tentativas de escrita são o ponto do teste,
 * mas todas devem ser recusadas pelo banco. Se alguma passar, o script:
 *
 *   1. marca como FURO GRAVE no relatório,
 *   2. tenta desfazer imediatamente,
 *   3. e avisa você caso não consiga desfazer.
 *
 * Nada é apagado de propósito em nenhum momento. A tentativa de apagar existe
 * justamente porque ela deve falhar.
 *
 * ===========================================================================
 * COMO USAR
 * ===========================================================================
 *   cd tools
 *   npm install
 *
 *   # Só os testes que não precisam de login (já valem muito):
 *   node testar-seguranca.mjs
 *
 *   # Completo — com uma conta de cada tipo:
 *   node testar-seguranca.mjs \
 *     --cliente      teste.um@srna.co:senha123456 \
 *     --operador-nf  kelly.silva@srna.co:senha123456 \
 *     --operador-md  thais.lima@srna.co:senha123456
 *
 * Para o teste ficar completo, crie duas contas de teste comuns (qualquer
 * e-mail @srna.co que não esteja na lista de operadores) e passe uma delas em
 * --cliente. Assim dá para verificar se um solicitante consegue ver o boleto
 * de outro.
 *
 * O script NÃO precisa e NÃO usa a chave service_role. Ele só tem o que
 * qualquer visitante tem.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

/* ========================================================================== *
 * Ler as chaves do próprio config.js do portal
 * ========================================================================== */
function lerConfiguracao() {
  const caminho = path.join(RAIZ, 'frontend/js/config.js');
  if (!fs.existsSync(caminho)) {
    console.error(`Não achei ${caminho}. Rode o script de dentro da pasta tools/.`);
    process.exit(1);
  }

  const conteudo = fs.readFileSync(caminho, 'utf8');
  const url = conteudo.match(/SUPABASE_URL:\s*'([^']*)'/)?.[1];
  const chave = conteudo.match(/SUPABASE_ANON_KEY:\s*'([^']*)'/)?.[1];

  if (!url || !chave) {
    console.error('');
    console.error('O config.js está sem a URL ou sem a chave do Supabase.');
    console.error('Sem elas não há o que testar — o portal estaria em modo demonstração.');
    console.error('');
    process.exit(1);
  }

  if (chave.endsWith('...')) {
    console.error('');
    console.error('A chave no config.js está CORTADA (termina em "..."). Copie a chave');
    console.error('inteira pelo botão de copiar do painel do Supabase.');
    console.error('');
    process.exit(1);
  }

  return { url: url.replace(/\/$/, ''), chave };
}

/* ========================================================================== *
 * Argumentos
 * ========================================================================== */
function lerArgumentos(argv) {
  const op = { cliente: null, cliente2: null, operadorNf: null, operadorMd: null, detalhado: false };
  const pares = {
    '--cliente': 'cliente',
    '--cliente2': 'cliente2',
    '--operador-nf': 'operadorNf',
    '--operador-md': 'operadorMd',
  };

  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--detalhado') { op.detalhado = true; continue; }
    if (argv[i] === '--ajuda' || argv[i] === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    }
    const campo = pares[argv[i]];
    if (!campo) continue;

    const valor = argv[++i] ?? '';
    const corte = valor.indexOf(':');
    if (corte < 1) {
      console.error(`Formato errado em ${argv[i - 1]}. Use email:senha`);
      process.exit(1);
    }
    op[campo] = { email: valor.slice(0, corte), senha: valor.slice(corte + 1) };
  }
  return op;
}

/* ========================================================================== *
 * Falar com a API como um atacante falaria
 * ========================================================================== */
const { url: URL_BASE, chave: CHAVE_PUBLICA } = lerConfiguracao();
const op = lerArgumentos(process.argv);

async function chamar(caminho, { metodo = 'GET', token = null, corpo = null, extras = {} } = {}) {
  const cabecalhos = {
    apikey: CHAVE_PUBLICA,
    'Content-Type': 'application/json',
    ...extras,
  };
  // Sem token, o Supabase trata como visitante anônimo.
  if (token) cabecalhos.Authorization = `Bearer ${token}`;

  let resposta;
  try {
    resposta = await fetch(`${URL_BASE}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (erro) {
    return { status: 0, ok: false, dados: null, erroDeRede: erro.message };
  }

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }

  return { status: resposta.status, ok: resposta.ok, dados };
}

/** Faz login e devolve o token, ou null. */
async function entrar(credenciais, rotulo) {
  if (!credenciais) return null;

  const r = await chamar('/auth/v1/token?grant_type=password', {
    metodo: 'POST',
    corpo: { email: credenciais.email, password: credenciais.senha },
  });

  if (!r.ok || !r.dados?.access_token) {
    console.log(
      `   aviso: não consegui entrar como ${rotulo} (${credenciais.email}). ` +
        `Resposta: ${r.dados?.error_description ?? r.dados?.msg ?? r.status}`
    );
    return null;
  }
  return r.dados.access_token;
}

/** Quem sou eu, segundo o banco. */
async function meuPerfil(token) {
  const r = await chamar('/rest/v1/profiles?select=id,email,papel,escopo', { token });
  return Array.isArray(r.dados) ? r.dados[0] ?? null : null;
}

/* ========================================================================== *
 * Relatório
 * ========================================================================== */
const VERDE = '\x1b[32m';
const VERMELHO = '\x1b[31m';
const AMARELO = '\x1b[33m';
const CINZA = '\x1b[90m';
const FIM = '\x1b[0m';

const achados = [];

/**
 * @param {object} t
 * @param {string} t.nome          O que foi tentado.
 * @param {'CRITICO'|'ALTO'|'MEDIO'|'INFO'} t.gravidade  Se passar, quão ruim é.
 * @param {boolean} t.protegido    true = o banco recusou, como deveria.
 * @param {string} t.detalhe       O que aconteceu, em uma linha.
 * @param {string} [t.comoCorrigir]
 */
function registrar(t) {
  achados.push(t);

  // Três estados, não dois. Um teste que não conseguiu falar com o servidor
  // NÃO é um furo — e reportar como furo seria pior que não testar, porque
  // ensina a pessoa a ignorar o alerta.
  const marca = t.indeterminado
    ? `${AMARELO}não testado${FIM}`
    : t.protegido
      ? `${VERDE}protegido  ${FIM}`
      : `${VERMELHO}FURO       ${FIM}`;

  console.log(`  [${marca}] ${t.nome}`);
  if (t.indeterminado || !t.protegido || op.detalhado) {
    console.log(`${CINZA}             ${t.detalhe}${FIM}`);
  }
}

/** O servidor respondeu, ou a chamada nem saiu do lugar? */
function houveResposta(r) {
  return r.status !== 0;
}

function pulado(nome, motivo) {
  console.log(`  [${AMARELO}pulado   ${FIM}] ${nome}`);
  console.log(`${CINZA}             ${motivo}${FIM}`);
}

function secao(titulo) {
  console.log('');
  console.log(`── ${titulo} ${'─'.repeat(Math.max(0, 66 - titulo.length))}`);
}

/** Quantas linhas a resposta trouxe. Erro conta como zero. */
function quantasLinhas(resposta) {
  return Array.isArray(resposta.dados) ? resposta.dados.length : 0;
}

/* ========================================================================== *
 * OS TESTES
 * ========================================================================== */
async function rodar() {
  console.log('');
  console.log('  Teste de segurança do Portal de Boletos');
  console.log('  ' + '='.repeat(68));
  console.log(`  Projeto : ${URL_BASE}`);
  console.log(`  Chave   : ${CHAVE_PUBLICA.slice(0, 24)}... (a pública, que está no site)`);
  console.log('');
  console.log('  Cada linha "protegido" é uma boa notícia. Cada "FURO" precisa de ação.');

  // Antes de testar qualquer coisa: o servidor está respondendo? Sem isto, uma
  // internet fora do ar produziria 30 resultados que parecem bons e não são.
  const pulso = await chamar('/rest/v1/');
  if (!houveResposta(pulso)) {
    console.log('');
    console.log(`  ${VERMELHO}Não consegui falar com ${URL_BASE}${FIM}`);
    console.log(`  ${CINZA}${pulso.erroDeRede ?? 'sem resposta'}${FIM}`);
    console.log('');
    console.log('  Confira a internet, a URL no config.js, e se o projeto do Supabase');
    console.log('  não está pausado (o plano grátis pausa após 7 dias sem uso).');
    console.log('');
    console.log('  Nenhum teste foi feito. Um resultado "tudo protegido" com o servidor');
    console.log('  fora do ar seria mentira, então prefiro não te dar resultado nenhum.');
    console.log('');
    process.exit(2);
  }
  console.log(`  ${CINZA}servidor respondeu (HTTP ${pulso.status}) — começando${FIM}`);

  /* ---------------------------------------------------------------------- *
   * 1. VISITANTE — ninguém logado
   * ---------------------------------------------------------------------- *
   * Este é o cenário mais importante de todos: qualquer pessoa do mundo que
   * abrir o seu site tem esta chave. Nada aqui pode retornar dado.
   */
  secao('1. Visitante sem login (qualquer pessoa da internet)');

  const tabelasProibidas = [
    ['boletos', 'CRITICO', 'os boletos, com valores e fornecedores'],
    ['profiles', 'ALTO', 'os nomes e e-mails das pessoas'],
    ['admin_emails', 'ALTO', 'a lista de quem é operador'],
    ['empresas', 'MEDIO', 'as 213 empresas do grupo, com CNPJ'],
    ['contas_bancarias', 'ALTO', 'as contas bancárias do grupo'],
    ['boleto_eventos', 'MEDIO', 'o histórico de cada boleto'],
    ['departamentos', 'INFO', 'a lista de departamentos'],
  ];

  for (const [tabela, gravidade, oQue] of tabelasProibidas) {
    const r = await chamar(`/rest/v1/${tabela}?select=*&limit=5`);
    const linhas = quantasLinhas(r);
    registrar({
      nome: `visitante lê a tabela ${tabela}`,
      gravidade,
      protegido: linhas === 0,
      detalhe:
        linhas === 0
          ? `devolveu 0 linhas (HTTP ${r.status})`
          : `DEVOLVEU ${linhas} LINHA(S) — expõe ${oQue}`,
      comoCorrigir: `Rode db/04_rls.sql de novo e confira a política de select de ${tabela}.`,
    });
  }

  // A visão que a tela do operador usa também precisa estar trancada.
  {
    const r = await chamar('/rest/v1/vw_boletos_operador?select=*&limit=5');
    const linhas = quantasLinhas(r);
    registrar({
      nome: 'visitante lê a visão vw_boletos_operador',
      gravidade: 'CRITICO',
      protegido: linhas === 0,
      detalhe: linhas === 0 ? `devolveu 0 linhas (HTTP ${r.status})` : `DEVOLVEU ${linhas} LINHA(S)`,
      comoCorrigir:
        'A visão precisa de "with (security_invoker = true)". Rode db/03_views.sql de novo.',
    });
  }

  // O Postgres não deve nem deixar espiar as funções internas de autenticação.
  {
    const r = await chamar('/rest/v1/rpc/eh_admin', { metodo: 'POST', corpo: {} });
    registrar({
      nome: 'visitante chama a função eh_admin()',
      gravidade: 'INFO',
      protegido: r.dados === false || !r.ok,
      detalhe: `respondeu ${JSON.stringify(r.dados)} (HTTP ${r.status}) — o esperado é false`,
    });
  }

  // Escrita anônima: o pior dos cenários.
  {
    const r = await chamar('/rest/v1/boletos', {
      metodo: 'POST',
      corpo: {
        solicitante_nome: 'Teste',
        solicitante_sobrenome: 'Seguranca',
        solicitante_email: 'ataque@exemplo.com',
        tipo_documento: 'NF',
        numero_documento: '999999',
        cc: '0000-0',
        unidade_negocio: 'Inventada',
        unidade_cnpj: '00000000000000',
        fornecedor_razao_social: 'Inventado',
        valor: 1,
        vencimento: '2030-01-01',
        departamento: 'Financeiro',
        arquivo_caminho: 'x',
        arquivo_nome: 'x.pdf',
      },
      extras: { Prefer: 'return=representation' },
    });
    const criou = r.ok && Array.isArray(r.dados) && r.dados.length > 0;
    registrar({
      nome: 'visitante cria um boleto',
      gravidade: 'CRITICO',
      protegido: !criou,
      detalhe: criou
        ? 'CRIOU O REGISTRO — qualquer pessoa pode inserir dados no seu banco'
        : `recusado (HTTP ${r.status})`,
      comoCorrigir: 'A política de insert em boletos exige solicitante_id = auth.uid().',
    });
    if (criou) {
      await chamar(`/rest/v1/boletos?id=eq.${r.dados[0].id}`, { metodo: 'DELETE' });
      console.log(`${CINZA}             tentei desfazer — CONFIRA a tabela boletos${FIM}`);
    }
  }

  /* ---------------------------------------------------------------------- *
   * 2. DOMÍNIO — só a Serena entra
   * ---------------------------------------------------------------------- */
  secao('2. Quem pode criar conta');

  for (const email of ['atacante@gmail.com', 'atacante@srna.co.br', 'atacante@fakesrna.co']) {
    const r = await chamar('/auth/v1/signup', {
      metodo: 'POST',
      corpo: { email, password: `Teste-${Date.now()}-Ab1!` },
    });
    const mensagem = JSON.stringify(r.dados?.msg ?? r.dados?.error_description ?? r.dados ?? '');
    const barrado = !r.ok || /srna\.co|Somente|Database error/i.test(mensagem);
    registrar({
      nome: `criar conta com ${email}`,
      gravidade: 'CRITICO',
      protegido: barrado,
      detalhe: barrado
        ? `barrado (HTTP ${r.status})`
        : `ACEITOU — confira o usuário em Authentication > Users e apague`,
      comoCorrigir: 'O gatilho trg_bloquear_dominio_externo em auth.users deve recusar.',
    });
  }

  /* ---------------------------------------------------------------------- *
   * 3. ARQUIVOS — o depósito dos PDFs
   * ---------------------------------------------------------------------- */
  secao('3. Os arquivos dos boletos');

  {
    const r = await chamar('/storage/v1/object/list/boletos', {
      metodo: 'POST',
      corpo: { prefix: '', limit: 20 },
    });
    const linhas = quantasLinhas(r);
    registrar({
      nome: 'visitante lista os arquivos do depósito',
      gravidade: 'CRITICO',
      protegido: linhas === 0,
      detalhe: linhas === 0 ? `devolveu 0 (HTTP ${r.status})` : `LISTOU ${linhas} ARQUIVO(S)`,
      comoCorrigir: 'O balde "boletos" precisa ser privado e ter as políticas de db/05_storage.sql.',
    });
  }

  {
    // Se o balde for público, qualquer caminho é baixável sem token.
    const r = await chamar('/storage/v1/object/public/boletos/qualquer-coisa.pdf');
    const publico = ![400, 401, 403, 404].includes(r.status);
    registrar({
      nome: 'o balde de arquivos é privado',
      gravidade: 'CRITICO',
      indeterminado: !houveResposta(r),
      protegido: !publico,
      detalhe: !houveResposta(r)
        ? `não consegui falar com o servidor (${r.erroDeRede ?? 'sem resposta'})`
        : publico
          ? `O BALDE PARECE PÚBLICO (HTTP ${r.status}) — qualquer link abre um boleto`
          : `acesso público recusado (HTTP ${r.status})`,
      comoCorrigir: 'Storage > ⋯ > Edit bucket > desmarque "Public".',
    });
  }

  /* ---------------------------------------------------------------------- *
   * 4. SOLICITANTE LOGADO — o cliente comum
   * ---------------------------------------------------------------------- */
  secao('4. Solicitante logado (não é operador)');

  const tokenCliente = await entrar(op.cliente, 'cliente');
  const perfilCliente = tokenCliente ? await meuPerfil(tokenCliente) : null;

  if (!tokenCliente) {
    pulado(
      'todos os testes de solicitante',
      'passe --cliente email:senha de uma conta comum @srna.co para rodar'
    );
  } else {
    console.log(
      `${CINZA}             entrei como ${perfilCliente?.email} (papel: ${perfilCliente?.papel})${FIM}`
    );

    if (perfilCliente?.papel === 'admin') {
      pulado(
        'testes de solicitante',
        'a conta passada em --cliente é OPERADOR. Use uma conta comum para este bloco valer.'
      );
    }

    // 4.1 Só vê os próprios boletos.
    {
      const meus = await chamar('/rest/v1/boletos?select=id,solicitante_email', { token: tokenCliente });
      const lista = Array.isArray(meus.dados) ? meus.dados : [];
      const deOutros = lista.filter((b) => b.solicitante_email !== perfilCliente?.email);
      registrar({
        nome: 'solicitante vê boletos de outras pessoas',
        gravidade: 'CRITICO',
        protegido: deOutros.length === 0,
        detalhe:
          deOutros.length === 0
            ? `vê ${lista.length} boleto(s), todos dele`
            : `VÊ ${deOutros.length} BOLETO(S) DE OUTRAS PESSOAS`,
        comoCorrigir: 'A política "boletos: leitura" deve exigir solicitante_id = auth.uid().',
      });
    }

    // 4.2 Não pode se promover.
    if (perfilCliente?.id) {
      const r = await chamar(`/rest/v1/profiles?id=eq.${perfilCliente.id}`, {
        metodo: 'PATCH',
        token: tokenCliente,
        corpo: { papel: 'admin' },
        extras: { Prefer: 'return=representation' },
      });
      const depois = await meuPerfil(tokenCliente);
      const virouAdmin = depois?.papel === 'admin';
      registrar({
        nome: 'solicitante se promove a operador',
        gravidade: 'CRITICO',
        protegido: !virouAdmin,
        detalhe: virouAdmin
          ? 'CONSEGUIU VIRAR ADMIN — corrija agora e reverta no SQL Editor'
          : `recusado (HTTP ${r.status}), papel segue ${depois?.papel}`,
        comoCorrigir: 'A política "perfil: edito o meu nome" deve travar as colunas papel e escopo.',
      });
      if (virouAdmin) {
        console.log(
          `${AMARELO}             AÇÃO IMEDIATA: update profiles set papel='cliente' where id='${perfilCliente.id}';${FIM}`
        );
      }
    }

    // 4.3 Não pode mudar o próprio escopo.
    if (perfilCliente?.id) {
      const r = await chamar(`/rest/v1/profiles?id=eq.${perfilCliente.id}`, {
        metodo: 'PATCH',
        token: tokenCliente,
        corpo: { escopo: 'ambos' },
      });
      const depois = await meuPerfil(tokenCliente);
      registrar({
        nome: 'solicitante muda o próprio escopo',
        gravidade: 'ALTO',
        protegido: depois?.escopo === perfilCliente.escopo,
        detalhe: `escopo antes ${perfilCliente.escopo}, depois ${depois?.escopo} (HTTP ${r.status})`,
      });
    }

    // 4.4 Não pode associar boleto.
    {
      const r = await chamar('/rest/v1/rpc/associar_boleto', {
        metodo: 'POST',
        token: tokenCliente,
        corpo: { p_boleto_id: '00000000-0000-0000-0000-000000000000' },
      });
      const mensagem = JSON.stringify(r.dados ?? '');
      const barrado = !r.ok && /SEM_PERMISSAO|permission|operação/i.test(mensagem);
      registrar({
        nome: 'solicitante chama associar_boleto',
        gravidade: 'CRITICO',
        protegido: barrado || !r.ok,
        detalhe: barrado
          ? 'recusado com SEM_PERMISSAO'
          : `resposta inesperada (HTTP ${r.status}): ${mensagem.slice(0, 90)}`,
      });
    }

    // 4.5 Não pode criar boleto já associado.
    {
      const r = await chamar('/rest/v1/boletos', {
        metodo: 'POST',
        token: tokenCliente,
        corpo: {
          solicitante_id: perfilCliente?.id,
          solicitante_nome: 'Teste',
          solicitante_sobrenome: 'Seguranca',
          solicitante_email: perfilCliente?.email,
          tipo_documento: 'NF',
          numero_documento: '999998',
          cc: '0000-0',
          unidade_negocio: 'Inventada',
          unidade_cnpj: '00000000000000',
          fornecedor_razao_social: 'Inventado',
          valor: 1,
          vencimento: '2030-01-01',
          departamento: 'Financeiro',
          arquivo_caminho: 'x',
          arquivo_nome: 'x.pdf',
          status: 'associado',
        },
        extras: { Prefer: 'return=representation' },
      });
      const criou = r.ok && quantasLinhas(r) > 0;
      registrar({
        nome: 'solicitante cria boleto já marcado como associado',
        gravidade: 'ALTO',
        protegido: !criou,
        detalhe: criou ? 'CRIOU — dá para burlar a fila de aprovação' : `recusado (HTTP ${r.status})`,
      });
      if (criou) await chamar(`/rest/v1/boletos?id=eq.${r.dados[0].id}`, { metodo: 'DELETE', token: tokenCliente });
    }

    // 4.6 Não pode inventar conta bancária.
    {
      const r = await chamar('/rest/v1/boletos', {
        metodo: 'POST',
        token: tokenCliente,
        corpo: {
          solicitante_id: perfilCliente?.id,
          solicitante_nome: 'Teste',
          solicitante_sobrenome: 'Seguranca',
          solicitante_email: perfilCliente?.email,
          tipo_documento: 'NF',
          numero_documento: '999997',
          cc: 'CONTA-QUE-NAO-EXISTE',
          unidade_negocio: 'Inventada',
          unidade_cnpj: '11111111111111',
          fornecedor_razao_social: 'Inventado',
          valor: 1,
          vencimento: '2030-01-01',
          departamento: 'Financeiro',
          arquivo_caminho: 'x',
          arquivo_nome: 'x.pdf',
        },
        extras: { Prefer: 'return=representation' },
      });
      const criou = r.ok && quantasLinhas(r) > 0;
      const mensagem = JSON.stringify(r.dados ?? '');
      registrar({
        nome: 'solicitante inventa uma conta bancária',
        gravidade: 'ALTO',
        protegido: !criou,
        detalhe: criou
          ? 'CRIOU com conta inexistente'
          : /CONTA_INVALIDA/.test(mensagem)
            ? 'recusado pelo gatinho de validação (CONTA_INVALIDA)'
            : `recusado (HTTP ${r.status})`,
        comoCorrigir: 'O gatilho trg_validar_conta em boletos deve conferir contas_bancarias.',
      });
      if (criou) await chamar(`/rest/v1/boletos?id=eq.${r.dados[0].id}`, { metodo: 'DELETE', token: tokenCliente });
    }

    // 4.7 Ninguém apaga boleto — nem o dono.
    {
      const meus = await chamar('/rest/v1/boletos?select=id&limit=1', { token: tokenCliente });
      const id = Array.isArray(meus.dados) ? meus.dados[0]?.id : null;
      if (!id) {
        pulado('apagar um boleto', 'esta conta não tem boleto para tentar apagar');
      } else {
        await chamar(`/rest/v1/boletos?id=eq.${id}`, { metodo: 'DELETE', token: tokenCliente });
        const conferir = await chamar(`/rest/v1/boletos?select=id&id=eq.${id}`, { token: tokenCliente });
        const aindaExiste = quantasLinhas(conferir) === 1;
        registrar({
          nome: 'solicitante apaga o próprio boleto',
          gravidade: 'ALTO',
          protegido: aindaExiste,
          detalhe: aindaExiste
            ? 'o boleto continua lá, como deveria'
            : 'O BOLETO FOI APAGADO — não existe política de delete, mas algo permitiu',
          comoCorrigir: 'Não deve existir policy de delete em boletos. Boleto errado é recusado.',
        });
      }
    }
  }

  /* ---------------------------------------------------------------------- *
   * 5. SEPARAÇÃO NF / MD
   * ---------------------------------------------------------------------- */
  secao('5. Separação entre notas fiscais e medições');

  const tokenNf = await entrar(op.operadorNf, 'operador de NF');
  const tokenMd = await entrar(op.operadorMd, 'operador de MD');

  if (!tokenNf && !tokenMd) {
    pulado(
      'testes de escopo NF/MD',
      'passe --operador-nf e --operador-md para verificar se um vê a fila do outro'
    );
  }

  for (const [token, escopoEsperado, tipoProibido, rotulo] of [
    [tokenNf, 'NF', 'MD', 'operador de NF'],
    [tokenMd, 'MD', 'NF', 'operador de MD'],
  ]) {
    if (!token) continue;

    const perfil = await meuPerfil(token);
    console.log(`${CINZA}             ${rotulo}: ${perfil?.email} (escopo ${perfil?.escopo})${FIM}`);

    if (perfil?.escopo === 'ambos') {
      pulado(
        `${rotulo} não vê ${tipoProibido}`,
        `esta conta tem escopo 'ambos' — por definição vê os dois. Use uma de escopo fixo.`
      );
      continue;
    }

    // Lê direto a tabela, forçando o filtro do tipo proibido.
    const r = await chamar(
      `/rest/v1/boletos?select=id,tipo_documento&tipo_documento=eq.${tipoProibido}`,
      { token }
    );
    const linhas = quantasLinhas(r);
    registrar({
      nome: `${rotulo} lê boletos do tipo ${tipoProibido}`,
      gravidade: 'ALTO',
      protegido: linhas === 0,
      detalhe:
        linhas === 0
          ? `devolveu 0 linhas (HTTP ${r.status})`
          : `DEVOLVEU ${linhas} — o escopo não está sendo respeitado no banco`,
      comoCorrigir: 'A política "boletos: leitura" deve chamar posso_ver_tipo(tipo_documento).',
    });

    // O furo que eu já suspeitava: a política do Storage não confere escopo.
    const arquivos = await chamar('/storage/v1/object/list/boletos', {
      metodo: 'POST',
      token,
      corpo: { prefix: '', limit: 1000 },
    });
    const meusBoletos = await chamar('/rest/v1/boletos?select=id', { token });
    const qtdArquivos = quantasLinhas(arquivos);
    const qtdBoletos = quantasLinhas(meusBoletos);

    registrar({
      nome: `${rotulo} lista arquivos além do seu escopo`,
      gravidade: 'MEDIO',
      protegido: qtdArquivos <= qtdBoletos,
      detalhe:
        qtdArquivos <= qtdBoletos
          ? `${qtdArquivos} arquivo(s) para ${qtdBoletos} boleto(s) visível(is)`
          : `LISTOU ${qtdArquivos} ARQUIVO(S) mas só vê ${qtdBoletos} boleto(s) — ` +
            'a política do Storage não confere o escopo NF/MD',
      comoCorrigir:
        'Acrescentar a checagem de escopo na policy de storage.objects, cruzando com a tabela boletos.',
    });
  }

  /* ---------------------------------------------------------------------- *
   * 6. Sessão e token
   * ---------------------------------------------------------------------- */
  secao('6. Sessão e token');

  {
    const r = await chamar('/rest/v1/boletos?select=id&limit=1', { token: 'token-invalido-abc123' });
    registrar({
      nome: 'token inventado é aceito',
      gravidade: 'CRITICO',
      protegido: !r.ok || quantasLinhas(r) === 0,
      detalhe: `HTTP ${r.status}, ${quantasLinhas(r)} linha(s)`,
    });
  }

  if (tokenCliente) {
    // Um token de solicitante não pode virar operador só pedindo bonito.
    const r = await chamar('/rest/v1/rpc/meu_papel', { metodo: 'POST', token: tokenCliente, corpo: {} });
    registrar({
      nome: 'o banco confirma o papel real do token',
      gravidade: 'INFO',
      protegido: r.dados === 'cliente' || r.dados === 'admin',
      detalhe: `meu_papel() devolveu ${JSON.stringify(r.dados)}`,
    });
  }

  /* ====================================================================== *
   * RELATÓRIO
   * ====================================================================== */
  const naoTestados = achados.filter((a) => a.indeterminado);
  const furos = achados.filter((a) => !a.indeterminado && !a.protegido);
  const porGravidade = (g) => furos.filter((f) => f.gravidade === g);

  console.log('');
  console.log('  ' + '='.repeat(68));
  console.log('  RESULTADO');
  console.log('  ' + '='.repeat(68));
  console.log(`  Tentativas       : ${achados.length}`);
  console.log(`  ${VERDE}Protegido        : ${achados.length - furos.length - naoTestados.length}${FIM}`);
  console.log(`  ${furos.length ? VERMELHO : VERDE}Furos            : ${furos.length}${FIM}`);
  if (naoTestados.length) {
    console.log(`  ${AMARELO}Não testados     : ${naoTestados.length}${FIM}`);
    naoTestados.forEach((t) => console.log(`${CINZA}      · ${t.nome}: ${t.detalhe}${FIM}`));
  }

  if (!furos.length) {
    console.log('');
    console.log(`  ${VERDE}Nenhum furo nas travas do banco.${FIM}`);
    console.log('');
    console.log('  O que este resultado NÃO garante, e é importante saber:');
    console.log('    · que a senha de ninguém tenha vazado');
    console.log('    · que a chave service_role esteja segura (ela não é testada aqui)');
    console.log('    · que exista backup');
    console.log('    · que MFA esteja ligado');
    console.log('    · que ninguém com acesso legítimo use o dado indevidamente');
    console.log('');
    process.exit(0);
  }

  for (const gravidade of ['CRITICO', 'ALTO', 'MEDIO', 'INFO']) {
    const lista = porGravidade(gravidade);
    if (!lista.length) continue;
    console.log('');
    console.log(`  ${gravidade} (${lista.length}):`);
    for (const f of lista) {
      console.log(`    · ${f.nome}`);
      console.log(`      ${CINZA}${f.detalhe}${FIM}`);
      if (f.comoCorrigir) console.log(`      ${AMARELO}como corrigir: ${f.comoCorrigir}${FIM}`);
    }
  }

  console.log('');
  if (porGravidade('CRITICO').length) {
    console.log(`  ${VERMELHO}Existe furo CRÍTICO. Trate antes de mais gente usar o portal.${FIM}`);
  }
  console.log('');
  process.exit(1);
}

rodar().catch((erro) => {
  console.error('');
  console.error('Erro ao rodar os testes:', erro.message);
  console.error('');
  process.exit(2);
});
