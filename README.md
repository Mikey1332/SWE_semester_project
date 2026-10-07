# Music Trader

Music Trader is a gamified music prediction market developed by Team OneShot for CEN3031: Introduction to Software Engineering at the University of Florida.

Users trade UP and DOWN contracts using virtual currency called Music Notes based on predicted weekly Billboard chart movement. Users can apply their music knowledge, track performance, and compete with friends without risking real money.

## Team Members

- Luis Andre Blanco — Scrum Master, and Developer
- Jovon Alexis — Developer
- Jack Harris — Project Manager
- Michael Kroner — Developer

## Planned Features

- Registration, login, logout, profiles, and trader/admin roles
- Weekly Billboard song markets with UP/DOWN contracts
- Virtual Music Note balances and buying/selling positions
- Automated trading bots and fallback market-making
- Active/past positions, realized profit-and-loss, and win-loss records
- Weekly, monthly, all-time, and friends-only leaderboards
- Weekly champions
- Billboard data ingestion, song information, and artwork

## Technology Stack

Not all planned tools are installed or integrated yet.

- **Languages:** Go for backend/trading; Python for ingestion, initial pricing, and potential reinforcement-learning bots; TypeScript for frontend
- **Frontend:** Next.js, React, Tailwind CSS, and shadcn/ui
- **Visualization:** TradingView Lightweight Charts and Visx or Recharts
- **Data fetching/tables:** TanStack Query and TanStack Table
- **Database:** PostgreSQL for users, songs, charts, markets, orders, trades, positions, balances, and leaderboards
- **Optional infrastructure:** Redis for caching/live data/sessions; TigerBeetle for an immutable ledger
- **Data sources:** Billboard charts; Spotify or Apple Music APIs for metadata/artwork if needed

## Development Tools

- Git and GitHub for version control
- Protected branches and pull requests
- GitHub Issues and GitHub Projects for project management
- GitHub Actions for CI

## Project Structure

- `frontend/` — Next.js application; Vitest tests in `tests/`
- `backend/` — Go backend; tests named `*_test.go`
- `ingestion/` — Python ingestion; pytest tests in `tests/`
- `.github/workflows/` — CI workflows

## Local Setup

Requires Git, Node.js 24 with npm, Python 3.13, and the Go version specified in `backend/go.mod`.

```bash
git clone https://github.com/Mikey1332/SWE_semester_project.git
cd SWE_semester_project
```

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. Stop with Ctrl+C.

Checks, run from `frontend/`:

```bash
npm run lint
npm run build
npm test
```

### Python Ingestion

From the repository root (macOS/Linux):

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install flake8 pytest
python -m pip install -r ingestion/requirements.txt
python -m pytest ingestion/tests/
flake8 ingestion/ --select=E9,F63,F7,F82
```

On Windows, create the environment with `py -3.13 -m venv .venv`
and activate it with `.venv\Scripts\Activate.ps1`.

Add ingestion dependencies to `ingestion/requirements.txt` as needed.

### Go Backend

From the repository root:

```bash
cd backend
go mod download
go build ./...
go vet ./...
go test ./...
```

Backend startup, ingestion execution, and PostgreSQL configuration will be documented when implemented.

## Contributing and CI

1. Create a feature branch from an up-to-date `main`.
2. Add your changes and meaningful tests; run the relevant checks above.
3. Commit and push, then open a pull request targeting `main`.
4. Obtain at least one approving teammate review and satisfy required checks before merging.

GitHub Actions runs frontend lint/build/tests, Go build/vet/tests, and Python lint/tests on pushes to `main` and pull requests targeting `main`.

Commit source, tests, dependency manifests/lockfiles, workflows, and `.gitignore` files. Keep `.venv/`, `node_modules/`, `.next/`, `.idea/`, caches, and credentials out of Git.

## Project Status

Project scaffolding and CI are configured. Frontend lint and build pass locally. Backend code, ingestion, and tests are still under development, so some CI checks currently fail.

A reported vulnerability in the frontend ESLint dependency chain remains under review.
