-- Fase 2: registro de partidas (victorias y derrotas con tu mazo y el del rival).
--
-- Se guarda la Leyenda de los dos mazos aunque el mazo propio se borre: los enfrentamientos
-- (matchups) se cuentan por Leyenda, que es como se juega y se comenta Riftbound.

do $$ begin
  create type public.match_result as enum ('win', 'loss', 'draw');
exception when duplicate_object then null;
end $$;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  played_at timestamptz not null default now(),
  deck_id text,                       -- mazo propio usado (opcional)
  my_legend_id text,                  -- copia de su Leyenda al jugar
  opponent_legend_id text,
  opponent_name text check (char_length(opponent_name) <= 40),        -- rival sin cuenta
  opponent_id uuid references public.profiles (id) on delete set null, -- rival con cuenta
  result public.match_result not null,
  games_won smallint check (games_won between 0 and 3),   -- al mejor de 3; vacío en partida única
  games_lost smallint check (games_lost between 0 and 3),
  went_first boolean,
  event text check (char_length(event) <= 80),           -- "Casual", "Tienda X", "Regional"…
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, deck_id) references public.decks (user_id, id) on delete set null (deck_id)
);

create index if not exists matches_by_user on public.matches (user_id, played_at desc);
create index if not exists matches_by_opponent on public.matches (opponent_id) where opponent_id is not null;
create or replace trigger matches_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

alter table public.matches enable row level security;

-- Las mías, las de perfiles públicos (sus estadísticas) y aquellas en las que yo era el rival.
drop policy if exists "partidas: leer" on public.matches;
create policy "partidas: leer" on public.matches
  for select using (
    user_id = (select auth.uid())
    or opponent_id = (select auth.uid())
    or public.is_public_profile(user_id)
  );
drop policy if exists "partidas: apuntar las mías" on public.matches;
create policy "partidas: apuntar las mías" on public.matches
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "partidas: corregir las mías" on public.matches;
create policy "partidas: corregir las mías" on public.matches
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "partidas: borrar las mías" on public.matches;
create policy "partidas: borrar las mías" on public.matches
  for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.matches to anon, authenticated;
grant insert, update, delete on public.matches to authenticated;

-- ---------- Estadísticas ----------
-- Vistas con security_invoker: respetan el RLS de matches, así que cada uno ve las suyas
-- y las de los perfiles públicos. El porcentaje no cuenta los empates.

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
group by user_id, my_legend_id, opponent_legend_id;

grant select on public.deck_stats, public.matchup_stats to anon, authenticated;
