-- All Music Note amounts are whole numbers stored as bigint.
-- Multiple TAbes repping each of the orders

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

-- Will the song move UP or DOWN from baseline_rank on the chart dated chart_date?
CREATE TABLE markets (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    song_id       bigint NOT NULL REFERENCES songs (id),
    chart_date    date NOT NULL,
    baseline_rank smallint NOT NULL CHECK (baseline_rank BETWEEN 1 AND 100),
    status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'resolved')),
    outcome       text CHECK (outcome IN ('up', 'down')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (song_id, chart_date),
    CHECK ((status = 'resolved') = (outcome IS NOT NULL))
);

CREATE TABLE orders (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         bigint NOT NULL REFERENCES users (id),
    market_id       bigint NOT NULL REFERENCES markets (id),
    side            text NOT NULL CHECK (side IN ('up', 'down')),
    action          text NOT NULL CHECK (action IN ('buy', 'sell')),
    price           bigint NOT NULL CHECK (price > 0), -- Music Notes per contract
    quantity        integer NOT NULL CHECK (quantity > 0),
    filled_quantity integer NOT NULL DEFAULT 0 CHECK (filled_quantity BETWEEN 0 AND quantity),
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON orders (user_id);
CREATE INDEX orders_open_book_idx ON orders (market_id, side, price) WHERE status = 'open';

CREATE TABLE trades (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    market_id     bigint NOT NULL REFERENCES markets (id),
    buy_order_id  bigint NOT NULL REFERENCES orders (id),
    sell_order_id bigint NOT NULL REFERENCES orders (id),
    side          text NOT NULL CHECK (side IN ('up', 'down')),
    price         bigint NOT NULL CHECK (price > 0),
    quantity      integer NOT NULL CHECK (quantity > 0),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trades_market_idx ON trades (market_id, created_at);

CREATE TABLE positions (
    user_id    bigint NOT NULL REFER.ENCES users (id),
    market_id  bigint NOT NULL REFERENCES markets (id),
    side       text NOT NULL CHECK (side IN ('up', 'down')),
    quantity   integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    cost_basis bigint NOT NULL DEFAULT 0 CHECK (cost_basis >= 0), -- Music Notes paid for the open quantity
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
    tx_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       bigint NOT NULL REFERENCES users (id),
    amount        bigint NOT NULL CHECK (amount <> 0), -- positive credits, negative debits
    balance_after bigint NOT NULL CHECK (balance_after >= 0),
    kind          text NOT NULL CHECK (kind IN ('grant', 'trade', 'payout')),
    market_id     bigint REFERENCES markets (id),
    trade_id      bigint REFERENCES trades (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (kind <> 'grant' OR amount > 0)
);
CREATE INDEX ledger_entries_user_idx ON ledger_entries (user_id, id);

-- Realized P&L: every non-grant ledger entry, plus the cost of open positions
-- (buying contracts converts notes into positions; it is not a loss). Grants are excluded.
CREATE VIEW user_pnl AS
SELECT u.id AS user_id,
       COALESCE((SELECT sum(l.amount) FROM ledger_entries l WHERE l.user_id = u.id AND l.kind <> 'grant'), 0)
     + COALESCE((SELECT sum(p.cost_basis) FROM positions p WHERE p.user_id = u.id), 0) AS realized_pnl
FROM users u;
