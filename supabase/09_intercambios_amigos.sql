-- Fase 4: intercambios solo entre amigos.
--
-- Cambios sobre 04_intercambios.sql:
--   · Las listas de "ofrezco" y "busco" solo las ven tus amigos, y trade_matches() solo busca entre ellos.
--   · Una propuesta se crea con propose_trade(), de una vez con sus cartas: comprueba que sois amigos
--     y que hay al menos una carta (uno de los dos lados puede ir vacío, para regalar o pedir).
--   · Contraoferta: propose_trade() con p_counter_of rechaza la propuesta recibida y crea la nueva.
--   · Cada uno solo escribe en su colección, así que al completarse cada lado aplica sus cartas. Con
--     mark_trade_applied() se apunta, para que dos dispositivos no las apliquen dos veces.
--
-- Se puede ejecutar más de una vez.

-- ---------- Listas: solo amigos ----------

drop policy if exists "ofrezco: leer con sesión" on public.trade_list;
drop policy if exists "ofrezco: leer la mía o de amigos" on public.trade_list;
create policy "ofrezco: leer la mía o de amigos" on public.trade_list
  for select to authenticated using (
    user_id = (select auth.uid()) or public.are_friends((select auth.uid()), user_id)
  );

drop policy if exists "busco: leer con sesión" on public.want_list;
drop policy if exists "busco: leer la mía o de amigos" on public.want_list;
create policy "busco: leer la mía o de amigos" on public.want_list
  for select to authenticated using (
    user_id = (select auth.uid()) or public.are_friends((select auth.uid()), user_id)
  );

-- Amigos que ofrecen cartas que busco y/o buscan cartas que ofrezco. Primero los que encajan en los
-- dos sentidos; luego por número de cartas en común.
drop function if exists public.trade_matches();
create function public.trade_matches()
returns table (other_id uuid, other_username text, other_display_name text, cards_they_have integer, cards_they_want integer)
language sql stable security invoker set search_path = '' as $$
  with have as (
    select t.user_id as uid, count(distinct t.card_id)::integer as n
    from public.want_list w
    join public.trade_list t on t.card_id = w.card_id and (t.foil or not w.foil)
    where w.user_id = (select auth.uid()) and t.user_id <> w.user_id
    group by t.user_id
  ),
  want as (
    select w.user_id as uid, count(distinct w.card_id)::integer as n
    from public.trade_list t
    join public.want_list w on w.card_id = t.card_id and (t.foil or not w.foil)
    where t.user_id = (select auth.uid()) and w.user_id <> t.user_id
    group by w.user_id
  )
  select p.id, p.username::text, p.display_name, coalesce(h.n, 0), coalesce(x.n, 0)
  from public.profiles p
  left join have h on h.uid = p.id
  left join want x on x.uid = p.id
  where (h.uid is not null or x.uid is not null)
    and public.are_friends((select auth.uid()), p.id)
  order by (h.uid is not null and x.uid is not null) desc, coalesce(h.n, 0) + coalesce(x.n, 0) desc
  limit 50;
$$;

revoke execute on function public.trade_matches() from public, anon;
grant execute on function public.trade_matches() to authenticated;

-- ---------- Propuestas ----------

alter table public.trades add column if not exists counter_of uuid references public.trades (id) on delete set null;
alter table public.trades add column if not exists proposer_applied_at timestamptz;
alter table public.trades add column if not exists receiver_applied_at timestamptz;

-- Las propuestas ya no se escriben directamente en las tablas: solo con propose_trade().
drop policy if exists "intercambios: proponer" on public.trades;
drop policy if exists "cartas del intercambio: añadir" on public.trade_items;
drop policy if exists "cartas del intercambio: quitar" on public.trade_items;
drop function if exists public.can_edit_trade(uuid);
revoke insert on public.trades from authenticated;
revoke insert, delete on public.trade_items from authenticated;

-- Crea una propuesta con sus cartas. p_items: [{ "mine": true si la entrego yo, "card_id", "foil", "quantity" }].
create or replace function public.propose_trade(p_receiver uuid, p_items jsonb, p_message text default null, p_counter_of uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  new_id uuid;
begin
  if not public.are_friends(me, p_receiver) then
    raise exception 'NO_AMIGO: solo puedes proponer intercambios a tus amigos';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'SIN_CARTAS: el intercambio necesita al menos una carta';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'SIN_CARTAS: el intercambio necesita entre 1 y 100 cartas distintas';
  end if;
  if p_counter_of is not null then
    update public.trades set status = 'rejected'
    where id = p_counter_of and status = 'pending' and receiver_id = me and proposer_id = p_receiver;
    if not found then
      raise exception 'CONTRAOFERTA_NO_VALIDA: esa propuesta ya no está pendiente';
    end if;
  end if;
  insert into public.trades (proposer_id, receiver_id, message, counter_of)
  values (me, p_receiver, nullif(trim(p_message), ''), p_counter_of)
  returning id into new_id;
  insert into public.trade_items (trade_id, from_user, card_id, foil, quantity)
  select new_id, case when i.mine is true then me else p_receiver end, i.card_id, coalesce(i.foil, false), i.quantity
  from jsonb_to_recordset(p_items) as i (mine boolean, card_id text, foil boolean, quantity smallint);
  return new_id;
end $$;

revoke execute on function public.propose_trade(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.propose_trade(uuid, jsonb, text, uuid) to authenticated;

-- Apunta que mi lado de un intercambio completado ya está en mi colección. Devuelve true solo la
-- primera vez: la app aplica las cartas únicamente si recibe true.
create or replace function public.mark_trade_applied(p_trade uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  update public.trades set
    proposer_applied_at = case when proposer_id = me then now() else proposer_applied_at end,
    receiver_applied_at = case when receiver_id = me then now() else receiver_applied_at end
  where id = p_trade and status = 'completed'
    and ((proposer_id = me and proposer_applied_at is null) or (receiver_id = me and receiver_applied_at is null));
  return found;
end $$;

revoke execute on function public.mark_trade_applied(uuid) from public, anon;
grant execute on function public.mark_trade_applied(uuid) to authenticated;
