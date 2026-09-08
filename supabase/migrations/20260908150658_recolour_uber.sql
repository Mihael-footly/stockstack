-- UBER and AAPL were both near-white, which made two of the seven pieces on a
-- board nearly indistinguishable. Steel blue keeps UBER's monochrome character
-- while separating it from AAPL's silver. Kept in step with src/game/stocks.ts.
update public.stock_catalog
set game_color = '#7E93AD',
    color_light = '#B4C6DA',
    color_dark = '#455A73',
    color_ink = '#0A121C'
where ticker = 'UBER';
