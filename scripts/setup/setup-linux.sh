#!/usr/bin/env bash
# New-machine dev setup for Linux or WSL (Ubuntu/Debian) - VirtualCloser / Suite CXO / Sakred.
#   curl -fsSL https://raw.githubusercontent.com/sakredapp/virtualcloser/main/scripts/setup/setup-linux.sh | bash
# Uses real Homebrew (Linuxbrew). Safe to re-run.
set -uo pipefail

sudo apt-get update
sudo apt-get install -y build-essential procps curl file git openssh-client

# Homebrew
if ! command -v brew >/dev/null; then
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
fi
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

brew install git gh node@22 python@3.12 jq supabase/tap/supabase stripe/stripe-cli/stripe
brew link --overwrite --force node@22

npm install -g @anthropic-ai/claude-code vercel tsx pm2
npx -y playwright install --with-deps chromium

# VS Code: on WSL, use the Windows VS Code + "WSL" extension instead (run `code .` from WSL).
if ! grep -qi microsoft /proc/version && ! command -v code >/dev/null; then
  sudo snap install code --classic || echo "Install VS Code manually: https://code.visualstudio.com"
fi
if command -v code >/dev/null; then
  for ext in anthropic.claude-code dbaeumer.vscode-eslint esbenp.prettier-vscode bradlc.vscode-tailwindcss \
             ms-playwright.playwright vitest.explorer github.vscode-pull-request-github eamodio.gitlens \
             supabase.vscode-supabase-extension; do
    code --install-extension "$ext" --force
  done
fi

git config --global user.name  >/dev/null || { read -rp "Git name: " n; git config --global user.name "$n"; }
git config --global user.email >/dev/null || { read -rp "Git email: " e; git config --global user.email "$e"; }
git config --global init.defaultBranch main
git config --global pull.rebase false

gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git

if [ ! -f ~/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -C "$(git config --global user.email)" -f ~/.ssh/id_ed25519 -N ""
  gh ssh-key add ~/.ssh/id_ed25519.pub --title "$(hostname)"
  echo "Add this public key to the Hetzner box's ~/.ssh/authorized_keys:"; cat ~/.ssh/id_ed25519.pub
fi

mkdir -p ~/code && cd ~/code
for r in $(gh repo list sakredapp --limit 200 --json name -q '.[].name'); do
  [ -d "$r" ] && echo "skip $r (exists)" || gh repo clone "sakredapp/$r"
done

if [ -d ~/code/virtualcloser ]; then
  cd ~/code/virtualcloser && npm ci
  [ -f .env.local ] || { vercel login && vercel link --yes && vercel env pull .env.local; }
fi

echo; echo "Done. Open with: code ~/code/virtualcloser  then: npm run dev"
echo "Also log in to: supabase login | stripe login | claude (first run)"
