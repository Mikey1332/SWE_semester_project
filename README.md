# Music Trader

Music Trader is a gamified music prediction market developed by Team OneShot for UF CEN3031.

Users trade UP and DOWN contracts with virtual currency called Music Notes based on weekly Billboard chart movement. Planned features include user accounts, trading, portfolios, leaderboards, and automated chart-data ingestion.

## Team

- Luis Andre Blanco — Scrum Master and Developer
- Jovon Alexis — Developer
- Jack Harris — Project Manager
- Michael Kroner — Developer

## Stack and Structure

- `frontend/` — Next.js, React, and TypeScript
- `backend/` — Go REST API
- `ingestion/` — Python chart-data ingestion
- `.github/workflows/` — GitHub Actions CI
- PostgreSQL — planned database

## Setup

Install Git, Node.js 24 with npm, Python 3.13, the Go version specified in `backend/go.mod`, and Docker (for PostgreSQL).

```bash
git clone https://github.com/Mikey1332/SWE_semester_project.git
cd SWE_semester_project
```

Run each section below from the repository root.

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. Stop with Ctrl+C.

Checks from `frontend/`:

```bash
npm run lint
npm run build
npm test
```

### Backend

Start PostgreSQL and point the backend at it. Migrations run automatically on startup. Without `DATABASE_URL` the server still starts, and the database tests are skipped.

```bash
docker run -d --name music-trader-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"
```

In PowerShell, set the variable with `$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"`.

```bash
cd backend
go mod download
go vet ./...
go test ./...
go run .
```

Open http://localhost:8080/health; expect `{"status":"ok"}`. Stop with Ctrl+C.

### Python Ingestion

On macOS/Linux:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install flake8 pytest
python -m pip install -r ingestion/requirements.txt
python -m pytest ingestion/tests/
flake8 ingestion/ --select=E9,F63,F7,F82
```

On Windows, create the environment with `py -3.13 -m venv .venv` and activate it in PowerShell with `.\.venv\Scripts\Activate.ps1`. Then run the same installation and check commands.

Add Python dependencies to `ingestion/requirements.txt`.

## Contributing

1. Create a feature branch from an up-to-date `main`.
2. Make changes, add relevant tests, and run checks.
3. Push and open a pull request targeting `main`.
4. Obtain an approving teammate review and pass required checks before merging.

CI runs frontend lint/build/tests, Go build/vet/tests, and Python lint/tests on pull requests targeting `main` and pushes to `main`.

Commit source, tests, dependency manifests/lockfiles, and configuration. Do not commit virtual environments, installed dependencies, build output, IDE settings, or credentials.

## Status

Initial scaffolding, CI workflows, basic tests, the PostgreSQL schema, and the Music Note ledger are implemented. Feature development and ingestion execution are in progress.

### Music Note ledger

- New users receive a 10,000 Music Note `grant` (`CreateUser` in `backend/db.go`).
- Every balance change goes through `Post`, which updates `balances` and appends to `ledger_entries` in the caller's transaction, and rejects overdrafts.
- Markets are Kalshi-style YES/NO questions created by the bots: "Will this song move at least `shift` spots from `baseline_rank` on the chart dated `chart_date`?" The bot sets `yes_price` (1–99); NO costs `100 - yes_price`.
- `Buy` sells contracts from the house at that price until the market's `closes_at` (Monday before the chart date, midnight New York time). Users hold them until `Resolve` reads the chart, pays 100 notes per winning contract, and closes every position in the market. A song missing from an ingested chart counts as rank 101.
- The bots (`backend/bots.go`) run inside the server every 15 minutes. They resolve every open market whose chart is in `chart_snapshots`, then open next week's market for each song on the latest chart. `suggest` picks each song's shift from its latest direction and typical move size, and prices YES by how often the song has made that move before. Ingestion only needs to insert `chart_snapshots` rows (`song_id`, `chart_date`, `rank`), creating `songs` as needed. A chart counts as loaded only once all 100 ranks are in, so nothing settles on a partial chart.
- The `user_pnl` view reports realized P&L, excluding grants; money in open positions is not counted as a loss until the market resolves.
- `GET /users/{id}/balance` returns `{"balance": ..., "realized_pnl": ...}`.
- `POST /markets/{id}/buy` with `{"side": "yes" | "no", "quantity": n}` returns `{"balance": ...}`. It returns 401 until auth replaces `currentUser` in `backend/main.go`.
- Add schema changes as new numbered files in `backend/migrations/`; never edit an applied migration.

A reported frontend ESLint dependency vulnerability remains under review.