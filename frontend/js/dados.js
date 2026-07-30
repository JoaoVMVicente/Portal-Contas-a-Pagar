/**
 * dados.js — Escolhe com quem falar.
 *
 * Se o config.js tem as chaves do Supabase, usamos o banco de verdade.
 * Se não tem, cai no modo demonstração, que guarda tudo no navegador.
 *
 * As telas importam SÓ este arquivo. Elas nunca sabem qual dos dois está
 * ativo — e é por isso que dá para trocar de um para o outro sem mexer em
 * nenhuma tela.
 */

import { modoAtivo } from './config.js';
import { criarDriverDemo } from './dados-demo.js';
import { criarDriverSupabase } from './dados-supabase.js';

export const MODO = modoAtivo();
export const EH_DEMO = MODO === 'demo';
export const dados = EH_DEMO ? criarDriverDemo() : criarDriverSupabase();
