-- All Music Note amounts are whole numbers stored as bigint.

CREATE TABLE users (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE songs (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title      text NOT NULL,
    artist     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (title, artist)
);

-- One row per song per weekly chart.
CREATE TABLE chart_snapshots (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    song_id    bigint NOT NULL REFERENCES songs (id),
    chart_date date NOT NULL,
    rank       smallint NOT NULL CHECK (rank BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (song_id, chart_date),
    UNIQUE (chart_date, rank)
);

-- Kalshi-style YES/NO market created by the bots: "Will the song move at least
-- `shift` spots from baseline_rank on the chart dated chart_date?" Positive shift
-- means rising (rank number falls), negative means falling. A song missing from
-- that chart counts as rank 101. YES costs yes_price, NO costs 100 - yes_price,
-- and each winning contract pays 100 (ContractPayout in db.go). Trading stops
-- at closes_at, before the chart is published.
CREATE TABLE markets (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    song_id       bigint NOT NULL REFERENCES songs (id),
    chart_date    date NOT NULL,
    baseline_rank smallint NOT NULL CHECK (baseline_rank BETWEEN 1 AND 100),
    shift         smallint NOT NULL CHECK (shift <> 0),
    yes_price     smallint NOT NULL CHECK (yes_price BETWEEN 1 AND 99),
    closes_at     timestamptz NOT NULL,
    status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    outcome       text CHECK (outcome IN ('yes', 'no')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (song_id, chart_date, shift),
    CHECK ((status = 'resolved') = (outcome IS NOT NULL))
);

-- Contracts held in markets that have not resolved yet; Resolve deletes them.
CREATE TABLE positions (
    user_id    bigint NOT NULL REFERENCES users (id),
    market_id  bigint NOT NULL REFERENCES markets (id),
    side       text NOT NULL CHECK (side IN ('yes', 'no')),
    quantity   integer NOT NULL CHECK (quantity > 0),
    cost_basis bigint NOT NULL CHECK (cost_basis > 0), -- Music Notes paid for these contracts
    PRIMARY KEY (user_id, market_id, side)
);

-- Current balance; always equals the sum of the user's ledger_entries.
-- Only change it through Post in db.go.
CREATE TABLE balances (
    user_id    bigint PRIMARY KEY REFERENCES users (id),
    balance    bigint NOT NULL CHECK (balance >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only history of every balance change.
CREATE TABLE ledger_entries (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       bigint NOT NULL REFERENCES users (id),
    amount        bigint NOT NULL CHECK (amount <> 0), -- positive credits, negative debits
    balance_after bigint NOT NULL CHECK (balance_after >= 0),
    kind          text NOT NULL CHECK (kind IN ('grant', 'buy', 'payout')),
    market_id     bigint REFERENCES markets (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (kind <> 'grant' OR amount > 0)
);
CREATE INDEX ledger_entries_user_idx ON ledger_entries (user_id, id);

-- Realized P&L: every non-grant ledger entry, plus the cost of open positions
-- (buying contracts converts notes into positions; it is not a loss until the
-- market resolves). Grants are excluded.
CREATE VIEW user_pnl AS
SELECT u.id AS user_id,
       COALESCE((SELECT sum(l.amount) FROM ledger_entries l WHERE l.user_id = u.id AND l.kind <> 'grant'), 0)
     + COALESCE((SELECT sum(p.cost_basis) FROM positions p WHERE p.user_id = u.id), 0) AS realized_pnl
FROM users u;
