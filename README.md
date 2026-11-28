# Octave

Octave is a music prediction market developed by Team OneShot for UF CEN3031.

Users trade UP and DOWN contracts (or STAY and DOWN at #1) with virtual Music Notes based on weekly Billboard Hot 100 movement.

## Team

- Luis Andre Blanco — Scrum Master and Developer
- Jovon Alexis — Developer
- Jack Harris — Project Manager
- Michael Kroner — Developer

## Stack and Structure

- `frontend/` — Next.js, React, and TypeScript
- `backend/` — Go REST API and PostgreSQL migrations
- `ingestion/` — Python Billboard chart fetching, validation, and database storage
- `.github/workflows/` — GitHub Actions CI
- PostgreSQL 17 — application database

## Setup

Install Git, Node.js 24 with npm, Python 3.13, and the Go version in `backend/go.mod`. Use either Docker or a local PostgreSQL 17 installation.

```bash
git clone https://github.com/Mikey1332/SWE_semester_project.git
cd SWE_semester_project
```

### Database

**Docker:**

```bash
docker volume create octave-db-data
docker run -d --name octave-db -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=postgres -v octave-db-data:/var/lib/postgresql/data postgres:17
```

**macOS with Homebrew:**

```bash
brew install postgresql@17
brew services start postgresql@17
"$(brew --prefix postgresql@17)/bin/psql" -d postgres -c "CREATE ROLE postgres WITH LOGIN PASSWORD 'postgres';"
"$(brew --prefix postgresql@17)/bin/psql" -d postgres -c "GRANT USAGE, CREATE ON SCHEMA public TO postgres;"
```

Set `DATABASE_URL` in each terminal running the backend or ingestion:

```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable'
```

### Backend

```bash
cd backend
go mod download
go run .
```

Migrations run automatically on startup when `DATABASE_URL` is set. Open `http://localhost:8080/health` to verify `{"status":"ok"}`. Optionally set `LIQUIDITY_BOT_USER_ID` to enable the countertrade bot.

No Firebase service-account key is needed: the backend verifies Firebase ID tokens using the project ID and Google's public signing keys. First sign-in creates a user with 10,000 Music Notes.

Database tests require a separate database whose name includes `test` via `TEST_DATABASE_URL` (distinct from `DATABASE_URL`); otherwise DB tests are skipped:

```bash
export TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/music_trader_test?sslmode=disable'
cd backend
go vet ./...
go test ./...
```

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000`. The Next.js dev server proxies `/api/*` to `http://localhost:8080`.

```bash
cd frontend
npm run lint
npm run build
npm test
```

### Python Ingestion

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r ingestion/requirements.txt
python -m pip install flake8 pytest
python -m ingestion.run_ingestion
```

Checks from the repository root:

```bash
python -m pytest ingestion/tests/
python -m flake8 ingestion/ --select=E9,F63,F7,F82
```

`ingestion/billboard_fixed.py` is a modified copy of `billboard.py` (`ingestion/BILLBOARD_LICENSE`).

## Market Rules

- New users start with 10,000 Music Notes.
- Each week, markets open for the latest Hot 100 asking whether each song will move UP or DOWN on the next chart (at #1: STAY or DOWN).
- Limit orders are priced from 1 to 99 Music Notes and match by price-time priority across same-side buy/sell and complementary YES/NO orders (`yes + no = 100`).
- Open buy orders reserve their maximum cost and open sell orders reserve their contracts; cancelling releases reservations.
- When the next Hot 100 chart is ingested, winning contracts pay 100 Music Notes; unchanged ranks 2–100 refund remaining cost basis (at #1, STAY wins); songs dropping off the chart count as rank 101.
- Add schema changes as new numbered files in `backend/migrations/`; never edit already-applied migrations.
