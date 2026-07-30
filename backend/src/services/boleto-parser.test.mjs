/**
 * Testes do parser de boletos. Rode com:  node src/services/boleto-parser.test.mjs
 * Não precisa de nenhuma biblioteca de teste.
 */
import p from '../../../frontend/js/boleto-parser.js';

let passou = 0;
let falhou = 0;

function ok(nome, condicao, extra = '') {
  if (condicao) {
    passou++;
    console.log(`  \x1b[32m✓\x1b[0m ${nome}`);
  } else {
    falhou++;
    console.log(`  \x1b[31m✗\x1b[0m ${nome} ${extra}`);
  }
}

const HOJE = new Date('2026-07-29T00:00:00Z');

console.log('\nPar oficial FEBRABAN/Banco do Brasil');
{
  const LD = '00190500954014481606906809350314337370000000100';
  const CB = '00193373700000001000500940144816060680935031';
  const r = p.interpretarCodigo(LD, HOJE);
  ok('dígito verificador fecha', r.dvValido);
  ok('linha 47 -> código 44 confere', r.codigoBarras === CB, r.codigoBarras);
  ok('código 44 -> linha 47 confere', p.codigo44ParaLinha47(CB) === LD);
  ok('valor lido do código = R$ 1,00', r.valor === 1, String(r.valor));
  ok('banco identificado = 001', r.banco === '001');
  ok('aceita entrada pelo código de barras', p.interpretarCodigo(CB, HOJE).dvValido);
  ok('formatação da linha digitável', r.linhaDigitavelFormatada.startsWith('00190.50095 '));
}

console.log('\nDetecção de adulteração');
{
  const LD = '00190500954014481606906809350314337370000000100';
  for (const pos of [0, 12, 25, 40, 46]) {
    const trocado = String((Number(LD[pos]) + 1) % 10);
    const adulterado = LD.slice(0, pos) + trocado + LD.slice(pos + 1);
    ok(`rejeita dígito alterado na posição ${pos}`, !p.interpretarCodigo(adulterado, HOJE).dvValido);
  }
}

console.log('\nFator de vencimento (âncoras conhecidas)');
{
  ok('fator 9999 = 21/02/2025 (fim do 1º ciclo)', p.paraISODate(p.fatorVencimentoParaData(9999, HOJE)) === '2025-02-21');
  const d1000 = p.fatorVencimentoDetalhado(1000, HOJE);
  ok('fator 1000 resolve para o ciclo 2 (22/02/2025)', p.paraISODate(d1000.data) === '2025-02-22');
  ok('fator inválido devolve null', p.fatorVencimentoParaData('0000', HOJE) === null);
}

console.log('\nBoleto moderno (vencimento próximo, sem ambiguidade)');
{
  // Monta um boleto válido do zero: fator + valor + campo livre.
  const fator = 1520; // ~julho/2026 no ciclo 2
  const valorCentavos = String(Math.round(4250.0 * 100)).padStart(10, '0');
  const semDV = '341' + '9' + String(fator).padStart(4, '0') + valorCentavos + '1234567890123456789012345';
  const dv = p.modulo11Cobranca(semDV);
  const CB = semDV.slice(0, 4) + dv + semDV.slice(4);
  const LD = p.codigo44ParaLinha47(CB);
  const r = p.interpretarCodigo(LD, HOJE);
  ok('boleto sintético tem 44 dígitos', CB.length === 44);
  ok('linha digitável gerada tem 47 dígitos', LD.length === 47);
  ok('DV geral fecha', r.dvValido, JSON.stringify(r.avisos));
  ok('valor = 4250.00', r.valor === 4250, String(r.valor));
  ok('vencimento sem ambiguidade', r.vencimentoAmbiguo === false, r.vencimento);
  ok('vencimento em 2026', String(r.vencimento).startsWith('2026'), r.vencimento);
}

console.log('\nExtração a partir de texto sujo (simula PDF/OCR)');
{
  const textoPdf = [
    'BANCO DO BRASIL S.A.   001-9',
    'Local de pagamento: Pagável em qualquer banco',
    'Beneficiário: FORNECEDOR EXEMPLO LTDA   CNPJ 33.111.222/0001-44',
    '00190.50095  40144.816069  06809.350314  3  37370000000100',
    'Vencimento 15/01/2008     Valor do documento R$ 1,00',
  ].join('\n');
  const r = p.extrairDadosDeTexto(textoPdf, HOJE);
  ok('encontrou o código de barras no meio do texto', r.codigoBarras === '00193373700000001000500940144816060680935031');
  ok('confiança alta (DV fechou)', r.confianca === 'alta', r.confianca);
  ok('valor extraído', r.valor === 1, String(r.valor));
}

console.log('\nTexto sem código de barras legível');
{
  const r = p.extrairDadosDeTexto('Fatura de serviços\nVencimento 12/08/2026\nVALOR R$ 3.480,55', HOJE);
  ok('cai para leitura por texto', r.confianca === 'media', r.confianca);
  ok('achou o valor no texto', r.valor === 3480.55, String(r.valor));
  ok('achou o vencimento no texto', r.vencimento === '2026-08-12', String(r.vencimento));
  ok('não inventou código de barras', r.codigoBarras === null);
}

console.log('\nGuia de arrecadação (48 dígitos, começa com 8)');
{
  // Monta uma guia válida: 8 + segmento + id valor (6 = módulo 10) + DV + valor(11) + livre
  // 43 dígitos sem o DV: produto(1) + segmento(1) + idValor(1) + valor(11)
  //                      + empresa(4) + campo livre(25)
  const semDV = '8' + '3' + '6' + '00000348055' + '1234' + '5678901234567890123456789';
  const dv = p.modulo10(semDV);
  const CB = semDV.slice(0, 3) + dv + semDV.slice(3);
  ok('código de arrecadação tem 44 dígitos', CB.length === 44, String(CB.length));
  const LD = p.codigo44ParaLinha48(CB);
  ok('linha digitável de arrecadação tem 48 dígitos', LD.length === 48, String(LD.length));
  const r = p.interpretarCodigo(LD, HOJE);
  ok('tipo identificado como arrecadação', r.tipo === 'arrecadacao');
  ok('valor de arrecadação = 3480.55', r.valor === 3480.55, String(r.valor));
  ok('avisa que não há vencimento no código', r.vencimento === null && r.avisos.some((a) => a.includes('arrecada')));
}

console.log('\nEntradas inválidas não quebram o parser');
{
  for (const entrada of ['', null, undefined, 'abc', '123', '9'.repeat(60), 0]) {
    const r = p.interpretarCodigo(entrada, HOJE);
    ok(`entrada ${JSON.stringify(entrada)} devolve resultado seguro`, r && r.ok === false);
  }
}

console.log(`\n${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou === 0 ? 0 : 1);
