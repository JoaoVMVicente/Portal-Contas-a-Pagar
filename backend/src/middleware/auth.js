/**
 * auth.js — O porteiro do back-end.
 *
 * Toda rota protegida passa por aqui. O porteiro faz tres perguntas:
 *   1. Voce trouxe o cracha? (o cabecalho Authorization: Bearer <token>)
 *   2. O cracha e verdadeiro? (perguntamos ao Supabase)
 *   3. Voce e operador ou cliente? (lemos da tabela profiles)
 *
 * O resultado fica em req.usuario, para as rotas usarem.
 */

import { clientePublico, clienteComoUsuario } from '../supabase.js';

/** Tira o token do cabecalho. Devolve null se nao tiver. */
function pegarToken(req) {
  const cabecalho = req.headers.authorization ?? '';
  const partes = cabecalho.split(' ');
  if (partes.length === 2 && /^Bearer$/i.test(partes[0])) return partes[1];
  return null;
}

/**
 * Exige um cracha valido.
 * Se `exigirOperador` for true, tambem exige que a pessoa seja da operacao.
 */
export function exigirLogin({ exigirOperador = false } = {}) {
  return async function porteiro(req, res, proximo) {
    try {
      const token = pegarToken(req);
      if (!token) {
        return res.status(401).json({
          erro: 'sem_token',
          mensagem: 'Faltou o cracha. Envie o cabecalho Authorization: Bearer <token>.',
        });
      }

      // 1. O Supabase confirma se o token e valido e de quem e.
      const publico = clientePublico();
      const { data, error } = await publico.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({
          erro: 'token_invalido',
          mensagem: 'Cracha invalido ou expirado. Entre no portal novamente.',
        });
      }

      const usuario = data.user;

      // 2. Descobrimos o papel lendo o proprio perfil, com o RLS ligado.
      const comoUsuario = clienteComoUsuario(token);
      const { data: perfil } = await comoUsuario
        .from('profiles')
        .select('id, nome, sobrenome, nome_completo, email, papel')
        .eq('id', usuario.id)
        .maybeSingle();

      req.token = token;
      req.supabase = comoUsuario;
      req.usuario = {
        id: usuario.id,
        email: usuario.email,
        emailConfirmado: Boolean(usuario.email_confirmed_at),
        papel: perfil?.papel ?? 'cliente',
        nome: perfil?.nome ?? null,
        sobrenome: perfil?.sobrenome ?? null,
        nomeCompleto: perfil?.nome_completo ?? null,
      };

      if (!req.usuario.emailConfirmado) {
        return res.status(403).json({
          erro: 'email_nao_confirmado',
          mensagem: 'Confirme seu e-mail antes de usar o portal.',
        });
      }

      if (exigirOperador && req.usuario.papel !== 'admin') {
        return res.status(403).json({
          erro: 'sem_permissao',
          mensagem: 'Esta area e so para a equipe de operacao.',
        });
      }

      proximo();
    } catch (erro) {
      proximo(erro);
    }
  };
}

/** Versao leve: se tiver cracha, identifica; se nao tiver, deixa passar mesmo assim. */
export async function identificarSePuder(req, _res, proximo) {
  const token = pegarToken(req);
  if (!token) return proximo();
  try {
    const { data } = await clientePublico().auth.getUser(token);
    if (data?.user) {
      req.token = token;
      req.supabase = clienteComoUsuario(token);
      req.usuario = { id: data.user.id, email: data.user.email };
    }
  } catch {
    /* sem cracha valido, segue como visitante */
  }
  proximo();
}
