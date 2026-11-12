-- Privacidad y límites. Cambios sobre los archivos anteriores:
--   · Las partidas de un perfil público ya no se leen de la tabla matches (devolvía todas las columnas:
--     notas, rival con cuenta, nombre de su mazo…). Se leen de la vista public_matches, que solo
--     tiene lo que hace falta para las estadísticas. La tabla queda para ti, tus amigos y tu rival.
--     Las vistas deck_stats, matchup_stats y profile_stats siguen la tabla: ya no muestran los perfiles
--     públicos de quien no es amigo (la app no las usa).
--   · follows: cada uno solo ve las filas en las que aparece. Sin esto, cualquier cuenta podía
--     reconstruir todas las amistades.
--   · Límite de filas por cuenta en cada tabla (contando los mazos y partidas borrados), para que
--     nadie pueda llenar la base de datos. Holgados: muy por encima de lo que usa una cuenta real.
--   · Las políticas de mazos y colección miran los perfiles públicos una vez por consulta, no una
--     vez por fila con is_public_profile().
--
-- Se puede ejecutar más de una vez. Hace falta haber ejecutado antes del 01 al 13.

-- ---------- Partidas de perfiles públicos ----------

create or replace view public.public_matches with (security_invoker = false) as
select m.id, m.user_id, m.played_at, m.deck_id, m.my_legend_id, m.opponent_legend_id, m.result,
  m.games_won, m.games_lost, m.went_first, m.points, m.battlefields, m.game_starts
from public.matches m
join public.profiles p on p.id = m.user_id and p.is_public
where m.deleted_at is null;

revoke all on public.public_matches from public, anon, authenticated;
grant select on public.public_matches to anon, authenticated;

drop policy if exists "partidas: leer" on public.matches;
create policy "partidas: leer" on public.matches
  for select using (
    user_id = (select auth.uid())
    or (deleted_at is null and (
      opponent_id = (select auth.uid())
      or user_id in (select public.my_friends())
    ))
  );

-- ---------- Mazos y colección: perfiles públicos una vez por consulta ----------

drop policy if exists "mazos: leer los míos, públicos o de amigos" on public.decks;
create policy "mazos: leer los míos, públicos o de amigos" on public.decks
  for select using (
    user_id = (select auth.uid())
    or (deleted_at is null and (
      is_public
      or user_id in (select p.id from public.profiles p where p.is_public)
      or user_id in (select public.my_friends())
    ))
  );

drop policy if exists "colección: leer la mía o pública" on public.collection_items;
create policy "colección: leer la mía o pública" on public.collection_items
  for select using (
    user_id = (select auth.uid())
    or ((normal > 0 or foil > 0) and user_id in (select p.id from public.profiles p where p.is_public))
  );

-- ---------- Seguir: solo lo tuyo ----------

drop policy if exists "seguir: leer con sesión" on public.follows;
drop policy if exists "seguir: leer los míos" on public.follows;
create policy "seguir: leer los míos" on public.follows
  for select to authenticated using (
    follower_id = (select auth.uid()) or followee_id = (select auth.uid())
  );

-- ---------- Límite de filas por cuenta ----------
-- Se comprueba una vez por sentencia, con las filas nuevas (un upsert de filas que ya existían no
-- cuenta). Argumentos: el máximo y la columna con la cuenta.

create or replace function public.check_row_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lim integer := tg_argv[0]::integer;
  col text := tg_argv[1];
  over uuid;
begin
  execute format(
    'select n.u from (select distinct %1$I as u from new_rows) n
     where (select count(*) from %2$I.%3$I t where t.%1$I = n.u) > $1 limit 1',
    col, tg_table_schema, tg_table_name)
  into over using lim;
  if over is not null then
    raise exception 'LIMITE_FILAS: demasiadas filas en % (máximo %)', tg_table_name, lim
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

revoke execute on function public.check_row_limit() from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('collection_items', 10000, 'user_id'),
    ('decks', 500, 'user_id'),
    ('matches', 20000, 'user_id'),
    ('ledger', 20000, 'user_id'),
    ('trade_list', 5000, 'user_id'),
    ('want_list', 5000, 'user_id'),
    ('follows', 2000, 'follower_id'),
    ('trades', 5000, 'proposer_id')
  ) as v (tbl, lim, col) loop
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_row_limit', t.tbl);
    execute format(
      'create trigger %I after insert on public.%I referencing new table as new_rows
       for each statement execute function public.check_row_limit(%L, %L)',
      t.tbl || '_row_limit', t.tbl, t.lim, t.col);
  end loop;
end $$;
