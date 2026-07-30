/**
 * config.js — Le o arquivo .env e deixa tudo organizado num objeto so.
 *
 * A ideia: em vez de espalhar `process.env.ALGUMA_COISA` pelo codigo todo,
 * lemos tudo aqui, uma vez, e avisamos logo se faltou algo importante.
 */

import 'dotenv/config';

function texto(nome, padrao = '') {
  const valor = process.env[nome];
  return valor == null || valor === '' ? padrao : String(valor).trim();
}

function numero(nome, padrao) {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) ? valor : padrao;
}

function lista(nome, padrao = []) {
  const valor = texto(nome);
  if (!valor) return padrao;
  return valor
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  porta: numero('PORT', 3333),
  origensPermitidas: lista('ORIGENS_PERMITIDAS', [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ]),
  supabase: {
    url: texto('SUPABASE_URL'),
    anonKey: texto('SUPABASE_ANON_KEY'),
    serviceRoleKey: texto('SUPABASE_SERVICE_ROLE_KEY'),
  },
  tamanhoMaxArquivoMb: numero('TAMANHO_MAX_ARQUIVO_MB', 10),
  dominiosPermitidos: lista('DOMINIOS_PERMITIDOS', ['srna.co']),
};

/** Diz se o Supabase esta configurado. Sem isso, so a leitura de boleto funciona. */
export const temSupabase = Boolean(config.supabase.url && config.supabase.anonKey);
export const temServiceRole = Boolean(config.supabase.url && config.supabase.serviceRoleKey);

/** Mostra no terminal o que esta ligado e o que nao esta. */
export function resumoDaConfiguracao() {
  return {
    porta: config.porta,
    origensPermitidas: config.origensPermitidas,
    supabaseConfigurado: temSupabase,
    chaveDeAdministradorConfigurada: temServiceRole,
    tamanhoMaxArquivoMb: config.tamanhoMaxArquivoMb,
    dominiosPermitidos: config.dominiosPermitidos,
  };
}
