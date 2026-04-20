param([int]$Port = 2026, [switch]$KeepServer)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$REPO  = "C:\Users\ULTRAPC\Documents\GitHub\graph-doc-ingestion"
$BASE  = "http://localhost:$Port"
$GRAPH = "docIngestion"
$PASS  = 0
$FAIL  = 0

function Write-Pass { param([string]$n) Write-Host "  [PASS] $n" -ForegroundColor Green; $script:PASS++ }
function Write-Fail { param([string]$n,[string]$d) Write-Host "  [FAIL] $n -- $d" -ForegroundColor Red; $script:FAIL++ }

function Wait-ServerReady {
  param([string]$url,[int]$max=60)
  $dl = (Get-Date).AddSeconds($max)
  while ((Get-Date) -lt $dl) {
    try { $r = Invoke-RestMethod "$url/ok" -TimeoutSec 2 -ErrorAction Stop; if ($r.ok -eq $true) { return $true } } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Invoke-GraphRun {
  param([hashtable]$graphInput,[int]$timeout=120)
  $t = Invoke-RestMethod "$BASE/threads" -Method POST -ContentType "application/json" -Body "{}" -TimeoutSec 10
  $b = @{ assistant_id=$GRAPH; input=$graphInput } | ConvertTo-Json -Depth 8
  return Invoke-RestMethod "$BASE/threads/$($t.thread_id)/runs/wait" -Method POST -ContentType "application/json" -Body $b -TimeoutSec $timeout
}

Write-Host ""
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  graph-doc-ingestion -- LangGraph API Integration Tests" -ForegroundColor Cyan
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Starting langgraph dev on port $Port..." -ForegroundColor DarkGray
Write-Host "  (Xenova embeddings -- no LLM calls required)" -ForegroundColor DarkGray

$serverJob = Start-Job -ScriptBlock {
  param($repo,$port)
  Set-Location $repo
  npx @langchain/langgraph-cli dev --port $port --no-browser 2>&1
} -ArgumentList $REPO,$Port

if (-not (Wait-ServerReady $BASE)) {
  Write-Host "  [ERROR] Server failed to start" -ForegroundColor Red
  Stop-Job $serverJob -PassThru | Remove-Job -Force
  exit 1
}
Write-Host "  Server ready" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Running tests..." -ForegroundColor DarkGray
Write-Host ""

# Test 1: Plain text ingest -- full pipeline runs and reaches final phase
try {
  $r = Invoke-GraphRun -graphInput @{
    rawContent="LangGraph is a framework for building stateful multi-actor LLM applications. It extends LangChain with graph-based orchestration enabling complex workflows with cycles conditionals and human-in-the-loop."
    clientId="integ-test"
    docType="article"
    mode="local"
  }
  $vc = if ($r.vectorIds) { $r.vectorIds.Count } else { 0 }
  $did = if ($r.docId) { $r.docId } else { "" }
  if ($r.phase -eq "register-dynamodb" -and $vc -gt 0 -and $did.Length -gt 0) {
    Write-Pass "1. Plain text ingest -- phase=$($r.phase) vectorIds=$vc docId=$did"
  } else {
    Write-Fail "1. Plain text ingest" "phase=$($r.phase) vectorIds=$vc docId=$did"
  }
} catch { Write-Fail "1. Plain text ingest" $_.Exception.Message }

# Test 2: Sentence chunking strategy produces multiple vectors
try {
  $r = Invoke-GraphRun -graphInput @{
    rawContent="GPT-5 is OpenAI latest model. It supports function calling. It features a 128k context window. Structured output is supported natively. Reasoning tokens are used internally."
    clientId="integ-test"
    docType="markdown"
    chunkingStrategy="sentence"
    mode="local"
  }
  $vc = if ($r.vectorIds) { $r.vectorIds.Count } else { 0 }
  if ($r.phase -eq "register-dynamodb" -and $vc -gt 0) {
    Write-Pass "2. Sentence chunking -- phase=$($r.phase) vectorIds=$vc"
  } else {
    Write-Fail "2. Sentence chunking" "phase=$($r.phase) vectorIds=$vc"
  }
} catch { Write-Fail "2. Sentence chunking" $_.Exception.Message }

# Test 3: Full 6-node pipeline -- assert all 6 phases completed by checking final phase
try {
  $r = Invoke-GraphRun -graphInput @{
    rawContent="Retrieval-Augmented Generation combines large language models with external knowledge bases. A vector store indexes document embeddings. At query time the closest chunks are retrieved and injected into the prompt as context."
    clientId="integ-test"
    docType="technical"
    mode="local"
  }
  $vc = if ($r.vectorIds) { $r.vectorIds.Count } else { 0 }
  $did = if ($r.docId) { $r.docId } else { "" }
  if ($r.phase -eq "register-dynamodb" -and $vc -gt 0 -and $did.Length -gt 0) {
    Write-Pass "3. Full 6-node pipeline -- phase=$($r.phase) vectorIds=$vc docId=$did"
  } else {
    Write-Fail "3. Full 6-node pipeline" "phase=$($r.phase) vectorIds=$vc docId=$did"
  }
} catch { Write-Fail "3. Full 6-node pipeline" $_.Exception.Message }

# Test 4: Different docType -- verify docId is unique per run
try {
  $r1 = Invoke-GraphRun -graphInput @{ rawContent="AI agents perceive environment make decisions take actions."; clientId="integ-test"; docType="definition"; mode="local" }
  $r2 = Invoke-GraphRun -graphInput @{ rawContent="Machine learning models learn patterns from training data."; clientId="integ-test"; docType="definition"; mode="local" }
  $id1 = if ($r1.docId) { $r1.docId } else { "" }
  $id2 = if ($r2.docId) { $r2.docId } else { "" }
  if ($id1.Length -gt 0 -and $id2.Length -gt 0 -and $id1 -ne $id2) {
    Write-Pass "4. Unique docIds per run -- docId1=$id1 docId2=$id2"
  } else {
    Write-Fail "4. Unique docIds per run" "id1=$id1 id2=$id2"
  }
} catch { Write-Fail "4. Unique docIds per run" $_.Exception.Message }

Write-Host ""
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
$color = if ($FAIL -eq 0) { "Green" } else { "Red" }
Write-Host ("  Results: {0}/{1} passed" -f $PASS,($PASS+$FAIL)) -ForegroundColor $color
Write-Host "-----------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

if (-not $KeepServer) {
  Stop-Job $serverJob -PassThru | Remove-Job -Force 2>$null
  Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
exit $(if ($FAIL -eq 0) { 0 } else { 1 })