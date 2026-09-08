-- Generated from src/game/stocks.ts so the two cannot drift. Rarity is spawn
-- frequency in the piece stream and nothing else.
insert into public.stock_catalog (ticker, company_name, game_color, color_light, color_dark, color_ink, rarity) values
  ('NVDA', 'NVIDIA', '#19F28A', '#7DFFC4', '#0B9B57', '#04231A', 'rare'),
  ('AAPL', 'Apple', '#E8EDF4', '#FFFFFF', '#98A4B4', '#131A24', 'common'),
  ('HOOD', 'Robinhood', '#C6F24E', '#E6FFA0', '#7FA317', '#1B2404', 'uncommon'),
  ('TSLA', 'Tesla', '#FF5C5C', '#FF9E9E', '#A82C2C', '#2B0707', 'uncommon'),
  ('META', 'Meta', '#43A5FF', '#9CCEFF', '#1D66B4', '#04182B', 'common'),
  ('MSFT', 'Microsoft', '#5CC8E8', '#A8E6F7', '#2482A0', '#03222B', 'common'),
  ('AMZN', 'Amazon', '#FFB03A', '#FFD494', '#B36F12', '#2B1704', 'common'),
  ('GOOGL', 'Alphabet', '#9B8BFF', '#CBC2FF', '#5C4BC4', '#100A2B', 'uncommon'),
  ('AMD', 'AMD', '#FF7A45', '#FFB08C', '#B34818', '#2B0F04', 'uncommon'),
  ('COIN', 'Coinbase', '#3B7BFF', '#8FB4FF', '#1A46B4', '#03112B', 'rare'),
  ('PLTR', 'Palantir', '#00D6C2', '#7DFFF3', '#00877A', '#022725', 'rare'),
  ('SPOT', 'Spotify', '#5FE87A', '#A9FFBB', '#2A9A42', '#052B10', 'uncommon'),
  ('NFLX', 'Netflix', '#F2456B', '#FF93AB', '#A81640', '#2B0512', 'rare'),
  ('UBER', 'Uber', '#B9C4D4', '#E4EAF3', '#6F7B8C', '#0D141D', 'common'),
  ('SHOP', 'Shopify', '#8BD44E', '#C4F0A0', '#4F8A1F', '#0B2204', 'uncommon'),
  ('AVGO', 'Broadcom', '#FF4FD8', '#FFA3EC', '#B01A94', '#2B0423', 'epic'),
  ('ARM', 'Arm Holdings', '#00B2FF', '#84D9FF', '#0070A8', '#021C2B', 'epic')
on conflict (ticker) do update set
  company_name = excluded.company_name,
  game_color = excluded.game_color,
  color_light = excluded.color_light,
  color_dark = excluded.color_dark,
  color_ink = excluded.color_ink,
  rarity = excluded.rarity;

-- A handful of cosmetics so the unlock path has something real behind it.
insert into public.cosmetics (slug, name, kind, unlock_level, payload) values
  ('board-midnight', 'Midnight Floor', 'board_skin', 1, '{"bg":"#070E18"}'),
  ('board-trading-pit', 'Trading Pit', 'board_skin', 5, '{"bg":"#0B1220"}'),
  ('board-green-room', 'Green Room', 'board_skin', 12, '{"bg":"#04140D"}'),
  ('clear-ticker-rush', 'Ticker Rush', 'clear_effect', 1, '{}'),
  ('clear-market-surge', 'Market Surge', 'clear_effect', 8, '{}'),
  ('banner-opening-bell', 'Opening Bell', 'banner', 3, '{}')
on conflict (slug) do nothing;
