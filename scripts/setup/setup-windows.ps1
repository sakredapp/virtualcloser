# New-machine dev setup for Windows (VirtualCloser / Suite CXO / Sakred).
# Run in PowerShell *as Administrator*:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   iwr https://raw.githubusercontent.com/sakredapp/virtualcloser/main/scripts/setup/setup-windows.ps1 -UseBasicParsing | iex
# Safe to re-run: winget skips anything already installed.

$ErrorActionPreference = 'Continue'

function Install-App($id) {
  Write-Host "==> $id" -ForegroundColor Cyan
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
}

# Core tools (winget = Windows' Homebrew)
@(
  'Git.Git',
  'GitHub.cli',
  'Microsoft.VisualStudioCode',
  'OpenJS.NodeJS.LTS',        # Node 22 LTS + npm
  'Python.Python.3.12',
  'Google.Chrome',
  'Stripe.StripeCli',
  'Microsoft.WindowsTerminal',
  'Microsoft.PowerShell'
) | ForEach-Object { Install-App $_ }

# Pick up PATH changes from the installs above
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# Global CLIs
Write-Host "==> npm global CLIs" -ForegroundColor Cyan
npm install -g @anthropic-ai/claude-code vercel supabase tsx pm2

# Playwright browsers (for local browser automation / tests)
Write-Host "==> Playwright + Chromium" -ForegroundColor Cyan
npx -y playwright install --with-deps chromium

# VS Code extensions
Write-Host "==> VS Code extensions" -ForegroundColor Cyan
@(
  'anthropic.claude-code',
  'dbaeumer.vscode-eslint',
  'esbenp.prettier-vscode',
  'bradlc.vscode-tailwindcss',
  'ms-playwright.playwright',
  'vitest.explorer',
  'github.vscode-pull-request-github',
  'eamodio.gitlens',
  'supabase.vscode-supabase-extension',
  'ms-vscode-remote.remote-wsl'
) | ForEach-Object { code --install-extension $_ --force }

# Git identity
if (-not (git config --global user.email)) {
  $name  = Read-Host 'Git name'
  $email = Read-Host 'Git email'
  git config --global user.name  $name
  git config --global user.email $email
}
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global core.autocrlf input   # keep LF line endings in repos

# GitHub login (browser flow) - also sets git credentials
gh auth status 2>$null; if ($LASTEXITCODE -ne 0) { gh auth login --hostname github.com --git-protocol https --web }
gh auth setup-git

# SSH key (needed for the Hetzner worker box)
$key = "$HOME\.ssh\id_ed25519"
if (-not (Test-Path $key)) {
  New-Item -ItemType Directory -Force "$HOME\.ssh" | Out-Null
  ssh-keygen -t ed25519 -C (git config --global user.email) -f $key   # press Enter twice for no passphrase
  gh ssh-key add "$key.pub" --title "$env:COMPUTERNAME"
  Write-Host "Add this public key to the Hetzner box's ~/.ssh/authorized_keys:" -ForegroundColor Yellow
  Get-Content "$key.pub"
}

# Clone every sakredapp repo into ~\code
$code = "$HOME\code"
New-Item -ItemType Directory -Force $code | Out-Null
Set-Location $code
gh repo list sakredapp --limit 200 --json name -q '.[].name' | ForEach-Object {
  if (-not (Test-Path $_)) { gh repo clone "sakredapp/$_" } else { Write-Host "skip $_ (exists)" }
}

# Install deps for VirtualCloser
if (Test-Path "$code\virtualcloser") {
  Set-Location "$code\virtualcloser"
  npm ci
  if (-not (Test-Path .env.local)) {
    vercel login
    vercel link --yes
    vercel env pull .env.local   # pulls dev env vars from Vercel
  }
}

Write-Host "`nDone. Open with:  code $code\virtualcloser   then run: npm run dev" -ForegroundColor Green
Write-Host "Also log in to: supabase login | stripe login | claude (first run)" -ForegroundColor Green
