-- Partidas sincronizadas con la app (fase 2).
--   · points: puntos de cada juego, tuyos y del rival: [[8, 7], [5, 8]].
--   · deleted_at: las partidas borradas se marcan en vez de borrarse, para que el borrado llegue
--     a los demás dispositivos (igual que los mazos).
-- Las estadísticas no cuentan las borradas.

alter table public.matches add column if not exists points jsonb;
alter table public.matches add column if not exists deleted_at timestamptz;

alter table public.matches drop constraint if exists matches_points_check;
alter table public.matches add constraint matches_points_check
  check (points is null or (jsonb_typeof(points) = 'array' and jsonb_array_length(points) <= 3));

create index if not exists matches_sync on public.matches (user_id, updated_at);

create or replace view public.deck_stats with (security_invoker = true) as
select
  user_id,
  deck_id,
  count(*) as games,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  count(*) filter (where result = 'draw') as draws,
  round(100.0 * count(*) filter (where result = 'win')
    / nullif(count(*) filter (where result <> 'draw'), 0), 1) as winrate
from public.matches
where deleted_at is null
group by user_id, deck_id;

create or replace view public.matchup_stats with (security_invoker = true) as
select
  user_id,
  my_legend_id,
  opponent_legend_id,
  count(*) as games,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  round(100.0 * count(*) filter (where result = 'win')
    / nullif(count(*) filter (where result <> 'draw'), 0), 1) as winrate
from public.matches
where deleted_at is null
group by user_id, my_legend_id, opponent_legend_id;

create or replace view public.profile_stats with (security_invoker = true) as
select
  user_id,
  count(*) as games,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  round(100.0 * count(*) filter (where result = 'win')
    / nullif(count(*) filter (where result <> 'draw'), 0), 1) as winrate
from public.matches
where deleted_at is null
group by user_id;
