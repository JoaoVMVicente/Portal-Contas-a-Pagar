<#
===============================================================================
 atualizar.ps1 — Troca o projeto pela versão de um zip novo, com segurança.
===============================================================================

 POR QUE ESTE SCRIPT EXISTE
 --------------------------
 Trocar o projeto por uma versão nova parece simples, mas tem duas armadilhas
 que já mordemos:

   1. O Windows, ao colar uma pasta sobre outra, SUBSTITUI os arquivos iguais,
      ACRESCENTA os novos e NUNCA REMOVE os que sumiram. Resultado: arquivos de
      versões antigas ficam no meio dos novos. Foi assim que o
      "07_seed_unidades.sql" sobreviveu e deu erro no Supabase, procurando uma
      tabela que já não existia.

   2. No repositório, o "git add" a partir da raiz JÁ registra as remoções
      (isso mudou no git 2.0; versões antigas ignoravam). Mas "git add -A"
      funciona de qualquer subpasta, então é o que usamos aqui — é o mesmo
      resultado com uma armadilha a menos.

 Este script apaga tudo (menos o .git e ele mesmo), extrai o zip novo, devolve
 a sua chave do Supabase para o config.js, e mostra o que mudou ANTES de
 qualquer commit. Nada é enviado sem você confirmar.

 COMO USAR
 ---------
   Abra o PowerShell na pasta do repositório e rode:

     .\atualizar.ps1 -Zip "$HOME\Downloads\portal-boletos-serena.zip"

   Na primeira vez, guarde sua chave do Supabase num arquivo, uma vez só:

     "sb_publishable_SUA_CHAVE_INTEIRA" | Set-Content "$HOME\serena-chave.txt"

   Daí em diante o script devolve a chave sozinho a cada atualização.

 O QUE ELE NÃO FAZ
 -----------------
   - Não faz commit nem push sem você confirmar.
   - Não apaga a pasta .git, então o histórico do repositório é preservado
     e não precisa de "push --force".
   - Não toca em backend/.env (ele nem vem no zip).
===============================================================================
#>

[CmdletBinding()]
param(
  # O zip baixado.
  [Parameter(Mandatory = $true)]
  [string]$Zip,

  # Arquivo com a sua chave do Supabase (uma linha, só a chave).
  [string]$ArquivoDaChave = "$HOME\serena-chave.txt",

  # Passa direto pelo commit e push, sem perguntar. Use só quando já confiar.
  [switch]$SemPerguntar
)

$ErrorActionPreference = 'Stop'

function Passo    ($t) { Write-Host ""; Write-Host ">> $t" -ForegroundColor Cyan }
function Ok       ($t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso    ($t) { Write-Host "   $t" -ForegroundColor Yellow }
function Problema ($t) { Write-Host "   $t" -ForegroundColor Red }

# ---------------------------------------------------------------------------
# 0. Conferir onde estamos
# ---------------------------------------------------------------------------
Passo "Conferindo a pasta"

if (-not (Test-Path ".git")) {
  Problema "Esta pasta não é um repositório git."
  Write-Host ""
  Write-Host "   Rode o script DENTRO da pasta do repositório, aquela que tem a"
  Write-Host "   pasta .git. Se você ainda não clonou, faça primeiro:"
  Write-Host ""
  Write-Host "     git clone https://github.com/JoaoVMVicente/Portal-Contas-a-Pagar.git"
  Write-Host "     cd Portal-Contas-a-Pagar"
  Write-Host ""
  exit 1
}

if (-not (Test-Path $Zip)) {
  Problema "Não achei o zip em: $Zip"
  exit 1
}

$pasta = (Get-Location).Path
Ok "Repositório: $pasta"
Ok "Zip:         $Zip"

# Mudança não salva seria perdida. Melhor parar e avisar.
$pendente = git status --porcelain
if ($pendente -and -not $SemPerguntar) {
  Passo "Atenção: existem mudanças não salvas neste repositório"
  git status --short
  Write-Host ""
  $r = Read-Host "   Elas serão PERDIDAS. Continuar? (digite SIM)"
  if ($r -ne 'SIM') { Aviso "Cancelado. Nada foi alterado."; exit 0 }
}

# ---------------------------------------------------------------------------
# 1. Guardar a chave do Supabase que já está no config.js
# ---------------------------------------------------------------------------
Passo "Guardando a chave do Supabase"

$chave = $null
$configAtual = "frontend\js\config.js"

if (Test-Path $configAtual) {
  $linha = Select-String -Path $configAtual -Pattern "SUPABASE_ANON_KEY:\s*'([^']+)'" |
           Select-Object -First 1
  if ($linha) {
    $achada = $linha.Matches[0].Groups[1].Value
    if ($achada -and $achada -notmatch '\.\.\.$') {
      $chave = $achada
      Ok "Chave encontrada no config.js atual."
    }
    elseif ($achada -match '\.\.\.$') {
      Aviso "A chave do config.js atual está CORTADA (termina em '...'). Vou ignorar."
    }
  }
}

if (-not $chave -and (Test-Path $ArquivoDaChave)) {
  $doArquivo = (Get-Content $ArquivoDaChave -Raw).Trim()
  if ($doArquivo -and $doArquivo -notmatch '\.\.\.$') {
    $chave = $doArquivo
    Ok "Chave lida de $ArquivoDaChave"
  }
}

if (-not $chave) {
  Aviso "Não achei sua chave. Depois da atualização você precisa colar à mão em"
  Aviso "frontend\js\config.js, ou salvar num arquivo para as próximas vezes:"
  Aviso "  `"sb_publishable_...`" | Set-Content `"$ArquivoDaChave`""
}
else {
  # Guarda para as próximas vezes, se ainda não estava guardada.
  if (-not (Test-Path $ArquivoDaChave)) {
    $chave | Set-Content $ArquivoDaChave -NoNewline
    Ok "Chave guardada em $ArquivoDaChave para as próximas atualizações."
  }
}

# ---------------------------------------------------------------------------
# 2. Extrair o zip num lugar temporário
# ---------------------------------------------------------------------------
Passo "Abrindo o zip"

$temp = Join-Path $env:TEMP ("serena-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $temp | Out-Null

try {
  Expand-Archive -Path $Zip -DestinationPath $temp -Force

  # O zip tem uma pasta raiz (portal-boletos-serena). Achamos ela.
  $raiz = Get-ChildItem $temp -Directory | Select-Object -First 1
  $origem = if ($raiz -and (Test-Path (Join-Path $raiz.FullName "frontend"))) { $raiz.FullName } else { $temp }

  if (-not (Test-Path (Join-Path $origem "frontend"))) {
    Problema "Este zip não parece ser o do portal: não achei a pasta 'frontend' dentro."
    exit 1
  }
  Ok "Conteúdo do zip localizado."

  # -------------------------------------------------------------------------
  # 3. Apagar o conteúdo antigo (menos .git e este script)
  # -------------------------------------------------------------------------
  Passo "Removendo a versão antiga"

  $preservar = @('.git', 'atualizar.ps1')
  $removidos = 0
  Get-ChildItem -Force | Where-Object { $preservar -notcontains $_.Name } | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
    $removidos++
  }
  Ok "$removidos item(ns) da raiz removido(s). O .git foi preservado."

  # -------------------------------------------------------------------------
  # 4. Copiar a versão nova
  # -------------------------------------------------------------------------
  Passo "Instalando a versão nova"

  Copy-Item -Path (Join-Path $origem "*") -Destination $pasta -Recurse -Force
  Ok "Arquivos copiados."
}
finally {
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
}

# ---------------------------------------------------------------------------
# 5. Devolver a chave
# ---------------------------------------------------------------------------
Passo "Devolvendo a chave do Supabase"

if ($chave) {
  $conteudo = Get-Content $configAtual -Raw
  $conteudo = $conteudo -replace "SUPABASE_ANON_KEY:\s*''", "SUPABASE_ANON_KEY: '$chave'"
  Set-Content -Path $configAtual -Value $conteudo -NoNewline
  Ok "Chave recolocada no config.js."
}
else {
  Aviso "Sem chave: o portal vai abrir em MODO DEMONSTRAÇÃO até você colar."
}

# ---------------------------------------------------------------------------
# 6. Conferências
# ---------------------------------------------------------------------------
Passo "Conferindo o resultado"

$problemas = 0

# Sobrou algo de versão antiga?
$antigos = Get-ChildItem -Recurse -Force -ErrorAction SilentlyContinue `
             -Include '07_seed_unidades.sql', 'unidades.js', 'unidades-negocio.json'
if ($antigos) {
  Problema "Sobraram arquivos de versão antiga:"
  $antigos | ForEach-Object { Write-Host "     $($_.FullName)" }
  $problemas++
} else {
  Ok "Nenhum arquivo de versão antiga."
}

# Duplicata do front-end na raiz?
if ((Test-Path "index.html") -or (Test-Path "js") -or (Test-Path "paginas")) {
  Problema "Existe cópia do front-end na RAIZ (index.html / js / paginas)."
  Problema "O portal deve ficar só em frontend\. Confira o que aconteceu."
  $problemas++
} else {
  Ok "Estrutura correta: o portal está só em frontend\."
}

# A chave está inteira?
if (Select-String -Path $configAtual -Pattern "SUPABASE_ANON_KEY:\s*'[^']*\.\.\.'" -Quiet) {
  Problema "A chave no config.js está CORTADA (termina em '...')."
  Problema "Copie pelo BOTÃO DE COPIAR do painel do Supabase, não com o mouse."
  $problemas++
} elseif (Select-String -Path $configAtual -Pattern "SUPABASE_ANON_KEY:\s*''" -Quiet) {
  Aviso "O config.js está sem chave. O portal abrirá em modo demonstração."
} else {
  Ok "Chave presente e aparentemente completa."
}

# A chave secreta não pode estar rastreada
$envRastreado = git ls-files backend/.env
if ($envRastreado) {
  Problema "ATENÇÃO: backend/.env está rastreado pelo git. Isso não pode ir para o GitHub."
  $problemas++
} else {
  Ok "backend\.env não está rastreado pelo git."
}

# ---------------------------------------------------------------------------
# 7. O que mudou
# ---------------------------------------------------------------------------
Passo "O que mudou no repositório"

git add -A          # -A pega a árvore inteira, inclusive remoções, de qualquer pasta
git status --short

$resumo = git diff --cached --stat | Select-Object -Last 1
Write-Host ""
Write-Host "   $resumo"

if ($problemas -gt 0) {
  Write-Host ""
  Problema "$problemas problema(s) encontrado(s) acima. Resolva antes de subir."
  Aviso "Nada foi enviado. As mudanças estão preparadas (git add já foi feito)."
  exit 1
}

# ---------------------------------------------------------------------------
# 8. Commit e push
# ---------------------------------------------------------------------------
Passo "Enviar para o GitHub"

if (-not $SemPerguntar) {
  Write-Host "   Revise a lista acima. Um 'D' na frente do nome significa arquivo removido."
  Write-Host ""
  $r = Read-Host "   Fazer commit e push? (digite SIM)"
  if ($r -ne 'SIM') {
    Aviso "Parado antes do commit. As mudanças estão preparadas."
    Aviso "Para enviar depois:  git commit -m 'Atualizacao' ; git push"
    exit 0
  }
}

$mensagem = "Atualizacao do portal - " + (Get-Date -Format 'dd/MM/yyyy HH:mm')
git commit -m $mensagem
git push

Write-Host ""
Ok "Enviado."
Write-Host ""
Write-Host "   Para testar local:" -ForegroundColor Cyan
Write-Host "     cd frontend"
Write-Host "     npx serve -l 8081"
Write-Host ""
