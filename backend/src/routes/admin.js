/**
 * admin.js — Tarefas de manutencao. So para a equipe de operacao.
 *
 * Usa a chave service_role, que ignora o RLS. Por isso cada rota aqui checa
 * primeiro se quem chamou e operador de verdade.
 */

import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { exigirLogin } from '../middleware/auth.js';
import { clienteAdministrador } from '../supabase.js';

const rotas = Router();
rotas.use(exigirLogin({ exigirOperador: true }));

const aqui = dirname(fileURLToPath(import.meta.url));
const CAMINHO_JSON = resolve(aqui, '../../../frontend/data/contas-bancarias.json');

/**
 * POST /api/admin/recarregar-contas
 *
 * Le o arquivo frontend/data/contas-bancarias.json (o que o importador de Excel
 * gerou) e sobe para a tabela do banco. Estrategia: marca tudo como inativo,
 * depois reativa e atualiza o que veio na planilha. Nada e apagado, para o
 * historico dos boletos antigos continuar fazendo sentido.
 */
rotas.post('/recarregar-contas', async (req, res, proximo) => {
  try {
    const pacote = JSON.parse(await readFile(CAMINHO_JSON, 'utf8'));
    const empresas = pacote.empresas ?? [];

    if (!empresas.length) {
      return res.status(400).json({
        erro: 'json_vazio',
        mensagem:
          'O arquivo contas-bancarias.json esta sem empresas. ' +
          'Rode o importador em tools/ antes.',
      });
    }

    const admin = clienteAdministrador();

    // 1. Tudo inativo. Nada e apagado: o historico dos boletos antigos precisa
    //    continuar fazendo sentido mesmo que a empresa saia da planilha.
    await admin.from('empresas').update({ ativo: false }).neq('documento', '__nunca__');
    await admin.from('contas_bancarias').update({ ativo: false }).neq('conta', '__nunca__');

    // 2. Empresas, em blocos.
    let empresasGravadas = 0;
    for (let i = 0; i < empresas.length; i += 300) {
      const bloco = empresas.slice(i, i + 300);
      const { error } = await admin.from('empresas').upsert(
        bloco.map((e) => ({
          documento: e.documento,
          documento_tipo: e.documentoTipo ?? 'cnpj',
          razao_social: e.razaoSocial,
          nomes_alternativos: e.nomesAlternativos ?? [],
          chave_busca: e.chaveBusca ?? '',
          grupo_economico: e.grupo ?? null,
          codigo_interno: e.codigo ?? null,
          ativo: true,
        })),
        { onConflict: 'documento' }
      );
      if (error) throw error;
      empresasGravadas += bloco.length;
    }

    // 3. Contas, em blocos.
    const contas = [];
    for (const e of empresas) {
      for (const c of e.contas ?? []) {
        contas.push({
          empresa_documento: e.documento,
          conta: c.conta,
          conta_digitos: c.contaDigitos ?? '',
          banco: c.banco ?? null,
          cod_banco: c.codBanco ?? null,
          agencia: c.agencia ?? null,
          tipo_conta: c.tipoConta ?? null,
          ativo: Boolean(c.ativa),
        });
      }
    }

    let contasGravadas = 0;
    for (let i = 0; i < contas.length; i += 400) {
      const bloco = contas.slice(i, i + 400);
      const { error } = await admin
        .from('contas_bancarias')
        .upsert(bloco, { onConflict: 'empresa_documento,conta' });
      if (error) throw error;
      contasGravadas += bloco.length;
    }

    res.json({
      ok: true,
      empresas: empresasGravadas,
      contas: contasGravadas,
      geradoEm: pacote.geradoEm ?? null,
      mensagem: `${empresasGravadas} empresa(s) e ${contasGravadas} conta(s) atualizada(s).`,
    });
  } catch (erro) {
    proximo(erro);
  }
});

/** GET /api/admin/conferir-contas — o JSON esta igual ao banco? */
rotas.get('/conferir-contas', async (req, res, proximo) => {
  try {
    const pacote = JSON.parse(await readFile(CAMINHO_JSON, 'utf8'));

    const noArquivo = new Set();
    for (const e of pacote.empresas ?? []) {
      for (const c of e.contas ?? []) {
        if (c.ativa) noArquivo.add(`${e.documento}|${c.conta}`);
      }
    }

    const { data, error } = await req.supabase
      .from('contas_bancarias')
      .select('empresa_documento, conta')
      .eq('ativo', true);
    if (error) throw error;

    const noBanco = new Set((data ?? []).map((c) => `${c.empresa_documento}|${c.conta}`));

    const soNoArquivo = [...noArquivo].filter((k) => !noBanco.has(k));
    const soNoBanco = [...noBanco].filter((k) => !noArquivo.has(k));

    res.json({
      iguais: soNoArquivo.length === 0 && soNoBanco.length === 0,
      totalNoArquivo: noArquivo.size,
      totalNoBanco: noBanco.size,
      soNoArquivo: soNoArquivo.slice(0, 50),
      soNoBanco: soNoBanco.slice(0, 50),
    });
  } catch (erro) {
    proximo(erro);
  }
});

export default rotas;
