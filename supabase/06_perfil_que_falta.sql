-- Cuentas sin perfil. El perfil lo crea el alta (handle_new_user), pero si una fila de profiles se
-- borra a mano la cuenta sigue entrando y nada se puede subir: colección y mazos apuntan a profiles.
-- Esto rellena los que falten ahora y deja una función para que la app repare el suyo sola.

-- Nombre para el perfil: el del alta o, si no hay o ya está cogido, uno sacado del id.
create or replace function public.profile_username(u auth.users) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when u.raw_user_meta_data ->> 'username' ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles p
                     where lower(p.username::text) = lower(u.raw_user_meta_data ->> 'username') and p.id <> u.id)
    then u.raw_user_meta_data ->> 'username'
    else 'u_' || left(replace(u.id::text, '-', ''), 12)
  end;
$$;

revoke execute on function public.profile_username(auth.users) from public, anon, authenticated;

-- Crea el perfil de quien la llama si no lo tiene. No hace nada si ya existe.
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  select u.id, public.profile_username(u) from auth.users u where u.id = (select auth.uid())
  on conflict (id) do nothing;
end $$;

revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

-- Los que faltan ahora mismo.
insert into public.profiles (id, username)
select u.id, public.profile_username(u)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;
