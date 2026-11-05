-- Correcciones de la revisión del esquema. Cambios sobre los archivos anteriores:
--   · Los triggers de mazos y partidas reconocen el upsert con el que guarda la app, que salta como
--     INSERT aunque la fila ya exista: editar un mazo no cuenta para el límite, y dejar de ser amigos
--     no quita el rival de las partidas antiguas.
--   · Un enlace de copia (mirror_of) que ya no vale se quita en vez de dar error: el error atascaba
--     la sincronización de esa cuenta.
--   · El límite de mazos no se puede saltar subiendo desde dos dispositivos a la vez.
--   · Las partidas borradas y las cartas a 0 solo las ve su dueño.
--   · Las políticas usan my_friends(), que se evalúa una vez por consulta y solo responde por quien
--     pregunta. Sin sesión ya no se puede preguntar por las amistades de otros.
--   · Límites de forma y tamaño en mazos y partidas.
--   · Índices para las claves foráneas que no tenían.
--
-- Se puede ejecutar más de una vez.

-- ---------- Límite de mazos ----------
-- Con upsert el trigger salta como INSERT aunque el mazo ya exista: por eso se mira si ya estaba vivo.
-- El bloqueo hace que dos subidas de la misma cuenta cuenten una detrás de otra.

create or replace function public.check_deck_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  already_live boolean;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    already_live := old.deleted_at is null;
  else
    already_live := exists (
      select 1 from public.decks where user_id = new.user_id and id = new.id and deleted_at is null
    );
  end if;
  if already_live then
    return new;
  end if;
  perform 1 from public.profiles where id = new.user_id for no key update;
  if (select count(*) from public.decks where user_id = new.user_id and deleted_at is null) >= 15 then
    raise exception 'LIMITE_MAZOS: como máximo 15 mazos por cuenta'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ---------- Rival y copia de una partida ----------
-- Solo se comprueba lo que cambia, también con upsert (salta como INSERT aunque la fila ya exista).
--   · El rival con cuenta tiene que ser un amigo: la app lo trata quitando el enlace.
--   · Una copia solo puede ser de una partida en la que eras el rival. Si no lo es (el autor quitó
--     el rival o borró la partida), la partida se queda sin enlace: un error aquí impediría subir
--     nada más desde esa cuenta.

create or replace function public.check_match_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev public.matches;
begin
  if tg_op = 'UPDATE' then
    prev := old;
  else
    select * into prev from public.matches where id = new.id and user_id = new.user_id;
  end if;
  if new.opponent_id is not null
     and new.opponent_id is distinct from prev.opponent_id
     and not public.are_friends(new.user_id, new.opponent_id) then
    raise exception 'RIVAL_NO_AMIGO: el rival tiene que ser un amigo (os seguís los dos)';
  end if;
  if new.mirror_of is not null
     and new.mirror_of is distinct from prev.mirror_of
     and not exists (select 1 from public.matches o where o.id = new.mirror_of and o.opponent_id = new.user_id) then
    new.mirror_of := null;
  end if;
  return new;
end $$;

-- ---------- Amigos ----------
-- Dentro de una política, "user_id in (select public.my_friends())" se calcula una sola vez por
-- consulta; are_friends() se llamaba por cada fila, también las de quien no es amigo.

create or replace function public.my_friends() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select f.followee_id
  from public.follows f
  join public.follows b on b.follower_id = f.followee_id and b.followee_id = f.follower_id
  where f.follower_id = (select auth.uid());
$$;

revoke execute on function public.my_friends() from public;
grant execute on function public.my_friends() to anon, authenticated;

-- ---------- Quién lee qué ----------

drop policy if exists "mazos: leer los míos, públicos o de amigos" on public.decks;
create policy "mazos: leer los míos, públicos o de amigos" on public.decks
  for select using (
    user_id = (select auth.uid())
    or (deleted_at is null and (
      is_public
      or public.is_public_profile(user_id)
      or user_id in (select public.my_friends())
    ))
  );

-- Las borradas solo las ve su dueño, igual que los mazos.
drop policy if exists "partidas: leer" on public.matches;
create policy "partidas: leer" on public.matches
  for select using (
    user_id = (select auth.uid())
    or (deleted_at is null and (
      opponent_id = (select auth.uid())
      or public.is_public_profile(user_id)
      or user_id in (select public.my_friends())
    ))
  );

-- Una carta a 0 es una que se quitó: solo le sirve a sus propios dispositivos.
drop policy if exists "colección: leer la mía o pública" on public.collection_items;
create policy "colección: leer la mía o pública" on public.collection_items
  for select using (
    user_id = (select auth.uid())
    or ((normal > 0 or foil > 0) and public.is_public_profile(user_id))
  );

drop policy if exists "ofrezco: leer la mía o de amigos" on public.trade_list;
create policy "ofrezco: leer la mía o de amigos" on public.trade_list
  for select to authenticated using (
    user_id = (select auth.uid()) or user_id in (select public.my_friends())
  );

drop policy if exists "busco: leer la mía o de amigos" on public.want_list;
create policy "busco: leer la mía o de amigos" on public.want_list
  for select to authenticated using (
    user_id = (select auth.uid()) or user_id in (select public.my_friends())
  );

-- Ya ninguna política la llama sin sesión. La siguen usando trade_matches() y los triggers.
revoke execute on function public.are_friends(uuid, uuid) from anon;

-- ---------- Forma y tamaño ----------
-- Holgados de sobra (un mazo de 120 cartas distintas ocupa unos 2 KB): evitan que alguien llene la
-- base de datos o guarde datos que rompan la app de quien los abre. "not valid": solo se comprueban
-- las filas nuevas o editadas, para que esto no falle por una fila antigua.

alter table public.decks drop constraint if exists decks_contenido_check;
alter table public.decks add constraint decks_contenido_check check (
  jsonb_typeof(main) = 'object'
  and jsonb_typeof(runes) = 'object'
  and jsonb_typeof(sideboard) = 'object'
  and octet_length(main::text) + octet_length(runes::text) + octet_length(sideboard::text) <= 65536
  and octet_length(battlefields::text) <= 2048
  and char_length(legend_id) <= 40
  and char_length(champion_id) <= 40
) not valid;

-- Puntos: hasta 3 juegos, cada uno [tuyos, del rival], con números (o vacío).
alter table public.matches drop constraint if exists matches_points_check;
alter table public.matches add constraint matches_points_check check (
  points is null or (
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) <= 3
    and not jsonb_path_exists(points, 'strict $[*] ? (@.type() != "array" || @.size() != 2)')
    and not jsonb_path_exists(points, 'strict $[*] ? (@.type() == "array") [*] ? (@.type() != "number" && @.type() != "null")')
  )
) not valid;

alter table public.matches drop constraint if exists matches_leyendas_check;
alter table public.matches add constraint matches_leyendas_check check (
  char_length(my_legend_id) <= 40 and char_length(opponent_legend_id) <= 40
) not valid;

-- ---------- Índices de claves foráneas ----------
-- Sin ellos, borrar una cuenta recorre la tabla entera por cada fila que se borra.

create index if not exists matches_mirror_of on public.matches (mirror_of) where mirror_of is not null;
create index if not exists trades_counter_of on public.trades (counter_of) where counter_of is not null;
create index if not exists trade_items_from_user on public.trade_items (from_user);
