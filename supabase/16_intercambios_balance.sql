-- Intercambios en el balance: cartas que das y recibes, con o sin dinero de por medio.
--   · ledger.kind admite 'trade'.
--   · ledger.details (solo en los intercambios): { cash, mode, give, get }
--       cash: dinero del intercambio (+ lo recibes, − lo pagas); unit_price guarda su valor absoluto.
--       mode: 'day' (precio de Cardmarket de ese día) o 'manual'.
--       give / get: [{ card, foil, qty, value (€ por copia) }]; en get, también ownedBefore.
-- Mientras no se ejecute este archivo, la app sube el resto del balance y deja los intercambios en el
-- dispositivo; los sube en cuanto exista la columna.
--
-- Se puede ejecutar más de una vez. Hace falta haber ejecutado antes el 10.

alter table public.ledger add column if not exists details jsonb;

alter table public.ledger drop constraint if exists ledger_kind_check;
alter table public.ledger add constraint ledger_kind_check check (kind in ('buy', 'sell', 'trade'));

-- Holgado: 30 cartas por lado ocupan unos 5 KB.
alter table public.ledger drop constraint if exists ledger_details_check;
alter table public.ledger add constraint ledger_details_check check (
  details is null or (
    jsonb_typeof(details) = 'object'
    and jsonb_typeof(details -> 'give') = 'array'
    and jsonb_typeof(details -> 'get') = 'array'
    and jsonb_array_length(details -> 'give') <= 30
    and jsonb_array_length(details -> 'get') <= 30
    and octet_length(details::text) <= 32768
  )
) not valid;

-- Que PostgREST vea la columna nueva sin esperar.
notify pgrst, 'reload schema';
