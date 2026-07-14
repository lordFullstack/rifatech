-- ═══════════════════════════════════════════════════════════
--  RIFATECH — DATABASE SCHEMA
--  PostgreSQL 15+ · Optimized for High Concurrency
-- ═══════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────
CREATE TYPE raffle_status AS ENUM ('draft', 'active', 'paused', 'finished', 'cancelled');
CREATE TYPE ticket_status AS ENUM ('available', 'reserved', 'paid', 'expired');
CREATE TYPE payment_method AS ENUM ('nequi', 'daviplata', 'pse', 'cash', 'other');

-- ─────────────────────────────────────────────────────────
-- 1. ORGANIZERS (SaaS tenants)
-- ─────────────────────────────────────────────────────────
CREATE TABLE organizers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name       VARCHAR(120) NOT NULL,
  email           VARCHAR(254) UNIQUE NOT NULL,
  phone           VARCHAR(20),
  password_hash   TEXT NOT NULL,
  plan            VARCHAR(30) DEFAULT 'free',     -- free | pro | enterprise
  balance_cop     BIGINT DEFAULT 0 CHECK (balance_cop >= 0),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organizers_email ON organizers(email);

-- ─────────────────────────────────────────────────────────
-- 2. RAFFLES
-- ─────────────────────────────────────────────────────────
CREATE TABLE raffles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organizer_id    UUID NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,

  -- Content
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  prize_name      VARCHAR(200) NOT NULL,
  prize_value_cop BIGINT NOT NULL CHECK (prize_value_cop > 0),
  prize_image_url TEXT,

  -- Mechanics
  ticket_price    INTEGER NOT NULL CHECK (ticket_price > 0),     -- COP
  total_numbers   INTEGER NOT NULL CHECK (total_numbers IN (100, 200, 500, 1000)),
  lottery_name    VARCHAR(100) NOT NULL,                          -- "Lotería de Bogotá"
  lottery_number  INTEGER,                                        -- winning number revealed post-draw
  draw_date       DATE NOT NULL,

  -- State
  status          raffle_status DEFAULT 'draft',
  reservation_ttl INTEGER DEFAULT 900,                            -- seconds (15 min)

  -- Metadata
  slug            VARCHAR(100) UNIQUE,                            -- friendly URL
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX idx_raffles_organizer  ON raffles(organizer_id);
CREATE INDEX idx_raffles_status     ON raffles(status);
CREATE INDEX idx_raffles_slug       ON raffles(slug);

-- ─────────────────────────────────────────────────────────
-- 3. TICKETS
--    One row per number per raffle. Pre-seeded on raffle creation.
-- ─────────────────────────────────────────────────────────
CREATE TABLE tickets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raffle_id       UUID NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  number          INTEGER NOT NULL CHECK (number >= 1),

  -- Ownership
  status          ticket_status DEFAULT 'available',
  buyer_name      VARCHAR(120),
  buyer_phone     VARCHAR(20),
  buyer_email     VARCHAR(254),

  -- Timing
  reserved_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,        -- NULL when available or paid
  paid_at         TIMESTAMPTZ,

  -- Payment
  payment_method  payment_method,
  payment_ref     VARCHAR(100),       -- external payment reference
  amount_paid     INTEGER,

  -- Ticket identity
  serial_ref      VARCHAR(30) UNIQUE, -- e.g. #REF-2026-X99B
  qr_token        UUID DEFAULT uuid_generate_v4(),

  -- Concurrency version (optimistic locking)
  version         INTEGER DEFAULT 0 NOT NULL,

  -- ──────────────────────────────────────────
  -- CRITICAL: Composite unique constraint
  -- Guarantees one row per number per raffle.
  -- Combined with FOR UPDATE SKIP LOCKED, this
  -- prevents any double-reservation at DB level.
  -- ──────────────────────────────────────────
  UNIQUE (raffle_id, number)
);

-- Performance indexes
CREATE INDEX idx_tickets_raffle_status  ON tickets(raffle_id, status);
CREATE INDEX idx_tickets_expires_at     ON tickets(expires_at) WHERE status = 'reserved';
CREATE INDEX idx_tickets_qr_token       ON tickets(qr_token);
CREATE INDEX idx_tickets_serial         ON tickets(serial_ref);

-- ─────────────────────────────────────────────────────────
-- 4. RESERVATION EVENTS (audit log)
-- ─────────────────────────────────────────────────────────
CREATE TABLE reservation_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id),
  raffle_id   UUID NOT NULL,
  number      INTEGER NOT NULL,
  event_type  VARCHAR(30) NOT NULL,   -- reserved | paid | expired | released | cancelled
  actor_ip    INET,
  actor_ua    TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_ticket  ON reservation_events(ticket_id);
CREATE INDEX idx_events_raffle  ON reservation_events(raffle_id, created_at);

-- ─────────────────────────────────────────────────────────
-- 5. SEED TICKETS (trigger on raffle creation)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_tickets_for_raffle()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tickets (raffle_id, number)
  SELECT NEW.id, generate_series(1, NEW.total_numbers);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seed_tickets
AFTER INSERT ON raffles
FOR EACH ROW
EXECUTE FUNCTION seed_tickets_for_raffle();

-- ─────────────────────────────────────────────────────────
-- 6. AUTO-EXPIRE RESERVATIONS (called by pg_cron or Node cron)
--    Schedule: SELECT expire_stale_reservations(); every 30s
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_stale_reservations()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE tickets
    SET
      status      = 'available',
      buyer_name  = NULL,
      buyer_phone = NULL,
      buyer_email = NULL,
      reserved_at = NULL,
      expires_at  = NULL,
      serial_ref  = NULL,
      version     = version + 1
    WHERE
      status     = 'reserved'
      AND expires_at < NOW()
    RETURNING id, raffle_id, number
  )
  INSERT INTO reservation_events (ticket_id, raffle_id, number, event_type)
  SELECT id, raffle_id, number, 'expired' FROM expired;

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────
-- 7. ATOMIC RESERVE PROCEDURE
--    Called by API layer. Returns reserved ticket IDs or raises.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reserve_tickets(
  p_raffle_id  UUID,
  p_numbers    INTEGER[],
  p_buyer_name VARCHAR,
  p_buyer_phone VARCHAR,
  p_buyer_email VARCHAR DEFAULT NULL,
  p_actor_ip   INET    DEFAULT NULL,
  p_ttl_sec    INTEGER DEFAULT 900
)
RETURNS TABLE (ticket_id UUID, serial_ref VARCHAR) AS $$
DECLARE
  v_locked_ids UUID[];
  v_conflict   INTEGER[];
BEGIN
  -- Step 1: Lock exactly the requested rows.
  -- FOR UPDATE SKIP LOCKED: if another transaction holds a lock,
  -- we skip (not wait), collect only what we can lock atomically.
  SELECT ARRAY_AGG(id ORDER BY number)
  INTO v_locked_ids
  FROM tickets
  WHERE raffle_id = p_raffle_id
    AND number    = ANY(p_numbers)
    AND status    = 'available'
  FOR UPDATE SKIP LOCKED;

  -- Step 2: Verify we locked ALL requested numbers.
  -- If count differs, some were unavailable or locked by another tx.
  IF array_length(v_locked_ids, 1) IS DISTINCT FROM array_length(p_numbers, 1) THEN
    -- Find which numbers we could NOT lock for a useful error message
    SELECT ARRAY_AGG(number) INTO v_conflict
    FROM tickets
    WHERE raffle_id = p_raffle_id
      AND number    = ANY(p_numbers)
      AND status   <> 'available';

    RAISE EXCEPTION 'CONFLICT: numbers % are not available', v_conflict
      USING ERRCODE = '40001';  -- serialization failure → maps to HTTP 409
  END IF;

  -- Step 3: Atomically update all locked rows
  UPDATE tickets
  SET
    status       = 'reserved',
    buyer_name   = p_buyer_name,
    buyer_phone  = p_buyer_phone,
    buyer_email  = p_buyer_email,
    reserved_at  = NOW(),
    expires_at   = NOW() + (p_ttl_sec || ' seconds')::INTERVAL,
    serial_ref   = '#REF-' || EXTRACT(YEAR FROM NOW())::TEXT || '-'
                   || UPPER(SUBSTRING(encode(gen_random_bytes(3), 'hex'), 1, 4)),
    version      = version + 1
  WHERE id = ANY(v_locked_ids);

  -- Step 4: Audit log
  INSERT INTO reservation_events (ticket_id, raffle_id, number, event_type, actor_ip)
  SELECT t.id, t.raffle_id, t.number, 'reserved', p_actor_ip
  FROM tickets t
  WHERE t.id = ANY(v_locked_ids);

  -- Step 5: Return reserved ticket info to caller
  RETURN QUERY
  SELECT t.id, t.serial_ref
  FROM tickets t
  WHERE t.id = ANY(v_locked_ids)
  ORDER BY t.number;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────
-- 8. CONFIRM PAYMENT PROCEDURE
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_payment(
  p_serial_ref    VARCHAR,
  p_payment_ref   VARCHAR,
  p_method        payment_method,
  p_amount        INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE tickets
  SET
    status         = 'paid',
    paid_at        = NOW(),
    expires_at     = NULL,
    payment_method = p_method,
    payment_ref    = p_payment_ref,
    amount_paid    = p_amount,
    version        = version + 1
  WHERE
    serial_ref = p_serial_ref
    AND status = 'reserved'
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN FALSE;  -- Reservation expired or not found
  END IF;

  INSERT INTO reservation_events (ticket_id, raffle_id, number, event_type, payload)
  SELECT id, raffle_id, number, 'paid',
    jsonb_build_object('method', p_method, 'ref', p_payment_ref, 'amount', p_amount)
  FROM tickets WHERE serial_ref = p_serial_ref;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
