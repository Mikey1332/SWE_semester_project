CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id bigint NOT NULL REFERENCES users(id),
    market_id bigint NOT NULL REFERENCES markets(id),

    request_id text NOT NULL
        CHECK (length(request_id) BETWEEN 1 AND 100),

    side text NOT NULL
        CHECK (side IN ('yes', 'no')),

    action text NOT NULL
        CHECK (action IN ('buy', 'sell')),

    price bigint NOT NULL
        CHECK (price BETWEEN 1 AND 99),

    quantity bigint NOT NULL
        CHECK (quantity BETWEEN 1 AND 1000000),

    remaining bigint NOT NULL
        CHECK (remaining BETWEEN 0 AND quantity),

    cancelled boolean NOT NULL DEFAULT false,

    UNIQUE (user_id, request_id)
);

CREATE INDEX orders_open_book
ON orders (market_id, side, action, price, id)
WHERE remaining > 0 AND NOT cancelled;

CREATE TABLE trades (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    maker_id bigint NOT NULL REFERENCES orders(id),
    taker_id bigint NOT NULL REFERENCES orders(id),

    quantity bigint NOT NULL
        CHECK (quantity > 0),

    maker_price bigint NOT NULL
        CHECK (maker_price BETWEEN 1 AND 99),

    taker_price bigint NOT NULL
        CHECK (taker_price BETWEEN 1 AND 99)
);