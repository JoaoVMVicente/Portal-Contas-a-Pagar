#!/usr/bin/env node
/**
 * convidar-equipe.mjs — Manda o convite de primeiro acesso para a equipe.
 *
 * ===========================================================================
 * QUANDO USAR ISTO
 * ===========================================================================
 * O portal já sabe mandar o link sozinho: a pessoa abre o login, clica em
 * "Primeiro acesso", digita o e-mail e recebe. Este script existe para o caso
 * em que você quer PUXAR o convite em vez de esperar cada um pedir:
 *
 *   - dia da virada, com as 17 pessoas de uma vez;
 *   - alguém novo entrou no time;
 *   - alguém não achou o e-mail e você quer reenviar.
 *
 * Ele usa `inviteUserByEmail`, que é a função oficial de convite do Supabase.
 * Ela cria o usuário já com o papel certo e manda um e-mail de convite.
 *
 * ===========================================================================
 * POR QUE ISTO NÃO RODA NO NAVEGADOR
 * ===========================================================================
 * Porque precisa da chave `service_role`, que ignora todas as travas de
 * segurança do banco. Se ela aparecesse numa página, qualquer pessoa que
 * abrisse o código-fonte teria acesso total ao banco.
 *
 * Então isto roda na SUA máquina, lendo a chave do backend/.env, e nunca vai
 * para o GitHub (o .env está no .gitignore).
 *
 * ===========================================================================
 * COMO USAR
 * ===========================================================================
 *   cd tools
 *   npm install
 *
 *   # 1. Ver quem seria convidado, sem mandar nada:
 *   node convidar-equipe.mjs --simular
 *
 *   # 2. Mandar de verdade:
 *   node convidar-equipe.mjs
 *
 *   # 3. Só uma pessoa:
 *   node convidar-equipe.mjs --email alguem@srna.co
 *
 *   # 4. Reenviar para quem já foi convidado mas ainda não entrou:
 *   node convidar-equipe.mjs --reenviar
 *
 * O e-mail sai com o mesmo remetente e o mesmo modelo que o portal usa. O
 * link leva para a tela "Escolha sua senha".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

/* ========================================================================== *
 * Ler as configurações
 * ========================================================================== */
function lerEnv() {
  const caminho = path.join(RAIZ, 'backend/.env');
  if (!fs.existsSync(caminho)) {
    console.error('');
    console.error('Não achei o arquivo backend/.env.');
    console.error('');
    console.error('  cd backend');
    console.error('  cp .env.example .env      (no Windows: copy .env.example .env)');
    console.error('');
    console.error('Depois preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    console.error('As duas estão em Project Settings > API, no painel do Supabase.');
    console.error('');
    process.exit(1);
  }

  const env = {};
  for (const linha of fs.readFileSync(caminho, 'utf8').split('\n')) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const igual = limpa.indexOf('=');
    if (igual < 0) continue;
    env[limpa.slice(0, igual).trim()] = limpa.slice(igual + 1).trim();
  }
  return env;
}

/** O endereço para onde o link do convite leva. */
function lerEnderecoDoPortal(env) {
  if (env.ENDERECO_DO_PORTAL) return env.ENDERECO_DO_PORTAL.replace(/\/$/, '');
  return 'http://localhost:8080';
}

/* ========================================================================== *
 * Ler a lista da equipe do próprio SQL, para não haver duas listas
 * ========================================================================== */
/**
 * Em vez de repetir os e-mails aqui, lemos de db/06_seed_admins.sql.
 * Assim existe uma fonte só: mexeu no SQL, o script segue.
 */
function lerEquipeDoSql() {
  const caminho = path.join(RAIZ, 'db/06_seed_admins.sql');
  const conteudo = fs.readFileSync(caminho, 'utf8');

  const pessoas = [];
  // Linhas no formato: ('email', 'Nome', 'escopo', ...)
  const padrao = /\(\s*'([^']+@[^']+)'\s*,\s*'([^']*)'\s*,\s*'(NF|MD|ambos)'/g;
  let m;
  while ((m = padrao.exec(conteudo)) !== null) {
    pessoas.push({ email: m[1].toLowerCase(), nome: m[2], escopo: m[3] });
  }
  return pessoas;
}

/* ========================================================================== *
 * Argumentos
 * ========================================================================== */
function lerArgumentos(argv) {
  const op = { simular: false, reenviar: false, email: null, pausaMs: 1200 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--simular') op.simular = true;
    else if (argv[i] === '--reenviar') op.reenviar = true;
    else if (argv[i] === '--email') op.email = argv[++i]?.toLowerCase();
    else if (argv[i] === '--pausa') op.pausaMs = Number(argv[++i]) || 1200;
    else if (argv[i] === '--ajuda' || argv[i] === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return op;
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* ========================================================================== *
 * Principal
 * ========================================================================== */
async function principal() {
  const op = lerArgumentos(process.argv);
  const env = lerEnv();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('');
    console.error('Falta preencher no backend/.env:');
    if (!env.SUPABASE_URL) console.error('  SUPABASE_URL');
    if (!env.SUPABASE_SERVICE_ROLE_KEY) console.error('  SUPABASE_SERVICE_ROLE_KEY');
    console.error('');
    console.error('As duas estão em Project Settings > API.');
    console.error('A service_role é a chave secreta — nunca coloque no front-end.');
    console.error('');
    process.exit(1);
  }

  const portal = lerEnderecoDoPortal(env);
  const destino = `${portal}/login.html?definir-senha=1`;

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let equipe = lerEquipeDoSql();
  if (op.email) equipe = equipe.filter((p) => p.email === op.email);

  if (!equipe.length) {
    console.error(
      op.email
        ? `O e-mail ${op.email} não está em db/06_seed_admins.sql. Acrescente lá primeiro.`
        : 'Não achei ninguém em db/06_seed_admins.sql.'
    );
    process.exit(1);
  }

  // Quem já tem conta? Não convidamos de novo sem o --reenviar.
  const jaExistem = new Map();
  try {
    let pagina = 1;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (error) throw error;
      for (const u of data.users ?? []) {
        jaExistem.set(String(u.email).toLowerCase(), u);
      }
      if (!data.users?.length || data.users.length < 200) break;
      pagina += 1;
    }
  } catch (erro) {
    console.error('Não consegui listar os usuários. A chave service_role está certa?');
    console.error(erro.message);
    process.exit(1);
  }

  console.log('');
  console.log(`Projeto : ${env.SUPABASE_URL}`);
  console.log(`Portal  : ${portal}`);
  console.log(`Equipe  : ${equipe.length} pessoa(s) em db/06_seed_admins.sql`);
  console.log(`Já com conta: ${equipe.filter((p) => jaExistem.has(p.email)).length}`);
  console.log('');

  if (op.simular) {
    console.log('MODO SIMULAÇÃO — nada será enviado.');
    console.log('');
  }

  const resultado = { convidados: 0, reenviados: 0, pulados: 0, falhas: [] };

  for (const pessoa of equipe) {
    const existente = jaExistem.get(pessoa.email);
    const confirmado = Boolean(existente?.email_confirmed_at);
    const rotulo = `${pessoa.email.padEnd(34)} ${pessoa.escopo.padEnd(6)}`;

    // Quem já entrou de verdade fica de fora: reenviar convite para alguém que
    // já usa o portal só geraria confusão.
    if (confirmado && !op.reenviar) {
      console.log(`  ${rotulo} já ativo, pulei`);
      resultado.pulados += 1;
      continue;
    }

    if (op.simular) {
      console.log(`  ${rotulo} ${existente ? 'reenviaria convite' : 'convidaria'}`);
      continue;
    }

    try {
      if (existente) {
        // Já existe mas não ativou: o caminho é o link de definir senha.
        const { error } = await admin.auth.resetPasswordForEmail(pessoa.email, {
          redirectTo: destino,
        });
        if (error) throw error;
        console.log(`  ${rotulo} link reenviado`);
        resultado.reenviados += 1;
      } else {
        const [nome, ...resto] = (pessoa.nome || '').split(' ');
        const { error } = await admin.auth.admin.inviteUserByEmail(pessoa.email, {
          redirectTo: destino,
          data: { nome: nome || '', sobrenome: resto.join(' ') },
        });
        if (error) throw error;
        console.log(`  ${rotulo} convite enviado`);
        resultado.convidados += 1;
      }
    } catch (erro) {
      const mensagem = erro?.message ?? String(erro);
      console.log(`  ${rotulo} FALHOU: ${mensagem}`);
      resultado.falhas.push({ email: pessoa.email, mensagem });

      if (/rate limit|too many/i.test(mensagem)) {
        console.log('');
        console.log('  Bateu no limite de envio do Supabase.');
        console.log('  Sem SMTP próprio, o limite é baixo (poucos e-mails por hora).');
        console.log('  Configure o SMTP — veja docs/08-EMAIL-DE-VERDADE.md — ou espere');
        console.log('  uma hora e rode de novo: quem já foi convidado será pulado.');
        break;
      }
    }

    // Uma pausa entre os envios evita bater no limite por rajada.
    await esperar(op.pausaMs);
  }

  console.log('');
  console.log('----------------------------------------');
  console.log(`Convites enviados : ${resultado.convidados}`);
  console.log(`Links reenviados  : ${resultado.reenviados}`);
  console.log(`Pulados (já ativos): ${resultado.pulados}`);
  console.log(`Falhas            : ${resultado.falhas.length}`);
  console.log('');

  if (resultado.falhas.length) {
    console.log('Falhas:');
    resultado.falhas.forEach((f) => console.log(`  ${f.email}: ${f.mensagem}`));
    console.log('');
  }

  if (!op.simular && (resultado.convidados || resultado.reenviados)) {
    console.log('Cada pessoa vai receber um e-mail com um link.');
    console.log('O link abre a tela "Escolha sua senha" do portal.');
    console.log('O papel de operador é aplicado sozinho, pelo gatilho do banco.');
    console.log('');
  }
}

principal().catch((erro) => {
  console.error('');
  console.error('Erro inesperado:', erro.message);
  console.error('');
  process.exit(1);
});
