-- Balance: las compras y ventas que apunta cada uno (cajas, sobres, cartas sueltas…).
--
-- Solo las ve su dueño. Se sincroniza como las partidas: lo borrado se marca con deleted_at para que
-- el borrado llegue a los demás dispositivos.
--
-- Se puede ejecutar más de una vez.

create table if not exists public.ledger (
  id uuid primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('buy', 'sell')),
  occurred_at timestamptz not null default now(),
  label text check (char_length(label) <= 120), -- el producto, si no es una carta ("Caja Vendetta")
  card_id text check (char_length(card_id) <= 40),
  foil boolean not null default false,
  quantity smallint not null default 1 check (quantity between 1 and 999),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  owned_before smallint, -- compra de una carta: copias que tenías, para saber si ya la has añadido
  in_collection boolean not null default false, -- compra de una carta: ya está en la colección
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (label is not null or card_id is not null)
);

create index if not exists ledger_sync on public.ledger (user_id, updated_at);
create or replace trigger ledger_updated_at before update on public.ledger
  for each row execute function public.set_updated_at();

alter table public.ledger enable row level security;

drop policy if exists "balance: leer el mío" on public.ledger;
create policy "balance: leer el mío" on public.ledger
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "balance: añadir al mío" on public.ledger;
create policy "balance: añadir al mío" on public.ledger
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "balance: cambiar el mío" on public.ledger;
create policy "balance: cambiar el mío" on public.ledger
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.ledger from anon;
grant select, insert, update on public.ledger to authenticated;
