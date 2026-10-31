# site

The public website: plain HTML, CSS and JavaScript with no build step. `.github/workflows/pages.yml`
deploys this folder. Guide: [docs/website.md](../docs/website.md).

- Every claim must be true. Test counts and the "Not claimed" list go stale, so check
  them against `docs/development-handoff.md` when you change them.
- The break-it animation scripts documented behaviour. Change it only to match the
  guide each scenario links to.
- Commands in the project picker must match `cli/src`.
- Fonts are self-hosted, and no third-party scripts or analytics are loaded.
- Check real screenshots at desktop and phone widths and with reduced motion.
- Preview with `node site/serve.mjs`.
