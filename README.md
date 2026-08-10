# Workout PWA

A mobile-first, offline-capable push/pull gym tracker. Workout data stays in
the browser's IndexedDB database; this repository contains no user workout
records.

## Use the hosted app

After GitHub Pages is enabled with **GitHub Actions** as its source, the app is
available at:

<https://ahlgrenpersonal.github.io/gym/>

On iPhone, open that address in Safari, tap **Share**, then **Add to Home
Screen**.

## Run locally

Requires Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

## Verify and build

```bash
pnpm test
pnpm lint
pnpm build
```

The production build uses `/gym/` as its base path for GitHub Pages. The
service worker caches the app shell for offline use without storing workout
records in the cache.

## Data safety

- Each completed set is stored locally with its entered weight, rep count,
  epoch timestamp, and local ISO datetime.
- A workout resumes on the same local calendar day. Unfinished workouts are
  archived at the next local midnight and remain available in History.
- JSON backup and CSV export are available in Settings.
- Replacing a phone, clearing Safari website data, or removing the installed
  PWA may remove local IndexedDB data, so export backups regularly.
