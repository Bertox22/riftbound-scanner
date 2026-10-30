# Base de datos (Supabase)

Esquema para las cuentas y las fases que vienen. Cada archivo es una fase y se ejecuta una vez,
en orden, en el editor SQL de Supabase. Se pueden ejecutar todos ya: las tablas de fases futuras no
molestan aunque la app aún no las use.

| Archivo | Fase | Tablas |
| --- | --- | --- |
| `01_cuentas.sql` | 1 · Cuentas y sincronización | `profiles`, `collection_items`, `decks` |
| `02_partidas.sql` | 2 · Registro de partidas | `matches` y las vistas `deck_stats`, `matchup_stats` |
| `03_social.sql` | 3 · Social y estadísticas | `follows` y la vista `profile_stats` |
| `04_intercambios.sql` | 4 · Intercambios | `trade_list`, `want_list`, `trades`, `trade_items` y la función `trade_matches()` |
| `05_limite_mazos.sql` | — | Límite de 15 mazos por cuenta (los borrados no cuentan) |
| `06_perfil_que_falta.sql` | — | Rellena los perfiles que falten y crea `ensure_profile()`, con la que la app repara el suyo |

Las cartas no están en la base de datos: siguen en `web/data/cards.json`. Las tablas guardan el id
de la carta (`ven-116-166`) y la app lo cruza con ese archivo, como hace hoy con el `localStorage`.

## Puesta en marcha

1. Crear un proyecto en [supabase.com](https://supabase.com) (plan gratuito).
2. **Authentication → Sign In / Providers → Email:** activado, y **"Confirm email" desactivado**
   (el inicio de sesión será con usuario y contraseña; la app convierte el usuario en un correo
   interno que no recibe nada).
3. **SQL Editor:** pegar y ejecutar `01_cuentas.sql`, luego `02`, `03`, `04`, `05` y `06`. Se pueden repetir sin problema.
4. **Project Settings → API:** copiar la *Project URL* y la clave *anon / publishable*. Son las únicas
   que van en la web. La clave *service_role / secret* no se pone nunca en la web.
5. **Authentication → URL Configuration:** añadir las direcciones desde las que se usa la app
   (`https://bertox22.github.io` y `http://localhost:8000`).

## Seguridad

- Todas las tablas tienen RLS: cada usuario solo escribe lo suyo.
- Colección, mazos y partidas de otros solo se leen si su perfil es público (`profiles.is_public`).
  Un mazo suelto se puede compartir con `decks.is_public` aunque el perfil no lo sea.
- Las listas de "ofrezco" y "busco" las ven todos los que tienen sesión: es lo que permite encontrar
  con quién cambiar.
- El estado de un intercambio solo cambia con `set_trade_status()`, que comprueba quién puede hacer
  qué (quien recibe acepta o rechaza; quien propone puede cancelar).
- El nombre de usuario no se puede cambiar desde la web, porque es con lo que se inicia sesión.
