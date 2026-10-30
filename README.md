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

Tests for the database use a separate PostgreSQL db, otherwise test data is added to our actual application's db. To run tests, set TEST_DATABASE_URL to a db whose name includes `test`. If you don't then the  tests get skipped. Also the test URL needs to be different from the real DATABASE_URL.

Checks from `backend/`:

```bash
go vet ./...
go test ./...
```


### Frontend

To test just the UI, you only need Node.js 24 and npm. You can skip the database, backend, and Python ingestion setup above.

From the repository root (these commands also work in PowerShell):

```bash
cd frontend
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop with Ctrl+C. For later sessions, run `npm run dev` from `frontend/`; repeat `npm ci` when dependencies change. The page reloads automatically as you edit UI files.

The Discover page lists the bots' real open markets from `GET /markets` as cards: chance of YES, the song's recent Hot 100 rank (sparkline and "spots last week"), contracts traded, and closing time, with search, Rising / Falling / New entries filters, sorting and a watchlist (kept for the current page session). Opening a market shows its rank history and rules and an order panel where signed-in users submit YES/NO buy or sell limit orders, see their pending orders, and cancel them. The header shows the signed-in user's balance, and **My ledger** lists their buys, sells and payouts.

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
python -m ingestion.run_ingestion
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

- New users receive 10,000 Music Notes on their first Firebase sign-in, through `UserForFirebase`.
- Balance changes use `Post` to update balances and append ledger entries within a transaction.
- Overdrafts are rejected; `user_pnl` excludes grants from realized P&L.
- Add schema changes as new numbered files in `backend/migrations/`; do not edit applied migrations.

## Status

Project scaffolding, CI, the database schema, the Music Note ledger, and manual Hot 100 ingestion are implemented. Parser/storage test coverage and automatic weekly ingestion are still in progress. Genre charts are deferred.

### Music Note ledger and limit orders

The first Firebase sign-in creates a ledger account with 10,000 Music Notes. `GET /auth/me` returns the account balance, realized P&L and open positions. `GET /me/ledger` returns grants, fills, payouts and refunds.

A market asks whether a song will move UP or DOWN on its chart date. At rank 1 the choices are STAY and DOWN. The API stores UP/STAY as `yes` and DOWN as `no`. These are the only side mappings. The bot's prices are initial estimates; they are not guaranteed execution prices. The bot creates markets but does not currently place orders, so an order waits until another user supplies a match.

`POST /markets/{id}/orders` accepts a signed-in user's order. For example:

```json
{"request_id":"a-unique-request-id","side":"yes","action":"buy","price":50,"quantity":10}
```

The ID must be unique per user. Retry the same request with the same ID to avoid placing it twice. Changing the details while reusing the ID returns 409. The app saves an unfinished request in the browser and shows a Retry button if the response is interrupted. Retry uses the original order and ID, including after a page reload. Successful and rejected requests are removed from the saved list. Saved requests belong to that browser and are not transferred to another device. Prices are whole Music Notes from 1 to 99. A buy price is the maximum the user will pay; a sell price is the minimum they will accept. The response includes `quantity` and `remaining`. A nonzero `remaining` means the rest is waiting to fill.

The engine chooses the best eligible price, then the oldest order at that price. A buy can match a sell for the same side, or a buy on the opposite side when their prices add up to at least 100. Opposite-side sell orders can also match when their prices add up to at most 100. Users cannot match their own orders. The older order receives its limit price. Both fills, balance and position updates, and the trade record commit together.

Open buy orders reserve their maximum cost, and sell orders reserve their remaining contracts. A user's displayed balance is their total balance; some of it may be reserved. `GET /me/orders` lists their open orders. `POST /orders/{id}/cancel` cancels their own open order and releases its reservation. Expired orders do not reserve funds, and settlement cancels remaining orders in that market.

The backend uses a PostgreSQL transaction lock to serialize order placement, cancellation and settlement. It prevents competing trades from spending the same funds or contracts. It also limits concurrent throughput; the lock strategy should be revisited if actual load requires it. Contract ownership, ledger entries and trade records are stored in PostgreSQL.

The bots run every 15 minutes to open markets and settle markets whose full Hot 100 chart has been ingested. A winning contract pays 100 notes. An absent song counts as rank 101. Migrations run automatically at backend startup. Add new numbered files to `backend/migrations/`; do not edit a migration that has already been applied.

For ranks 2-100, an unchanged rank refunds each current holder's remaining position cost. Earlier sales remain final. At rank 1, an unchanged rank pays the STAY side 100 notes per contract. Actual refund ledger entries show Refunded; historical buys and sells do not claim to have received a refund.

Migration 006 requires a database with no existing markets, because existing orders must retain their original rules. Keep the previous database and use a new development database:

```bash
createdb -h localhost -U jack octave_direction_dev
export DATABASE_URL='postgres://jack@localhost:5432/octave_direction_dev?sslmode=disable'
```

Run the backend to apply migrations, import the chart with the ingestion instructions above, then restart the backend to generate markets immediately. Before switching databases, reconcile unfinished browser requests against the original backend and close other Octave tabs. Remove the localhost app's saved `octave-order-*` localStorage entries using browser developer tools; their market IDs belong to the previous database. Do not retry them against the new database.

A previously reported frontend ESLint dependency vulnerability remains under review.
