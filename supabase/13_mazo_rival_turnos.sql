-- Mazo del rival y quién empezó cada juego. Cambios sobre los archivos anteriores:
--   · opponent_deck_id / opponent_deck_name: el mazo con el que jugó el rival, si es un amigo (el id es
--     el de su mazo, en su cuenta; el nombre se copia para verlo aunque luego lo cambie o lo borre).
--     En la partida espejo pasa a ser el mazo de quien la guarda.
--   · game_starts: quién empezó cada juego al mejor de 3, al lado de sus puntos: [true, false, null]
--     (true: empezaste tú; null: sin apuntar). went_first sigue siendo el del primer juego.
--   · games_won / games_lost ya admiten 3: el 3–0 y el 0–3 (cuando se juega el tercero aunque ya
--     haya ganador) no necesitan cambios.
--
-- Mientras no se ejecute, la app sube las partidas sin estos datos y los reintenta en cada sincronización.
-- Se puede ejecutar más de una vez.

alter table public.matches add column if not exists opponent_deck_id text;
alter table public.matches add column if not exists opponent_deck_name text;
alter table public.matches add column if not exists game_starts jsonb;

alter table public.matches drop constraint if exists matches_opponent_deck_check;
alter table public.matches add constraint matches_opponent_deck_check check (
  char_length(opponent_deck_id) <= 64 and char_length(opponent_deck_name) <= 80
) not valid;

-- Hasta 3 juegos, cada uno true, false o null.
alter table public.matches drop constraint if exists matches_game_starts_check;
alter table public.matches add constraint matches_game_starts_check check (
  game_starts is null or (
    jsonb_typeof(game_starts) = 'array'
    and jsonb_array_length(game_starts) <= 3
    and not jsonb_path_exists(game_starts, 'strict $[*] ? (@.type() != "boolean" && @.type() != "null")')
  )
) not valid;
