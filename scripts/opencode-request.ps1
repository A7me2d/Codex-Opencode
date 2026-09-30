param(
  [Parameter(Mandatory = $true)]
  [string]$EncodedRequest
)

$ErrorActionPreference = 'Stop'

try {
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedRequest))
  $request = $json | ConvertFrom-Json
  $method = [string]$request.method
  $path = [string]$request.path

  if ($method -notin @('GET', 'POST')) {
    throw 'Unsupported OpenCode API method.'
  }

  if (-not $path.StartsWith('/api/')) {
    throw 'Invalid OpenCode API path.'
  }

  $arguments = @('api', $method, $path)
  if ($null -ne $request.body) {
    $body = $request.body | ConvertTo-Json -Depth 50 -Compress
    $arguments += @('--data', $body)
  }

  & opencode @arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
