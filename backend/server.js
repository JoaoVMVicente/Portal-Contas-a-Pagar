/**
 * server.js — O back-end do Portal de Associacao de Boletos.
 *
 * ===========================================================================
 * ATENCAO, LEIA ISTO PRIMEIRO
 * ===========================================================================
 * Este back-end e OPCIONAL. O portal funciona sem ele, porque o front-end
 * conversa direto com o Supabase (que ja e um back-end pronto e seguro).
 *
 * Este servidor existe para:
 *   - ler boletos no servidor, com uma linha de comando ou curl;
 *   - reprocessar boletos em lote;
 *   - recarregar a tabela de unidades de negocio a partir do Excel;
 *   - servir de porta de entrada caso um dia outro sistema precise consultar
 *     os boletos sem usar o navegador.
 *
 * Se voce publicar o portal no GitHub Pages (que e HTTPS), a pagina NAO vai
 * conseguir chamar este servidor rodando em http://localhost. O navegador
 * bloqueia isso, e ele esta certo em bloquear. Por isso o padrao do portal e
 * fazer tudo no navegador.
 * ===========================================================================
 */

import express from 'express';
import cors from 'cors';
import { config, resumoDaConfiguracao, temSupabase } from './src/config.js';

import rotasSaude from './src/routes/saude.js';
import rotasExtracao from './src/routes/extracao.js';
import rotasBoletos from './src/routes/boletos.js';
import rotasContas from './src/routes/contas.js';
import rotasAdmin from './src/routes/admin.js';

const app = express();

/* ---------------------------------------------------------------------------
 * 1. Quem pode falar com este servidor
 * ------------------------------------------------------------------------- */
app.use(
  cors({
    origin(origem, responder) {
      // Sem origem = chamada de terminal (curl, script). Liberado.
      if (!origem) return responder(null, true);
      if (config.origensPermitidas.includes(origem)) return responder(null, true);
      responder(
        new Error(
          `A origem ${origem} nao esta liberada. ` +
            'Adicione em ORIGENS_PERMITIDAS no arquivo .env.'
        )
      );
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');

/* ---------------------------------------------------------------------------
 * 2. Um registro simples de quem chamou o que
 * ------------------------------------------------------------------------- */
app.use((req, res, proximo) => {
  const inicio = Date.now();
  res.on('finish', () => {
    const duracao = Date.now() - inicio;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${duracao}ms)`);
  });
  proximo();
});

/* ---------------------------------------------------------------------------
 * 3. Um freio simples, para ninguem abusar da leitura de arquivos
 * ------------------------------------------------------------------------- */
const contador = new Map();
const JANELA_MS = 60_000;
const LIMITE_POR_JANELA = 60;

app.use('/api', (req, res, proximo) => {
  const chave = req.ip ?? 'desconhecido';
  const agora = Date.now();
  const registro = contador.get(chave) ?? { inicio: agora, vezes: 0 };

  if (agora - registro.inicio > JANELA_MS) {
    registro.inicio = agora;
    registro.vezes = 0;
  }
  registro.vezes += 1;
  contador.set(chave, registro);

  if (registro.vezes > LIMITE_POR_JANELA) {
    return res.status(429).json({
      erro: 'muitos_pedidos',
      mensagem: 'Muitos pedidos em pouco tempo. Espere um minuto e tente de novo.',
    });
  }
  proximo();
});

/* ---------------------------------------------------------------------------
 * 4. As rotas
 * ------------------------------------------------------------------------- */
app.get('/', (_req, res) => {
  res.json({
    servico: 'Portal de Associacao de Boletos — Serena Energia',
    documentacao: 'Veja docs/04-API.md',
    rotas: [
      'GET  /api/saude',
      'POST /api/extracao/arquivo   (multipart, campo "arquivo")',
      'POST /api/extracao/codigo    ({ codigo })',
      'GET  /api/boletos',
      'GET  /api/boletos/kpis',
      'GET  /api/boletos/:id',
      'GET  /api/boletos/:id/arquivo',
      'POST /api/boletos/:id/associar',
      'POST /api/boletos/:id/recusar',
      'POST /api/boletos/:id/reabrir',
      'GET  /api/contas/empresas?busca=...',
      'GET  /api/contas/empresas/:documento',
      'GET  /api/contas/:conta',
      'POST /api/admin/recarregar-contas',
      'GET  /api/admin/conferir-contas',
    ],
  });
});

app.use('/api/saude', rotasSaude);
app.use('/api/extracao', rotasExtracao);

// As rotas abaixo precisam do banco. Sem Supabase configurado, avisamos direito
// em vez de estourar um erro feio.
function exigirBanco(_req, res, proximo) {
  if (!temSupabase) {
    return res.status(503).json({
      erro: 'sem_banco',
      mensagem:
        'Este back-end esta sem o Supabase configurado. ' +
        'Copie backend/.env.example para backend/.env e preencha SUPABASE_URL e SUPABASE_ANON_KEY.',
    });
  }
  proximo();
}

app.use('/api/boletos', exigirBanco, rotasBoletos);
app.use('/api/contas', exigirBanco, rotasContas);
app.use('/api/admin', exigirBanco, rotasAdmin);

/* ---------------------------------------------------------------------------
 * 5. Rota que nao existe
 * ------------------------------------------------------------------------- */
app.use((req, res) => {
  res.status(404).json({
    erro: 'rota_nao_encontrada',
    mensagem: `Nao existe ${req.method} ${req.originalUrl}. Veja a lista em GET /.`,
  });
});

/* ---------------------------------------------------------------------------
 * 6. Tratador de erros: sempre em portugues, nunca vazando detalhe interno
 * ------------------------------------------------------------------------- */
app.use((erro, _req, res, _proximo) => {
  console.error('Erro:', erro);

  if (erro?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      erro: 'arquivo_grande',
      mensagem: `O arquivo passou do limite de ${config.tamanhoMaxArquivoMb} MB.`,
    });
  }

  // Erros do Postgres que a gente mesmo criou nas funcoes do banco.
  const mensagem = erro?.message ?? 'Erro inesperado.';
  const ehErroDeRegra = /^[A-Z_]+:/.test(mensagem) || erro?.code?.startsWith?.('P0');

  res.status(ehErroDeRegra ? 400 : 500).json({
    erro: erro?.code ?? 'erro_interno',
    mensagem,
  });
});

/* ---------------------------------------------------------------------------
 * 7. Liga o servidor
 * ------------------------------------------------------------------------- */
app.listen(config.porta, () => {
  console.log('');
  console.log('  Portal de Associacao de Boletos — back-end no ar');
  console.log('  ---------------------------------------------------');
  console.log(`  Endereco:  http://localhost:${config.porta}`);
  console.log(`  Saude:     http://localhost:${config.porta}/api/saude`);
  console.log('');
  console.table(resumoDaConfiguracao());
  if (!temSupabase) {
    console.log('');
    console.log('  AVISO: sem Supabase configurado.');
    console.log('  Funciona: /api/extracao/*  (leitura de boleto)');
    console.log('  Nao funciona: /api/boletos, /api/contas, /api/admin');
    console.log('  Para ligar: copie .env.example para .env e preencha as chaves.');
  }
  console.log('');
});
