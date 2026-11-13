-- Notas y versiones de cada mazo.
--   · decks.notes: texto libre (plan de juego, cambios contra cada rival…), hasta 4.000 caracteres.
--   · decks.versions: las versiones que guarda el usuario con «Guardar versión», de la más antigua a
--     la más nueva: [{ id, at (ms), note, deck: { legend, champion, main, runes, battlefields,
--     sideboard } }]. La app guarda como mucho 20; las estadísticas por versión se calculan con la
--     fecha de cada partida.
-- Se ven igual que el mazo: tú, tus amigos y, si el mazo está compartido, quien tenga el enlace.
-- Mientras no se ejecute este archivo, la app sube los mazos sin notas ni versiones (se quedan en
-- el dispositivo) y las sube en cuanto existan las columnas.
--
-- Se puede ejecutar más de una vez. Hace falta haber ejecutado antes del 01 al 14.

alter table public.decks add column if not exists notes text;
alter table public.decks add column if not exists versions jsonb;

-- Holgado: 20 versiones de un mazo de 60 cartas distintas ocupan unos 40 KB.
alter table public.decks drop constraint if exists decks_notas_versiones_check;
alter table public.decks add constraint decks_notas_versiones_check check (
  (notes is null or char_length(notes) <= 4000)
  and (versions is null or (
    jsonb_typeof(versions) = 'array'
    and jsonb_array_length(versions) <= 20
    and octet_length(versions::text) <= 131072
  ))
) not valid;

-- Que PostgREST vea las columnas nuevas sin esperar.
notify pgrst, 'reload schema';
