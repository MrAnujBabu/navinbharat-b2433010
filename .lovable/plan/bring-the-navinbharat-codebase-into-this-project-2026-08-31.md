# Bring the Navinbharat codebase into this project

Goal: make this Lovable project hold your existing Navinbharat app code so you can keep editing it here, link the GitHub repo connector, and point the app at your existing Supabase backend.

## Important caveat (read first)

This project currently runs Lovable's modern stack (TanStack Start). Your uploaded app is a classic Vite single-page app using React Router, Tailwind v3, Capacitor and an Express dev server. The two cannot coexist — installing your code means replacing the template entirely.

Consequences to accept before I start:
- The Lovable preview here expects the TanStack dev server. After the swap the app runs as a plain Vite SPA; preview and publish behaviour may be degraded or broken, and Lovable's built-in Cloud tooling will not manage the backend.
- Capacitor/native builds, Playwright e2e, and the custom `node server/index.js` dev script will not run inside this environment.
- Roughly 700 source files plus ~5 MB of generated `.html`/`.txt` artifacts are in the archive; I will skip the artifacts and other junk.

If you'd rather keep your repo as the single source of truth, the safer route is to edit it in the GitHub repo / locally and use Lovable only for the pieces that fit this stack. Say the word and I'll stop after step 2.

## Steps

1. **Extract and audit the archive** — unpack `Navinbharat-main.zip` to a temp folder, confirm no `.git` metadata is copied, and list what gets excluded (`about.html`, `channel.html`, `videos.html`, `api33.txt`, `api35.txt`, `secondary.txt`, `node_modules`, build output, `boilerplate/`).

2. **Connect GitHub** — link the GitHub API connector to `MrAnujBabu/Navinbharat` so I can read repo files, commits and issues while we work. Note: two-way code sync to that repo is set up by you in the Lovable UI (+ menu > GitHub), not by me.

3. **Replace the project source** — copy the app files (`src/`, `public/`, `index.html`, `server/`, `scripts/`, config files, `supabase/`) into the project root, removing the TanStack template files (`src/routes/`, `src/router.tsx`, `src/start.ts`, `src/server.ts`, `src/styles.css`).

4. **Reconcile tooling** — merge `package.json` dependencies and scripts, install with bun, and adjust `vite.config.ts` so the dev server binds the port the Lovable preview uses. Drop or stub scripts that cannot run here (native/Capacitor guards, prebuild/postbuild checks).

5. **Point at your Supabase project** — wire `VITE_SUPABASE_URL` and the publishable key through project settings so the existing database and auth work unchanged. I'll ask you for those two values when we get there; no service keys go into the code.

6. **Boot and fix** — run the dev server, work through import/build errors until the app renders, and report anything that genuinely cannot run in this environment.

## Technical notes

- Nothing under `.git` will ever be copied into the project.
- Tailwind v3 config (`tailwind.config.ts` + `postcss.config.js`) replaces this project's Tailwind v4 `styles.css` setup.
- The Supabase URL and anon/publishable key are safe in client code; only secret keys go to the secret store.
