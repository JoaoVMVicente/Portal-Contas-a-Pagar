/**
 * config.js — O único arquivo que você precisa editar para ligar o banco.
 */

export const CONFIG = {
  // ---------------------------------------------------------------------
  // COLE AQUI as duas chaves do Supabase (Project Settings > API).
  // Enquanto estiverem vazias, o portal roda em modo demonstração.
  // ---------------------------------------------------------------------
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // 'auto' decide sozinho: com chaves usa o banco, sem chaves usa a demo.
  // Force com 'supabase' ou 'demo' se quiser testar um dos dois.
  MODO: 'auto',

  // Back-end Express, se você for usar. Deixe vazio para o navegador fazer
  // tudo sozinho (é o padrão, e o único que funciona no GitHub Pages).
  API_URL: '',

  // ---------------------------------------------------------------------
  // Quem pode entrar
  // ---------------------------------------------------------------------
  // A Serena tem dois domínios: o do quadro e o dos terceirizados. Os dois
  // entram. Qualquer outro, não. Esta lista é conveniência da tela — quem
  // realmente barra é o gatilho no banco (db/02_functions_triggers.sql).
  DOMINIOS_PERMITIDOS: ['srna.co', 'ext.srna.co'],

  // Sufixo que identifica terceirizado. Serve só para a tela mostrar um
  // selo discreto; não muda permissão nenhuma.
  DOMINIO_TERCEIRIZADO: 'ext.srna.co',

  // ---------------------------------------------------------------------
  // Arquivos e listas
  // ---------------------------------------------------------------------
  TAMANHO_MAX_ARQUIVO_MB: 10,
  TIPOS_ACEITOS: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  LINHAS_POR_PAGINA: 25,

  // Reconhecimento de imagem. Último recurso: só entra em ação quando o PDF
  // não tem texto dentro. Veja a seção 4 da PRD.
  USAR_OCR: true,
  IDIOMA_OCR: 'por',

  // Senha mínima. O Supabase também impõe o dele; usamos o maior dos dois.
  TAMANHO_MINIMO_SENHA: 8,

  // ---------------------------------------------------------------------
  // Bibliotecas externas, com endereços alternativos caso um CDN caia
  // ---------------------------------------------------------------------
  CDN_SUPABASE: [
    'https://esm.sh/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
    'https://unpkg.com/@supabase/supabase-js@2/dist/module/index.js',
  ],
  CDN_PDFJS: [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs',
  ],
  CDN_PDFJS_WORKER: [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs',
  ],
  CDN_TESSERACT: [
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js',
    'https://unpkg.com/tesseract.js@5/dist/tesseract.esm.min.js',
  ],
};

/** Decide o modo de verdade. */
export function modoAtivo() {
  if (CONFIG.MODO === 'demo') return 'demo';
  if (CONFIG.MODO === 'supabase') return 'supabase';
  return CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY ? 'supabase' : 'demo';
}

export const EH_DEMO = modoAtivo() === 'demo';

/** O e-mail está num domínio liberado? Devolve null se sim, ou o motivo. */
export function problemaComEmail(email) {
  const limpo = String(email ?? '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) return 'Digite um e-mail válido.';
  const ok = CONFIG.DOMINIOS_PERMITIDOS.some((d) => limpo.endsWith(`@${d}`));
  if (!ok) {
    return `Use seu e-mail da Serena: ${CONFIG.DOMINIOS_PERMITIDOS.map((d) => `@${d}`).join(' ou ')}.`;
  }
  return null;
}

export function ehTerceirizado(email) {
  return String(email ?? '').toLowerCase().endsWith(`@${CONFIG.DOMINIO_TERCEIRIZADO}`);
}
