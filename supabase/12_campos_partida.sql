-- Campos de batalla de cada partida. Cambios sobre los archivos anteriores:
--   · battlefields: el Campo de cada uno en cada juego, al lado de sus puntos:
--     [["ogn-275-298", "ogn-276-298"], [null, "ogn-280-298"]] (tuyo, del rival; null si no se apuntó).
--
-- Mientras no se ejecute, la app sube las partidas sin los Campos y los reintenta en cada sincronización.
-- Se puede ejecutar más de una vez.

alter table public.matches add column if not exists battlefields jsonb;

-- Hasta 3 juegos, cada uno [tuyo, del rival], con ids de carta (o vacío).
alter table public.matches drop constraint if exists matches_battlefields_check;
alter table public.matches add constraint matches_battlefields_check check (
  battlefields is null or (
    jsonb_typeof(battlefields) = 'array'
    and jsonb_array_length(battlefields) <= 3
    and not jsonb_path_exists(battlefields, 'strict $[*] ? (@.type() != "array" || @.size() != 2)')
    and not jsonb_path_exists(battlefields, 'strict $[*] ? (@.type() == "array") [*] ? (@.type() != "string" && @.type() != "null")')
    and octet_length(battlefields::text) <= 512
  )
) not valid;
