# Base de datos (Supabase)

Esquema para las cuentas y las fases que vienen. Cada archivo es una fase y se ejecuta en orden, en
el editor SQL de Supabase. Se pueden ejecutar todos ya: las tablas de fases futuras no molestan
aunque la app aún no las use.

| Archivo | Fase | Tablas |
| --- | --- | --- |
| `01_cuentas.sql` | 1 · Cuentas y sincronización | `profiles`, `collection_items`, `decks` |
| `02_partidas.sql` | 2 · Registro de partidas | `matches` y las vistas `deck_stats`, `matchup_stats` |
| `03_social.sql` | 3 · Social y estadísticas | `follows` y la vista `profile_stats` |
| `04_intercambios.sql` | 4 · Intercambios | `trade_list`, `want_list`, `trades`, `trade_items` y la función `trade_matches()` |
| `05_limite_mazos.sql` | — | Límite de 15 mazos por cuenta (los borrados no cuentan) |
| `06_perfil_que_falta.sql` | — | Rellena los perfiles que falten y crea `ensure_profile()`, con la que la app repara el suyo |
| `07_partidas_sync.sql` | 2 · Registro de partidas | Puntos de cada juego y borrado sincronizado (`deleted_at`) en `matches` |
| `08_amigos.sql` | 3 · Social | Amigos (os seguís los dos) con `are_friends()`, y la partida espejo (`matches.mirror_of`) |
| `09_intercambios_amigos.sql` | 4 · Intercambios | Solo entre amigos: `propose_trade()`, contraoferta (`counter_of`) y `mark_trade_applied()` |
| `10_balance.sql` | — | Balance de compras y ventas (`ledger`), con borrado sincronizado (`deleted_at`) |
| `11_correcciones.sql` | — | Corrige los triggers de mazos y partidas con upsert, oculta lo borrado a otros y añade `my_friends()`, límites de tamaño e índices |
| `12_campos_partida.sql` | 2 · Registro de partidas | Campo de batalla de cada uno en cada juego (`matches.battlefields`) |

Las cartas no están en la base de datos: siguen en `web/data/cards.json`. Las tablas guardan el id
de la carta (`ven-116-166`) y la app lo cruza con ese archivo, como hace hoy con el `localStorage`.

## Puesta en marcha

1. Crear un proyecto en [supabase.com](https://supabase.com) (plan gratuito).
2. **Authentication → Sign In / Providers → Email:** activado, con **"Confirm email" activado**
   (la cuenta se confirma con un enlace al correo; así no se pueden crear cuentas sin límite).
   **Authentication → Emails → SMTP Settings:** un SMTP propio para que los correos lleguen (se usa
   Brevo: `smtp-relay.brevo.com`, puerto 587, con su usuario y clave SMTP; en Brevo, sin bloqueo de
   IP para las claves SMTP). El SMTP de prueba de Supabase solo envía a los miembros del proyecto.
3. **SQL Editor:** pegar y ejecutar `01_cuentas.sql`, luego `02` a `12`, en orden. Para repetir un archivo,
   repite también todos los siguientes: cada uno cambia cosas de los anteriores, y uno suelto desharía esos cambios.
4. **Project Settings → API:** copiar la *Project URL* y la clave *anon / publishable*. Son las únicas
   que van en la web. La clave *service_role / secret* no se pone nunca en la web.
5. **Authentication → URL Configuration:** *Site URL* `https://bertox22.github.io/riftbound-scanner/`
   y en *Redirect URLs* las direcciones desde las que se usa la app
   (`https://bertox22.github.io/riftbound-scanner/` y `http://localhost:8000/`): los enlaces de
   confirmar cuenta y de nueva contraseña vuelven ahí.

## Seguridad

- Todas las tablas tienen RLS: cada usuario solo escribe lo suyo.
- Colección, mazos y partidas de otros solo se leen si su perfil es público (`profiles.is_public`).
  Un mazo suelto se puede compartir con `decks.is_public` aunque el perfil no lo sea. Los amigos
  (dos cuentas que se siguen mutuamente) ven los mazos y las partidas del otro; la colección, no.
  Lo borrado (`deleted_at`) y las cartas a 0 solo los ve su dueño.
- Una partida solo puede llevar como rival con cuenta (`opponent_id`) a un amigo, y una copia
  (`mirror_of`) solo puede ser de una partida en la que eras el rival; si no lo es, se guarda sin el
  enlace. Lo comprueba un trigger (`check_match_links`) solo cuando cambian esos campos, así que
  dejar de ser amigos no bloquea editar partidas antiguas.
- Las listas de "ofrezco" y "busco" solo las ves tú y tus amigos, y `trade_matches()` solo busca entre ellos.
- Un intercambio solo se crea con `propose_trade()`, que exige que seáis amigos y al menos una carta.
  El estado solo cambia con `set_trade_status()`, que comprueba quién puede hacer qué (quien recibe
  acepta o rechaza; quien propone puede cancelar; aceptado, cualquiera lo marca hecho o lo cancela).
- Cada uno solo escribe en su colección: al completarse, cada app aplica su lado después de que
  `mark_trade_applied()` devuelva true, cosa que solo pasa la primera vez para cada lado.
- El balance (`ledger`) solo lo lee y lo escribe su dueño.
- El nombre de usuario no se puede cambiar desde la web (las cuentas antiguas inician sesión con él).
- El perfil (`profiles`) lo crea el alta. No hay que borrar filas de `profiles` a mano: se borra en
  cascada todo lo de esa cuenta (colección, mazos, partidas, amigos, intercambios y balance). Si
  falta, `ensure_profile()` lo vuelve a crear (vacío).
