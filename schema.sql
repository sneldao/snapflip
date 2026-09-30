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
  findings_json TEXT NOT NULL DEFAULT '[]', -- [{area, observation, box?}] — the appraisal evidence
  item_box_json TEXT,                      -- normalized [x,y,w,h] bounds of the item in the photo
  rack_cents INTEGER,
  reserve_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  snap_id TEXT NOT NULL REFERENCES snaps(id),
  status TEXT NOT NULL,                    -- live | cleared | no_sale | settled | captured | released | failed | expired | refunded
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT,
  reserve_cents INTEGER NOT NULL,
  clearing_cents INTEGER,
  winner_order_id TEXT REFERENCES orders(id),
  payment_intent_id TEXT,
  transfer_id TEXT,
  proof_requested_at TEXT,                 -- seller tapped "I bought it"; waiting on the proof photo
  proof_r2_key TEXT,                       -- seller's in-hand photo; capture happens only after it lands
  tg_chat_id TEXT,                         -- seller's live-auction message, edited as the price climbs
  tg_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auctions_pi ON auctions(payment_intent_id);
-- Migration for DBs created before the proof/live columns:
-- ALTER TABLE auctions ADD COLUMN proof_requested_at TEXT;
-- ALTER TABLE auctions ADD COLUMN proof_r2_key TEXT;
-- ALTER TABLE auctions ADD COLUMN tg_chat_id TEXT;
-- ALTER TABLE auctions ADD COLUMN tg_message_id INTEGER;

CREATE TABLE IF NOT EXISTS bids (
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  event TEXT NOT NULL,                     -- join | drop | raise | win
  price_cents INTEGER NOT NULL,
  reason TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id);

-- Monetisation ledger. One row per settled auction, snapshotting the fee basis points
-- so later SELLER_FEE_BPS changes never rewrite history. Written by persistAndSettle;
-- release() pays out clearing minus this row's fee_cents.
CREATE TABLE IF NOT EXISTS platform_fees (
  auction_id TEXT PRIMARY KEY REFERENCES auctions(id),
  clearing_cents INTEGER NOT NULL,
  fee_bps INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  express_fee_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Buyer Plus ($6/mo). One row per buyer; status mirrors the Stripe subscription.
-- Entitlement = status in ('active','trialing') and period end in the future.
CREATE TABLE IF NOT EXISTS subscriptions (
  buyer_id TEXT PRIMARY KEY REFERENCES buyers(id),
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | trialing | past_due | canceled | stub
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Model response cache. Key = SHA-256(system prompt + request content), so a
-- webhook retry or a seller re-sending the same photo replays at zero tokens.
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  response TEXT NOT NULL,                  -- the JSON object the model returned
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Sellers who asked to be pinged when demand appears for something they snapped.
-- sku_id set when the find is catalogued; otherwise matched by normalized title.
CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  snap_id TEXT REFERENCES snaps(id),
  sku_id TEXT REFERENCES skus(id),
  title TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,   -- 0 = offered, 1 = seller tapped "ping me"
  notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_watches_open ON watches(active, notified_at);

-- Sellers who snapped a roadmap category (vinyl, lego, trading-card) and asked to hear when it opens.
-- Doubles as the signal for which category to launch next.
CREATE TABLE IF NOT EXISTS category_interest (
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (seller_id, category)
);

-- External market comps for the desk's price game (Tavily web search over sold
-- listings). Cached per normalized query for 24h; market_calls rate-limits the
-- uncached path so a hot endpoint can't burn the search quota.
CREATE TABLE IF NOT EXISTS market_cache (
  query TEXT PRIMARY KEY,                    -- normalized: lowercase, collapsed whitespace
  payload TEXT NOT NULL,                     -- the JSON response body
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS market_calls (
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Collector price watches (the desk's "want me to watch for one under $X?").
-- Created pending by /watch; the t.me deep link binds tg_chat_id via /start
-- w_<code>, which arms it. Cron re-checks the market tape and pings once when
-- the reference price drops to max_cents, then marks it fired.
CREATE TABLE IF NOT EXISTS market_watches (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,             -- w_… deep-link bind code
  query TEXT NOT NULL,                   -- normalized item name
  display TEXT NOT NULL,                 -- item as the collector said it
  max_cents INTEGER NOT NULL,            -- ping when market ref <= this
  ref_cents INTEGER,                     -- market reference when armed
  tg_chat_id TEXT,                       -- set when the collector binds Telegram
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | armed | fired | cancelled
  fired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_market_watches_armed ON market_watches(status);
