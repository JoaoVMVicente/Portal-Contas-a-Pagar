/**
 * supabase.js — Cria os "clientes" que conversam com o banco.
 *
 * Existem dois jeitos de falar com o Supabase:
 *
 *  1. Como o USUARIO (clienteComoUsuario): usa o cracha (token) que veio no
 *     pedido. O banco aplica o RLS normalmente, entao o usuario so ve o que
 *     tem direito de ver. E o jeito seguro e o que usamos quase sempre.
 *
 *  2. Como ADMINISTRADOR (clienteAdministrador): usa a chave service_role, que
 *     passa por cima do RLS. Serve para tarefas de manutencao, como recarregar
 *     a lista de unidades de negocio. Nunca exponha essa chave no navegador.
 */

import { createClient } from '@supabase/supabase-js';
import { config, temSupabase, temServiceRole } from './config.js';

const opcoesBase = {
  auth: { persistSession: false, autoRefreshToken: false },
};

/** Cliente que respeita o RLS, agindo em nome de quem fez o pedido. */
export function clienteComoUsuario(token) {
  if (!temSupabase) {
    throw new Error('O Supabase nao esta configurado neste back-end. Preencha o arquivo .env.');
  }
  return createClient(config.supabase.url, config.supabase.anonKey, {
    ...opcoesBase,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Cliente sem token, so para operacoes publicas (como validar um token). */
export function clientePublico() {
  if (!temSupabase) {
    throw new Error('O Supabase nao esta configurado neste back-end. Preencha o arquivo .env.');
  }
  return createClient(config.supabase.url, config.supabase.anonKey, opcoesBase);
}

/** Cliente que ignora o RLS. Use com muito cuidado. */
export function clienteAdministrador() {
  if (!temServiceRole) {
    throw new Error(
      'A chave service_role nao esta configurada. Esta rota precisa dela para funcionar.'
    );
  }
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, opcoesBase);
}
