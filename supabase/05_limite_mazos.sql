-- Límite de 15 mazos por cuenta. Los mazos borrados (deleted_at) no cuentan.
-- Salta al crear un mazo nuevo y al recuperar uno borrado; editar los que ya hay no cuenta.
-- La app también lo comprueba antes, así que normalmente nadie llega a ver este error.

create or replace function public.check_deck_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    if (select count(*) from public.decks
        where user_id = new.user_id and deleted_at is null and id <> new.id) >= 15 then
      raise exception 'LIMITE_MAZOS: como máximo 15 mazos por cuenta'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace trigger decks_limit before insert or update on public.decks
  for each row execute function public.check_deck_limit();
