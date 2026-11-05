param(
  [Parameter(Mandatory = $true)][string]$InDir,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Max = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($op, $type) {
  $asTask = $asTaskGeneric.MakeGenericMethod($type)
  $netTask = $asTask.Invoke($null, @($op))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$lang = [Windows.Globalization.Language]::new('zh-Hans-CN')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if (-not $engine) { throw 'no zh-Hans OCR engine' }

$files = Get-ChildItem -Path $InDir -Filter *.jpg | Sort-Object Name
if ($Max -gt 0) { $files = $files | Select-Object -First $Max }
$sw = [Diagnostics.Stopwatch]::StartNew()
$n = 0
foreach ($f in $files) {
  $n++
  $outPath = Join-Path $OutDir ($f.BaseName + '.txt')
  if (Test-Path $outPath) { continue }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($f.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $res.Lines) { $lines += $line.Text }
  [System.IO.File]::WriteAllText($outPath, ($lines -join "`n"), [System.Text.UTF8Encoding]::new($false))
  $bmp.Dispose()
  $stream.Dispose()
  if ($n % 10 -eq 0) { Write-Host ("  {0}/{1}  {2:N1}s" -f $n, $files.Count, $sw.Elapsed.TotalSeconds) }
}
Write-Host ("done {0} pages in {1:N1}s" -f $files.Count, $sw.Elapsed.TotalSeconds)
