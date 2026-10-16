<#
  tools/serve.ps1 — zero-dependency static file server for local preview.

  Exists because this machine has no Node, npm or Python, so there is no
  `vite preview` / `python -m http.server` to fall back on. PowerShell 5.1 ships
  with Windows and System.Net.HttpListener needs no install and no admin rights
  on loopback prefixes.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 4173 -Root .

  Behaviour:
    * serves the directory containing this script's parent (the project root)
    * resolves directory indexes:  /projects/  ->  /projects/index.html
    * redirects extension-less paths to a trailing slash so relative links
      resolve the same way a real static host would:  /projects -> /projects/
    * serves 404.html with a 404 status for anything missing
    * refuses path traversal outside the root
#>
[CmdletBinding()]
param(
  [int]$Port = 4173,
  [string]$Root = "",
  [int]$PortAttempts = 12
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $Root = (Resolve-Path $Root).Path
}
$Root = $Root.TrimEnd('\', '/')

$Mime = @{
  ".html"        = "text/html; charset=utf-8"
  ".htm"         = "text/html; charset=utf-8"
  ".css"         = "text/css; charset=utf-8"
  ".js"          = "text/javascript; charset=utf-8"
  ".mjs"         = "text/javascript; charset=utf-8"
  ".json"        = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg"         = "image/svg+xml"
  ".png"         = "image/png"
  ".jpg"         = "image/jpeg"
  ".jpeg"        = "image/jpeg"
  ".webp"        = "image/webp"
  ".avif"        = "image/avif"
  ".gif"         = "image/gif"
  ".ico"         = "image/x-icon"
  ".woff2"       = "font/woff2"
  ".woff"        = "font/woff"
  ".ttf"         = "font/ttf"
  ".otf"         = "font/otf"
  ".txt"         = "text/plain; charset=utf-8"
  ".xml"         = "application/xml; charset=utf-8"
  ".pdf"         = "application/pdf"
  ".map"         = "application/json; charset=utf-8"
}

function New-BoundListener {
  param([int]$StartPort, [int]$Attempts)

  for ($i = 0; $i -lt $Attempts; $i++) {
    $port = $StartPort + $i
    # localhost first: an HttpListener prefix containing "localhost" is one of
    # the few that a non-elevated process is allowed to register.
    # NOTE: $host is a read-only automatic variable in PowerShell — do not use it here.
    foreach ($bindHost in @("localhost", "127.0.0.1")) {
      $prefix = "http://{0}:{1}/" -f $bindHost, $port
      $listener = $null
      try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add($prefix)
        $listener.Start()
        return @{ Listener = $listener; Prefix = $prefix; Port = $port }
      } catch {
        if ($listener -ne $null) {
          try { $listener.Close() } catch { }
        }
      }
    }
  }
  return $null
}

$bound = New-BoundListener -StartPort $Port -Attempts $PortAttempts
if ($bound -eq $null) {
  [Console]::Error.WriteLine("serve.ps1: could not bind any port in range $Port..$($Port + $PortAttempts - 1)")
  exit 1
}

$listener = $bound.Listener
$baseUrl = $bound.Prefix.TrimEnd('/')

Write-Host "serve.ps1: root    $Root"
Write-Host "serve.ps1: pid     $PID"
Write-Host "serve.ps1: READY   $baseUrl/"
[Console]::Out.Flush()

function Send-Bytes {
  param($Context, [int]$Status, [byte[]]$Bytes, [string]$ContentType, [string]$ExtraHeader)

  $res = $Context.Response
  $res.StatusCode = $Status
  $res.ContentType = $ContentType
  $res.Headers["Cache-Control"] = "no-store, must-revalidate"
  $res.Headers["X-Content-Type-Options"] = "nosniff"
  if ($ExtraHeader) { $res.Headers["Location"] = $ExtraHeader }
  $res.ContentLength64 = $Bytes.Length
  if ($Context.Request.HttpMethod -ne "HEAD" -and $Bytes.Length -gt 0) {
    try {
      $res.OutputStream.Write($Bytes, 0, $Bytes.Length)
    } catch {
      # client hung up mid-response; not interesting
    }
  }
  try { $res.OutputStream.Close() } catch { }
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)

    $status = 200
    $target = $null
    $redirect = $null

    # --- resolve the request path to a file under $Root -------------------
    $relative = $path.TrimStart('/')
    if ($relative -eq "") { $relative = "index.html" }

    $candidate = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))

    # traversal guard
    if (-not $candidate.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $candidate = $null
    }

    if ($candidate -ne $null -and (Test-Path -LiteralPath $candidate -PathType Container)) {
      if (-not $path.EndsWith("/")) {
        $redirect = $path + "/"
      } else {
        $index = Join-Path $candidate "index.html"
        if (Test-Path -LiteralPath $index -PathType Leaf) {
          $target = $index
        } else {
          $status = 404
        }
      }
    } elseif ($candidate -ne $null -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      $target = $candidate
    } else {
      # extension-less clean url pointing at a directory?
      if ($candidate -ne $null) {
        $withIndex = Join-Path $candidate "index.html"
        if (Test-Path -LiteralPath $withIndex -PathType Leaf) {
          $redirect = $path + "/"
        } else {
          $status = 404
        }
      } else {
        $status = 404
      }
    }

    if ($redirect -ne $null) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("Moved: $redirect")
      Send-Bytes -Context $context -Status 301 -Bytes $body -ContentType "text/plain; charset=utf-8" -ExtraHeader $redirect
      Write-Host ("301 {0}" -f $path)
      continue
    }

    if ($status -eq 404) {
      $notFound = Join-Path $Root "404.html"
      if (Test-Path -LiteralPath $notFound -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($notFound)
      } else {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      }
      Send-Bytes -Context $context -Status 404 -Bytes $bytes -ContentType "text/html; charset=utf-8"
      Write-Host ("404 {0}" -f $path)
      continue
    }

    $ext = [System.IO.Path]::GetExtension($target).ToLowerInvariant()
    $ctype = $Mime[$ext]
    if (-not $ctype) { $ctype = "application/octet-stream" }

    $bytes = [System.IO.File]::ReadAllBytes($target)
    Send-Bytes -Context $context -Status 200 -Bytes $bytes -ContentType $ctype
    Write-Host ("200 {0}" -f $path)
  }
} catch {
  Write-Host ("serve.ps1: loop ended: {0}" -f $_.Exception.Message)
} finally {
  try { $listener.Close() } catch { }
}
