-- Fase 4: intercambios. Cada usuario marca qué ofrece y qué busca; la base de datos cruza las
-- listas y propone con quién cambiar. Un intercambio es una propuesta con sus cartas y un estado.
--
-- Las listas son explícitas (no se ofrece nada de la colección sin marcarlo). Al completar un
-- intercambio la app suma y resta las copias en la colección de cada uno.

-- ---------- Ofrezco / Busco ----------
-- foil = true: la copia que ofrezco es foil / solo me vale foil. foil = false: normal / me vale cualquiera.

create table if not exists public.trade_list (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  card_id text not null check (char_length(card_id) <= 40),
  foil boolean not null default false,
  quantity smallint not null check (quantity between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id, foil)
);

create table if not exists public.want_list (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  card_id text not null check (char_length(card_id) <= 40),
  foil boolean not null default false,
  quantity smallint not null check (quantity between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id, foil)
);

create index if not exists trade_list_card on public.trade_list (card_id);
create index if not exists want_list_card on public.want_list (card_id);
create or replace trigger trade_list_updated_at before update on public.trade_list
  for each row execute function public.set_updated_at();
create or replace trigger want_list_updated_at before update on public.want_list
  for each row execute function public.set_updated_at();

alter table public.trade_list enable row level security;
alter table public.want_list enable row level security;

-- Las dos listas son visibles para quien tenga sesión: es lo que permite encontrar con quién cambiar.
drop policy if exists "ofrezco: leer con sesión" on public.trade_list;
create policy "ofrezco: leer con sesión" on public.trade_list
  for select to authenticated using (true);
drop policy if exists "ofrezco: añadir a la mía" on public.trade_list;
create policy "ofrezco: añadir a la mía" on public.trade_list
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "ofrezco: cambiar la mía" on public.trade_list;
create policy "ofrezco: cambiar la mía" on public.trade_list
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "ofrezco: borrar de la mía" on public.trade_list;
create policy "ofrezco: borrar de la mía" on public.trade_list
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "busco: leer con sesión" on public.want_list;
create policy "busco: leer con sesión" on public.want_list
  for select to authenticated using (true);
drop policy if exists "busco: añadir a la mía" on public.want_list;
create policy "busco: añadir a la mía" on public.want_list
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "busco: cambiar la mía" on public.want_list;
create policy "busco: cambiar la mía" on public.want_list
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "busco: borrar de la mía" on public.want_list;
create policy "busco: borrar de la mía" on public.want_list
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.trade_list, public.want_list to authenticated;

-- ---------- Con quién cambiar ----------
-- Jugadores que ofrecen cartas que busco y/o buscan cartas que ofrezco. Primero los que encajan
-- en los dos sentidos; luego por número de cartas en común. Con la ciudad de cada uno.

create or replace function public.trade_matches()
returns table (other_id uuid, other_username citext, other_city text, cards_they_have integer, cards_they_want integer)
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
  select p.id, p.username, p.city, coalesce(h.n, 0), coalesce(x.n, 0)
  from public.profiles p
  left join have h on h.uid = p.id
  left join want x on x.uid = p.id
  where h.uid is not null or x.uid is not null
  order by (h.uid is not null and x.uid is not null) desc, coalesce(h.n, 0) + coalesce(x.n, 0) desc
  limit 50;
$$;

revoke execute on function public.trade_matches() from public, anon;
grant execute on function public.trade_matches() to authenticated;

-- ---------- Propuestas de intercambio ----------

do $$ begin
  create type public.trade_status as enum ('pending', 'accepted', 'rejected', 'cancelled', 'completed');
exception when duplicate_object then null;
end $$;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  status public.trade_status not null default 'pending',
  message text check (char_length(message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposer_id <> receiver_id)
);

-- Cartas de la propuesta: from_user es quien entrega la carta (el que propone o el que recibe).
create table if not exists public.trade_items (
  trade_id uuid not null references public.trades (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  card_id text not null check (char_length(card_id) <= 40),
  foil boolean not null default false,
  quantity smallint not null check (quantity between 1 and 99),
  primary key (trade_id, from_user, card_id, foil)
);

create index if not exists trades_proposer on public.trades (proposer_id, updated_at desc);
create index if not exists trades_receiver on public.trades (receiver_id, updated_at desc);
create or replace trigger trades_updated_at before update on public.trades
  for each row execute function public.set_updated_at();

alter table public.trades enable row level security;
alter table public.trade_items enable row level security;

drop policy if exists "intercambios: leer los míos" on public.trades;
create policy "intercambios: leer los míos" on public.trades
  for select to authenticated
  using ((select auth.uid()) in (proposer_id, receiver_id));
drop policy if exists "intercambios: proponer" on public.trades;
create policy "intercambios: proponer" on public.trades
  for insert to authenticated
  with check (proposer_id = (select auth.uid()) and status = 'pending');
-- Sin política de UPDATE: el estado solo cambia con set_trade_status, que aplica las reglas.

-- ¿Participo en este intercambio? (para las políticas de trade_items)
create or replace function public.is_trade_participant(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trades
    where id = tid and (select auth.uid()) in (proposer_id, receiver_id)
  );
$$;

-- ¿Soy quien propuso este intercambio y sigue pendiente? (solo entonces se le añaden cartas)
create or replace function public.can_edit_trade(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trades
    where id = tid and proposer_id = (select auth.uid()) and status = 'pending'
  );
$$;

drop policy if exists "cartas del intercambio: leer" on public.trade_items;
create policy "cartas del intercambio: leer" on public.trade_items
  for select to authenticated using (public.is_trade_participant(trade_id));
drop policy if exists "cartas del intercambio: añadir" on public.trade_items;
create policy "cartas del intercambio: añadir" on public.trade_items
  for insert to authenticated with check (
    public.can_edit_trade(trade_id)
    and from_user in (
      select proposer_id from public.trades where id = trade_id
      union all
      select receiver_id from public.trades where id = trade_id
    )
  );
drop policy if exists "cartas del intercambio: quitar" on public.trade_items;
create policy "cartas del intercambio: quitar" on public.trade_items
  for delete to authenticated using (public.can_edit_trade(trade_id));

grant select, insert on public.trades to authenticated;
grant select, insert, delete on public.trade_items to authenticated;
grant execute on function public.is_trade_participant(uuid), public.can_edit_trade(uuid) to authenticated;

-- Cambia el estado respetando quién puede hacer qué:
--   pendiente → aceptado / rechazado (quien recibe) · pendiente → cancelado (quien propone)
--   aceptado → completado / cancelado (cualquiera de los dos)
create or replace function public.set_trade_status(p_trade uuid, p_status public.trade_status)
returns public.trades
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  t public.trades;
begin
  select * into t from public.trades where id = p_trade for update;
  if not found or me is null or me not in (t.proposer_id, t.receiver_id) then
    raise exception 'Intercambio no encontrado';
  end if;
  if not (
    (t.status = 'pending' and p_status in ('accepted', 'rejected') and me = t.receiver_id)
    or (t.status = 'pending' and p_status = 'cancelled' and me = t.proposer_id)
    or (t.status = 'accepted' and p_status in ('completed', 'cancelled'))
  ) then
    raise exception 'No se puede pasar de % a %', t.status, p_status;
  end if;
  update public.trades set status = p_status where id = p_trade returning * into t;
  return t;
end $$;

revoke execute on function public.set_trade_status(uuid, public.trade_status) from public, anon;
grant execute on function public.set_trade_status(uuid, public.trade_status) to authenticated;
