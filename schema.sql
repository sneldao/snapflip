-- Owner: C. All money in integer cents. Timestamps are ISO-8601 strings.

CREATE TABLE IF NOT EXISTS buyers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  tg_chat_id TEXT,
  token_hash TEXT,                -- SHA-256 of the buyer's MCP/API token
  stripe_customer_id TEXT,
  payment_method_id TEXT,         -- saved-card fallback
  spt_id TEXT,                    -- Shared Payment Token, if used
  limit_cents INTEGER NOT NULL DEFAULT 0,
  limit_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,
  tg_chat_id TEXT UNIQUE,
  stripe_account_id TEXT,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  reliability REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS skus (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  platform TEXT,
  region TEXT,
  variant TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  ref_price_cents INTEGER NOT NULL,
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES buyers(id),
  rules_text TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  max_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | filled | cancelled | expired
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS order_skus (
  order_id TEXT NOT NULL REFERENCES orders(id),
  sku_id TEXT NOT NULL REFERENCES skus(id),
  PRIMARY KEY (order_id, sku_id)
);
CREATE INDEX IF NOT EXISTS idx_order_skus_sku ON order_skus(sku_id);

CREATE TABLE IF NOT EXISTS snaps (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  r2_key TEXT NOT NULL,
  sku_id TEXT REFERENCES skus(id),
  confidence REAL,
  grade TEXT,                              -- A | B | C | D
  grade_notes TEXT,
  flags_json TEXT NOT NULL DEFAULT '[]',
  rack_cents INTEGER,
  reserve_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  snap_id TEXT NOT NULL REFERENCES snaps(id),
  status TEXT NOT NULL,                    -- live | cleared | no_sale | settled | captured | released | failed
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT,
  reserve_cents INTEGER NOT NULL,
  clearing_cents INTEGER,
  winner_order_id TEXT REFERENCES orders(id),
  payment_intent_id TEXT,
  transfer_id TEXT
);

CREATE TABLE IF NOT EXISTS bids (
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  event TEXT NOT NULL,                     -- join | drop | raise | win
  price_cents INTEGER NOT NULL,
  reason TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id);
