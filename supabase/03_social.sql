-- Fase 3: social. Perfiles públicos (ya en la fase 1: profiles.is_public), seguir a jugadores
-- y un resumen de estadísticas por perfil. La curva de energía y el resto del análisis del mazo
-- se calculan en la app con cards.json, así que no necesitan tablas.

create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee on public.follows (followee_id);

alter table public.follows enable row level security;

drop policy if exists "seguir: leer con sesión" on public.follows;
create policy "seguir: leer con sesión" on public.follows
  for select to authenticated using (true);
drop policy if exists "seguir: seguir yo" on public.follows;
create policy "seguir: seguir yo" on public.follows
  for insert to authenticated with check (follower_id = (select auth.uid()));
drop policy if exists "seguir: dejar de seguir" on public.follows;
create policy "seguir: dejar de seguir" on public.follows
  for delete to authenticated using (follower_id = (select auth.uid()));

grant select, insert, delete on public.follows to authenticated;

-- Resumen para la cabecera de un perfil: partidas, victorias y porcentaje global.
create or replace view public.profile_stats with (security_invoker = true) as
select
  user_id,
  count(*) as games,
  count(*) filter (where result = 'win') as wins,
  count(*) filter (where result = 'loss') as losses,
  round(100.0 * count(*) filter (where result = 'win')
    / nullif(count(*) filter (where result <> 'draw'), 0), 1) as winrate
from public.matches
group by user_id;

grant select on public.profile_stats to anon, authenticated;
