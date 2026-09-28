-- Owner: C. Demo seed. Replace SKUs/ref prices with the cartridges we can physically get today.
-- Reference prices are placeholders, NOT real market data.

INSERT OR REPLACE INTO skus (id, category, title, platform, region, ref_price_cents) VALUES
  ('gb-pokemon-yellow-us', 'retro-games', 'Pokemon Yellow Version', 'Game Boy', 'US', 4000),
  ('gb-pokemon-red-us',    'retro-games', 'Pokemon Red Version',    'Game Boy', 'US', 4500),
  ('gb-pokemon-blue-us',   'retro-games', 'Pokemon Blue Version',   'Game Boy', 'US', 4500),
  ('gb-tetris-us',         'retro-games', 'Tetris',                 'Game Boy', 'US', 1000),
  ('gb-zelda-la-us',       'retro-games', 'Zelda: Link''s Awakening','Game Boy', 'US', 3500),
  ('n64-mario-kart-us',    'retro-games', 'Mario Kart 64',          'N64',      'US', 4000),
  ('n64-mario-64-us',      'retro-games', 'Super Mario 64',         'N64',      'US', 3500),
  ('snes-smw-us',          'retro-games', 'Super Mario World',      'SNES',     'US', 3000);

INSERT OR REPLACE INTO sellers (id, tg_chat_id) VALUES ('s_demo', NULL);

-- Five demo buyers with staggered grade caps on Pokemon Yellow so the auction has readable dropouts.
INSERT OR REPLACE INTO buyers (id, name, limit_cents) VALUES
  ('b_demo_1', 'Demo Buyer 1', 10000),
  ('b_demo_2', 'Demo Buyer 2', 10000),
  ('b_demo_3', 'Demo Buyer 3', 10000),
  ('b_demo_4', 'Demo Buyer 4', 10000),
  ('b_demo_5', 'Demo Buyer 5', 10000);

INSERT OR REPLACE INTO orders (id, buyer_id, rules_text, rules_json, max_cents) VALUES
  ('o_demo_1', 'b_demo_1', 'Pokemon Yellow, any grade, up to $25', '{"skuIds":["gb-pokemon-yellow-us"],"maxCents":2500,"gradeCaps":{},"require":[],"reject":["reproduction"]}', 2500),
  ('o_demo_2', 'b_demo_2', 'Pokemon Yellow, B or better, up to $32', '{"skuIds":["gb-pokemon-yellow-us"],"maxCents":3200,"gradeCaps":{"C":0,"D":0},"require":[],"reject":["reproduction"]}', 3200),
  ('o_demo_3', 'b_demo_3', 'Pokemon Yellow, up to $45, $30 if label worn', '{"skuIds":["gb-pokemon-yellow-us"],"maxCents":4500,"gradeCaps":{"B":3000,"C":2000},"require":[],"reject":["reproduction"]}', 4500),
  ('o_demo_4', 'b_demo_4', 'Any Gen 1 Pokemon cart, up to $38', '{"skuIds":["gb-pokemon-yellow-us","gb-pokemon-red-us","gb-pokemon-blue-us"],"maxCents":3800,"gradeCaps":{},"require":[],"reject":["reproduction"]}', 3800),
  ('o_demo_5', 'b_demo_5', 'Pokemon Yellow, mint only, up to $60', '{"skuIds":["gb-pokemon-yellow-us"],"maxCents":6000,"gradeCaps":{"B":0,"C":0,"D":0},"require":[],"reject":["reproduction"]}', 6000);

INSERT OR REPLACE INTO order_skus (order_id, sku_id) VALUES
  ('o_demo_1', 'gb-pokemon-yellow-us'),
  ('o_demo_2', 'gb-pokemon-yellow-us'),
  ('o_demo_3', 'gb-pokemon-yellow-us'),
  ('o_demo_4', 'gb-pokemon-yellow-us'),
  ('o_demo_4', 'gb-pokemon-red-us'),
  ('o_demo_4', 'gb-pokemon-blue-us'),
  ('o_demo_5', 'gb-pokemon-yellow-us');
