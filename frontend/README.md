# Octave Frontend

Octave's Next.js frontend provides music prediction markets using virtual Music Notes.

## Run locally

Install Node.js 24 with npm. From this `frontend/` directory, run:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop the server with Ctrl+C. For later sessions, run `npm run dev`; repeat `npm ci` when dependencies change. Edits to the UI reload automatically.

## What you can test

- Browse demo markets and open a market's chart and prediction panel.
- Search songs and artists, filter categories, and sort markets.
- Save markets with the star button and view them in Watchlist. Selections last for the current page session.
- Choose UP or DOWN and enter Music Notes to preview potential payouts.

Demo prices and charts are illustrative. Orders are not submitted and no Music Notes are spent. These UI features do not require the backend, PostgreSQL, or Python ingestion.

## Signup and login

The account dialog uses Firebase authentication and then verifies the session through the Go backend. Start the backend separately on port 8080 with Firebase Admin credentials configured. Without it, Firebase authentication may succeed while backend verification fails.

See the [root README's frontend instructions](../README.md#frontend) for the PowerShell credentials setup and backend requirements. Keep service-account keys outside the repository.

## Checks

Run from `frontend/`:

```bash
npm run lint
npm run build
npm test
```
