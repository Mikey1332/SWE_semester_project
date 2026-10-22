# Octave

Octave is a gamified music prediction market developed by Team OneShot for UF CEN3031.

Users trade UP and DOWN contracts with virtual currency called Music Notes based on weekly Billboard chart movement. Planned features include accounts, trading, portfolios, leaderboards, and automatic chart-data updates.

## Team

- Luis Andre Blanco — Scrum Master and Developer
- Jovon Alexis — Developer
- Jack Harris — Project Manager
- Michael Kroner — Developer

## Stack and Structure

- `frontend/` — Next.js, React, and TypeScript
- `backend/` — Go REST API and PostgreSQL migrations
- `ingestion/` — Python Billboard fetching, validation, and database storage
- `.github/workflows/` — GitHub Actions CI
- PostgreSQL 17 — application database

## Setup

Install Git, Node.js 24 with npm, Python 3.13, and the Go version specified in `backend/go.mod`. Use either Docker or a local PostgreSQL 17 installation.

```bash
git clone https://github.com/Mikey1332/SWE_semester_project.git
cd SWE_semester_project
```

Start each section from the repository root. Terminal commands below use macOS/Linux syntax unless noted.

### Database

Choose one option. Do not run both on the same port.

**Docker:**

```bash
docker volume create octave-db-data
docker run -d --name octave-db -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=postgres -v octave-db-data:/var/lib/postgresql/data postgres:17
```

Wait until PostgreSQL is ready. For later sessions, start the existing container with:

```bash
docker start octave-db
```

**macOS with Homebrew:**

```bash
brew install postgresql@17
brew services start postgresql@17
```

On a fresh installation, create the development login and grant permission to create tables. Run these once:

```bash
"$(brew --prefix postgresql@17)/bin/psql" -d postgres -c "CREATE ROLE postgres WITH LOGIN PASSWORD 'postgres';"
"$(brew --prefix postgresql@17)/bin/psql" -d postgres -c "GRANT USAGE, CREATE ON SCHEMA public TO postgres;"
```

For either option, set the connection in each terminal that runs the backend or ingestion:

```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable'
```

In PowerShell:

```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"
```

These credentials are for local development. For a shared or hosted database, use the team's connection settings instead.

### Backend

```bash
cd backend
go mod download
go run .
```

With `DATABASE_URL` set, migrations run automatically on startup. Run this before the first ingestion to create the tables.

Open http://localhost:8080/health; expect `{"status":"ok"}`. Stop with Ctrl+C.

Checks from `backend/`:

```bash
go vet ./...
go test ./...
```

Without `DATABASE_URL`, the server skips database setup and database tests are skipped. The health endpoint alone does not verify the database connection.

### Frontend

To test just the UI, you only need Node.js 24 and npm. You can skip the database, backend, and Python ingestion setup above.

From the repository root (these commands also work in PowerShell):

```bash
cd frontend
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop with Ctrl+C. For later sessions, run `npm run dev` from `frontend/`; repeat `npm ci` when dependencies change. The page reloads automatically as you edit UI files.

The UI includes demo markets, search, category filters, sorting, a watchlist, and UP/DOWN prediction previews. Watchlist selections last for the current page session. Market prices and charts are illustrative; predictions do not submit orders or spend Music Notes.

**Testing signup and login:** Firebase handles account creation and sign-in, and the frontend then calls `/api/auth/me` to verify the session with the Go backend at `http://localhost:8080`. Run the backend in a separate terminal for this verification to succeed. Configure Firebase Admin credentials before starting it:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\firebase-service-account.json"
cd backend
go run .
```

Run these commands from the repository root in the second terminal, after downloading Go dependencies as described above. Use a service-account JSON key for the team's Firebase project, obtained through Firebase Project settings > Service accounts. Store it outside the repository and never commit it. The environment variable must be set in the same terminal that runs the backend. Without credentials, startup fails with `google: could not find default credentials`.

PostgreSQL is optional for authentication-only testing: when `DATABASE_URL` is unset, the backend skips database setup. If it is set, the configured database must be reachable.

Checks from `frontend/`:

```bash
npm run lint
npm run build
npm test
```

### Python Ingestion

Create and activate an environment:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
```

On Windows, use `py -3.13 -m venv .venv` and activate in PowerShell with `.\.venv\Scripts\Activate.ps1`.

Install dependencies and testing tools:

```bash
python -m pip install -r ingestion/requirements.txt
python -m pip install flake8 pytest
```

With PostgreSQL running, migrations applied, and `DATABASE_URL` set, run:

```bash
python -m ingestion.main
```

This fetches the Hot 100, validates it, and saves songs and dated rankings to PostgreSQL. Repeating an unchanged snapshot does not create duplicate snapshot entries.

Checks from the repository root:

```bash
python -m pytest ingestion/tests/
python -m flake8 ingestion/ --select=E9,F63,F7,F82
```

Add Python dependencies to `ingestion/requirements.txt`.

`ingestion/billboard_fixed.py` is a modified copy of the unofficial `billboard.py` library with a metadata parser fix. Original attribution and license are retained in the source and `ingestion/BILLBOARD_LICENSE`.

## Contributing

1. Create a feature branch from an up-to-date `main`.
2. Make changes, add relevant tests, and run checks.
3. Push and open a pull request targeting `main`.
4. Obtain an approving teammate review and pass required checks before merging.

CI runs frontend lint/build/tests, Go build/vet/tests, and Python lint/tests. Go database tests use a temporary PostgreSQL database; it does not store application data permanently.

Commit source, tests, dependency manifests/lockfiles, and configuration. Do not commit virtual environments, installed dependencies, build output, IDE settings, or private credentials.

## Database and Ledger

- New users receive 10,000 Music Notes through `CreateUser`.
- Balance changes use `Post` to update balances and append ledger entries within a transaction.
- Overdrafts are rejected; `user_pnl` excludes grants from realized P&L.
- Add schema changes as new numbered files in `backend/migrations/`; do not edit applied migrations.

## Status

Project scaffolding, CI, the database schema, the Music Note ledger, and manual Hot 100 ingestion are implemented. Parser/storage test coverage and automatic weekly ingestion are still in progress. Genre charts are deferred.

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

A previously reported frontend ESLint dependency vulnerability remains under review.
