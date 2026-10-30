-- Fase 1: cuentas, colección y mazos sincronizados en la nube.
--
-- Las cartas no se guardan aquí: siguen en web/data/cards.json (se actualiza cada noche).
-- La base de datos solo guarda ids de carta ("ven-116-166") y cantidades, como hoy el localStorage.
--
-- Seguridad: todas las tablas tienen RLS. Cada usuario solo puede escribir lo suyo; lo de otros
-- solo se lee si lo ha hecho público. La clave "anon" que va en la web puede ser pública.

create extension if not exists citext;

-- ---------- Utilidades ----------

-- Pone updated_at al día en cada UPDATE (la sincronización pide "lo que cambió desde X").
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Perfiles ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username citext not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  bio text check (char_length(bio) <= 280),
  city text check (char_length(city) <= 60), -- para intercambios en persona (fase 4)
  is_public boolean not null default false,  -- colección, mazos y estadísticas visibles para otros
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Al crear la cuenta se crea su perfil con el usuario elegido (viene en los metadatos del alta).
-- Sin usuario válido el alta falla, así que no puede haber cuentas sin nombre.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end $$;

create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- El nombre de usuario lo ven todos los que han iniciado sesión (hace falta para intercambios y
-- partidas contra otros); sin sesión, solo los perfiles públicos (enlaces para compartir).
drop policy if exists "perfiles: leer con sesión" on public.profiles;
create policy "perfiles: leer con sesión" on public.profiles
  for select to authenticated using (true);
drop policy if exists "perfiles: leer públicos sin sesión" on public.profiles;
create policy "perfiles: leer públicos sin sesión" on public.profiles
  for select to anon using (is_public);
drop policy if exists "perfiles: editar el mío" on public.profiles;
create policy "perfiles: editar el mío" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Sin política de INSERT ni DELETE: el perfil lo crea el alta y se borra con la cuenta.

-- ¿Es público el perfil de este usuario? Lo usan las políticas de las demás tablas.
create or replace function public.is_public_profile(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_public from public.profiles where id = uid), false);
$$;

-- ---------- Colección ----------
-- Una fila por carta: { normal, foil }, igual que rb.collection.v1. Una fila a 0 equivale a no tenerla
-- (sirve para que otros dispositivos se enteren de que se quitó).

create table if not exists public.collection_items (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  card_id text not null check (char_length(card_id) <= 40),
  normal integer not null default 0 check (normal >= 0),
  foil integer not null default 0 check (foil >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create index if not exists collection_items_sync on public.collection_items (user_id, updated_at);
create or replace trigger collection_items_updated_at before update on public.collection_items
  for each row execute function public.set_updated_at();

alter table public.collection_items enable row level security;

drop policy if exists "colección: leer la mía o pública" on public.collection_items;
create policy "colección: leer la mía o pública" on public.collection_items
  for select using (user_id = (select auth.uid()) or public.is_public_profile(user_id));
drop policy if exists "colección: añadir a la mía" on public.collection_items;
create policy "colección: añadir a la mía" on public.collection_items
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "colección: cambiar la mía" on public.collection_items;
create policy "colección: cambiar la mía" on public.collection_items
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "colección: borrar de la mía" on public.collection_items;
create policy "colección: borrar de la mía" on public.collection_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- Mazos ----------
-- Mismo formato que rb.decks.v1: main, runes y sideboard son { cardId: copias }.
-- El id lo genera la app (crypto.randomUUID), por eso es texto y va con el usuario en la clave.

create table if not exists public.decks (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  id text not null check (char_length(id) <= 64),
  name text not null check (char_length(name) between 1 and 80),
  legend_id text,
  champion_id text,
  main jsonb not null default '{}'::jsonb,
  runes jsonb not null default '{}'::jsonb,
  battlefields text[] not null default '{}',
  sideboard jsonb not null default '{}'::jsonb,
  is_public boolean not null default false, -- se puede compartir un mazo aunque el perfil no sea público
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz, -- borrado "suave": así los demás dispositivos saben que se borró
  primary key (user_id, id)
);

create index if not exists decks_sync on public.decks (user_id, updated_at);
create index if not exists decks_public on public.decks (updated_at desc) where is_public and deleted_at is null;
create or replace trigger decks_updated_at before update on public.decks
  for each row execute function public.set_updated_at();

alter table public.decks enable row level security;

drop policy if exists "mazos: leer los míos o públicos" on public.decks;
create policy "mazos: leer los míos o públicos" on public.decks
  for select using (
    user_id = (select auth.uid())
    or (deleted_at is null and (is_public or public.is_public_profile(user_id)))
  );
drop policy if exists "mazos: crear los míos" on public.decks;
create policy "mazos: crear los míos" on public.decks
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "mazos: cambiar los míos" on public.decks;
create policy "mazos: cambiar los míos" on public.decks
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "mazos: borrar los míos" on public.decks;
create policy "mazos: borrar los míos" on public.decks
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- Permisos de tabla ----------
-- RLS decide qué filas; esto decide qué operaciones existen para cada rol.
-- Supabase da todos los permisos por defecto; en perfiles se quitan para que el usuario (con el que
-- se inicia sesión) no se pueda cambiar ni crear perfiles a mano.

revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles, public.collection_items, public.decks to anon, authenticated;
grant update (display_name, bio, city, is_public) on public.profiles to authenticated;
grant insert, update, delete on public.collection_items, public.decks to authenticated;
grant execute on function public.is_public_profile(uuid) to anon, authenticated;
