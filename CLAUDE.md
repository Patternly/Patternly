# Patternly — read this first

Start every session by reading `docs/HANDOVER.md`: it is the living handover (what Patternly is, where everything is registered, code map, backend routes and secret NAMES, native app state, features, working rules, recent changes, open items).

Non-negotiable rules (full list in the handover):

1. **RULE #1 – never break account-linked sync.** Before every push, grep `index.html` for `trkProgressUrl` (4 lines), `trkCloudProjects` (4), `trkUserPatternUrl` (8) and `pl_session` (27 occurrences) and compare with the previous commit.
2. One fix per build. Bump `PATTERNLY_BUILD` (editor), `MW_VERSION` (middleware) or the Studio `vNN` comment every time; never reuse a version number.
3. Every editor build: `node --check` all inline script blocks, copy `index.html` to `patternly-app/www/index.html`, commit both repos, push to `main`.
4. **Update `docs/HANDOVER.md` in the same commit as every build**: version numbers, a row in "Recent changes", tick/add "Open items". Do not leave this for a separate handover.
5. Never print secrets or PA-/PK-/PU-/ST- key values; secrets are set by Cristian directly in Cloudflare / GitHub.
6. Fixes must be general (root cause), modern UI only, dark mode checked.
7. Commit as `-c user.name="Cristian" -c user.email="lucasukinfo@gmail.com"` with the Claude attribution trailer.
