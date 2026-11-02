-- Fase 3: amigos y partida espejo.
--
-- Amigos: dos cuentas que se siguen la una a la otra (tabla follows). Los amigos ven los mazos y
-- las partidas del otro aunque su perfil no sea público. La colección sigue siendo solo para los
-- perfiles públicos.
--
-- Partida espejo: al apuntar una partida contra un amigo con cuenta (opponent_id), él la ve y puede
-- guardarla en su historial con el resultado al revés. Esa copia es una partida suya con
-- mirror_of = la partida original. Si no la quiere, se guarda igual pero ya borrada (deleted_at),
-- así deja de salirle el aviso sin hacer falta otra tabla.
--
-- Se puede ejecutar más de una vez.

-- ---------- Amigos ----------

-- ¿Se siguen a y b mutuamente? Security definer: la usan las políticas y los triggers.
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a is not null and b is not null and a <> b
    and exists (select 1 from public.follows where follower_id = a and followee_id = b)
    and exists (select 1 from public.follows where follower_id = b and followee_id = a);
$$;

revoke execute on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to anon, authenticated;

-- Mazos: los míos; de otros, los no borrados que sean públicos, de un perfil público o de un amigo.
drop policy if exists "mazos: leer los míos o públicos" on public.decks;
drop policy if exists "mazos: leer los míos, públicos o de amigos" on public.decks;
create policy "mazos: leer los míos, públicos o de amigos" on public.decks
  for select using (
    user_id = (select auth.uid())
    or (deleted_at is null and (
      is_public
      or public.is_public_profile(user_id)
      or public.are_friends((select auth.uid()), user_id)
    ))
  );

-- Partidas: las mías, aquellas en las que yo era el rival, las de perfiles públicos y las de amigos.
drop policy if exists "partidas: leer" on public.matches;
create policy "partidas: leer" on public.matches
  for select using (
    user_id = (select auth.uid())
    or opponent_id = (select auth.uid())
    or public.is_public_profile(user_id)
    or public.are_friends((select auth.uid()), user_id)
  );

-- ---------- Partida espejo ----------

alter table public.matches add column if not exists mirror_of uuid references public.matches (id) on delete set null;

-- Una sola copia de cada partida por cuenta.
create unique index if not exists matches_mirror on public.matches (user_id, mirror_of) where mirror_of is not null;

-- Comprobaciones al apuntar o cambiar una partida (solo si cambia el rival o la original, para que
-- dejar de ser amigos no impida corregir las notas de una partida antigua):
--   · el rival con cuenta tiene que ser un amigo (así nadie llena de avisos a desconocidos);
--   · una copia solo puede ser de una partida en la que tú eras el rival.
create or replace function public.check_match_links() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.opponent_id is not null
     and (tg_op = 'INSERT' or new.opponent_id is distinct from old.opponent_id)
     and not public.are_friends(new.user_id, new.opponent_id) then
    raise exception 'RIVAL_NO_AMIGO: el rival tiene que ser un amigo (os seguís los dos)';
  end if;
  if new.mirror_of is not null
     and (tg_op = 'INSERT' or new.mirror_of is distinct from old.mirror_of)
     and not exists (select 1 from public.matches o where o.id = new.mirror_of and o.opponent_id = new.user_id) then
    raise exception 'ESPEJO_NO_VALIDO: solo puedes copiar partidas en las que eras el rival';
  end if;
  return new;
end $$;

revoke execute on function public.check_match_links() from public, anon, authenticated;

drop trigger if exists matches_check_links on public.matches;
create trigger matches_check_links before insert or update on public.matches
  for each row execute function public.check_match_links();
