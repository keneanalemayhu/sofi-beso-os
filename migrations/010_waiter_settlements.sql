
BEGIN;

CREATE TABLE waiter_daily_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    branch_id UUID NOT NULL
        REFERENCES branches(id) ON DELETE RESTRICT,

    waiter_id UUID NOT NULL
        REFERENCES waiters(id) ON DELETE RESTRICT,

    business_date DATE NOT NULL,

    bank_amount NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (bank_amount >= 0),

    cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (cash_amount >= 0),

    created_by UUID REFERENCES users(id),

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT waiter_settlement_unique
        UNIQUE (branch_id, waiter_id, business_date)
);

CREATE INDEX idx_waiter_settlements_branch_date
    ON waiter_daily_settlements (branch_id, business_date DESC);

COMMIT;
