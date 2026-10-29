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

**One-time reset after the ledger merge:** `001_init.sql` was rewritten for the YES/NO market ledger, so a database created before that merge keeps the old schema (migrations never re-run). Recreate it once, then rerun the two setup commands above; reload chart data with the ingestion script afterwards:

```bash
docker rm -f octave-db
docker volume rm octave-db-data
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

The Discover page lists the bots' real open markets from `GET /markets` as cards: chance of YES, the song's recent Hot 100 rank (sparkline and "spots last week"), contracts traded, and closing time, with search, Rising / Falling / New entries filters, sorting and a watchlist (kept for the current page session). Opening a market shows its rank history and rules and an order panel where signed-in users buy or sell YES/NO contracts with Music Notes. The header shows the signed-in user's balance, and **My ledger** lists their buys, sells and payouts.

**Testing signup and login:** Firebase handles account creation and sign-in, and the frontend then calls `/api/auth/me`, which the Go backend at `http://localhost:8080` answers after verifying the Firebase token. Run the backend in a separate terminal with `DATABASE_URL` set (see Backend above):

```powershell
cd backend
go run .
```

The backend does not read `.env` files; set `DATABASE_URL` in the same terminal before `go run .`. If it is missing, `/api/auth/me` returns 503 "database not configured" even though Firebase signed you in.

No Firebase credentials or service-account key are needed: the backend only verifies sign-in tokens, which uses the project ID and Google's public signing keys. The first successful sign-in creates the user's ledger account with 10,000 Music Notes; `/api/auth/me` returns `{"user_id", "uid", "email", "balance", "realized_pnl"}`.

Without `DATABASE_URL` the backend still starts, but `/api/auth/me` and buying return 401/503 because sign-in creates a ledger account. If it is set, the configured database must be reachable.

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

## Running the Tests

The test cases in the Module 9 software test sheet (T1–T21) map to the automated tests below. Commands are shown for PowerShell; on macOS/Linux use `export DATABASE_URL=...` instead of `$env:DATABASE_URL = ...`.

### 1. Test database

Go tests that need PostgreSQL use a separate database, because they leave test users and markets behind. Create (or reset) it once per session:

```powershell
docker start octave-db
docker exec octave-db psql -U postgres -c "DROP DATABASE IF EXISTS music_trader_test" -c "CREATE DATABASE music_trader_test"
```

### 2. Backend (Go)

From `backend/`:

```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/music_trader_test?sslmode=disable"
go test -v -count=1 ./...
```

Every test should print `--- PASS` and the run should end with `ok`. `--- SKIP ... DATABASE_URL not set` means the variable is missing in that terminal. Use `127.0.0.1` rather than `localhost` on Windows, where `localhost` can reach WSL's relay instead of Docker. Run one test with `-run`, for example `go test -v -count=1 -run TestT17 ./...`; `-run` takes a pattern, so `-run "TestT1[0-9]"` runs T10–T19.

| Sheet | Go test |
|---|---|
| T3 | `TestBuy2500RecordedInLedger` |
| T4 | `TestT4PortfolioGainAndLoss` |
| T9 | `TestUserForFirebase`, `TestAuthMe` |
| T10 | `TestT10SellFiveContracts` |
| T11 | `TestT11MarketGenres` |
| T12 | `TestT12WeeklyGrant` |
| T13 | `TestBuyAndResolve`, `TestBotsOpenAndResolve` |
| T14 | `TestBuyAndResolve` |
| T15 | `TestT15LeaderboardPeriods` |
| T16 | `TestT16BotsRunOnStart` |
| T17 | `TestT17FailedSettlementDoesNotStopOthers` |
| T18 | `TestT18ManyUsersTradeAtOnce` |
| T19, T20 | `TestT19T20GroupsAndGroupLeaderboard` |

### 3. Ingestion (Python)

From the repository root, with the virtual environment activated (`.\.venv\Scripts\Activate.ps1`):

```powershell
python -m pytest ingestion/tests/ -v
```

Run one test with `-k`, for example `python -m pytest ingestion/tests/ -v -k test_valid_snapshot`.

| Sheet | Python test |
|---|---|
| T2 | `test_song_is_valid` |
| T6 | `test_valid_snapshot` |
| T7 | `test_negative_rank_is_invalid` |
| T8 | `test_snapshot_with_wrong_date_format` |

### 4. Frontend (Vitest)

From `frontend/`:

```powershell
npm test
```

| Sheet | Frontend test |
|---|---|
| T11 | "genre filter shows only songs on that genre's chart" (`tests/trading.test.ts`) |
| T21 | both tests in `tests/tutorial.test.ts` |

### 5. Manual checks

Run the app against the real database (`postgres`, not `music_trader_test`) in two terminals:

```powershell
# Terminal 1, in backend/
$env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/postgres?sslmode=disable"
go run .
# Terminal 2, in frontend/
npm run dev
```

| Sheet | Steps | Expected |
|---|---|---|
| T16 (log) | Watch terminal 1 as it starts. With no chart loaded, run `python -m ingestion.run_ingestion` from the repository root (same `DATABASE_URL`), then restart `go run .`. | `Database migrated`, then `bots: opened N markets from the ... chart` |
| T1 | Open http://localhost:3000, click **Get started**, sign up, log out, then **Log in**. | Signed in with your name in the header; a wrong password shows an error |
| T9 (UI) | Right after signing up. | Header shows **♫ 10,000** |
| T21 (UI) | After signing in, click **Next** through the walkthrough to **Finish**, then reload. | All five steps show, and it does not reappear. To repeat it, run `localStorage.removeItem("octave-tutorial-done")` in the browser console. |

T5 (bot fills bids within a price range) needs order matching, which is in progress on the `order_matching` branch.

When filling in the sheet, put the observed outcome in **Actual Result** (for example "balance 10,100, P&L +100"), Pass or Fail in **Status**, and the test name in **Comments**.

## Contributing

1. Create a feature branch from an up-to-date `main`.
2. Make changes, add relevant tests, and run checks.
3. Push and open a pull request targeting `main`.
4. Obtain an approving teammate review and pass required checks before merging.

CI runs frontend lint/build/tests, Go build/vet/tests, and Python lint/tests. Go database tests use a temporary PostgreSQL database; it does not store application data permanently.

Commit source, tests, dependency manifests/lockfiles, and configuration. Do not commit virtual environments, installed dependencies, build output, IDE settings, or private credentials.

## Database and Ledger

- New users receive 10,000 Music Notes on their first Firebase sign-in, through `UserForFirebase`.
- Balance changes use `Post` to update balances and append ledger entries within a transaction.
- Overdrafts are rejected; `user_pnl` excludes grants from realized P&L.
- Add schema changes as new numbered files in `backend/migrations/`; do not edit applied migrations.

## Status

Project scaffolding, CI, the database schema, the Music Note ledger, and manual Hot 100 ingestion are implemented. Parser/storage test coverage and automatic weekly ingestion are still in progress. Genre charts are deferred.

### Music Note ledger

- A user's first Firebase sign-in creates their ledger account with a 10,000 Music Note `grant` (`UserForFirebase` in `backend/db.go`). Later or concurrent sign-ins never grant twice.
- Every balance change goes through `Post`, which updates `balances` and appends to `ledger_entries` in the caller's transaction, and rejects overdrafts.
- Markets are Kalshi-style YES/NO questions created by the bots: "Will this song move at least `shift` spots from `baseline_rank` on the chart dated `chart_date`?" The bot sets `yes_price` (1–99); NO costs `100 - yes_price`.
- `Buy` sells contracts from the house at that price until the market's `closes_at` (Monday before the chart date, midnight New York time). Users can sell contracts back at the current price (`Sell`) until `closes_at`, or hold them until `Resolve` reads the chart, pays 100 notes per winning contract, and closes every position in the market. A song missing from an ingested chart counts as rank 101.
- The bots (`backend/bots.go`) run inside the server every 15 minutes. They resolve every open market whose chart is in `chart_snapshots`, then open next week's market for each song on the latest chart. `suggest` picks each song's shift from its latest direction and typical move size, and prices YES by how often the song has made that move before. Ingestion only needs to insert `chart_snapshots` rows (`song_id`, `chart_date`, `rank`), creating `songs` as needed. A chart counts as loaded only once all 100 ranks are in, so nothing settles on a partial chart.
- The `user_pnl` view reports realized P&L, excluding grants; money in open positions is not counted as a loss until the market resolves.
- `GET /auth/me` (signed in) returns `{"user_id", "uid", "email", "balance", "realized_pnl", "positions"}`, where each position is `{"market_id", "side", "quantity", "cost_basis"}`.
- `GET /markets` (public) lists markets still open for trading: `id`, `title`, `artist`, `chart_date`, `baseline_rank`, `shift`, `yes_price`, `no_price`, `closes_at`, `volume` (contracts bought) and `history` (the song's last 10 Hot 100 ranks, oldest first).
- `POST /markets/{id}/buy` with `{"side": "yes" | "no", "quantity": n}` returns `{"balance": ...}` for the signed-in user (`Authorization: Bearer <Firebase ID token>`), or 401 without a valid token.
- `POST /markets/{id}/sell` takes the same body and sells held contracts back at the current price; selling more than you hold returns 409. The sold share of the cost basis leaves with them, so realized P&L moves by proceeds minus that cost.
- `GET /me/ledger` (signed in) returns the user's ledger, newest first: each grant, buy, sell and payout with `amount`, `balance_after`, the contracts it moved (`side`, `quantity`, `price`; empty for grants and for trades made before migration 004) and its market (`title`, `artist`, `chart_date`, `shift`, `market_status`, `outcome`). The **My ledger** tab in the frontend shows it with All / Bought / Sold / Payouts filters and a Won / Lost / Open result per entry.
- Add schema changes as new numbered files in `backend/migrations/`; never edit an applied migration.

A previously reported frontend ESLint dependency vulnerability remains under review.
