# New computer setup

One script installs everything and clones every `sakredapp` repo into `~/code`.

| Machine | Run |
|---|---|
| **Windows** (PowerShell as Admin) | `Set-ExecutionPolicy -Scope Process Bypass -Force; iwr https://raw.githubusercontent.com/sakredapp/virtualcloser/main/scripts/setup/setup-windows.ps1 -UseBasicParsing \| iex` |
| **Linux / WSL** | `curl -fsSL https://raw.githubusercontent.com/sakredapp/virtualcloser/main/scripts/setup/setup-linux.sh \| bash` |

Installs: Git, GitHub CLI, VS Code (+ Claude Code, ESLint, Prettier, Tailwind, Playwright, Vitest, GitLens, Supabase extensions), Node 22, Python 3.12, Chrome, Claude Code CLI, Vercel CLI, Supabase CLI, Stripe CLI, tsx, pm2, Playwright + Chromium.

Then it: sets your git identity, logs into GitHub in the browser, makes an SSH key (add it to the Hetzner worker for `hetzner-worker/`), clones all repos, runs `npm ci`, and pulls `.env.local` from Vercel.

Afterward, sign in once: `supabase login`, `stripe login`, `claude`.

**Letting Claude drive your browser / screen:** that's not Playwright. Install the Claude desktop app (claude.ai/download) for computer use, and the Claude in Chrome extension for browser control. Playwright is for automated tests and scripted browsing.
