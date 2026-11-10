# Riftbound Scanner

Aplicación web para registrar tu colección de cartas de **Riftbound** con la cámara del móvil,
armar mazos con las cartas que tienes y apuntar tus partidas. Con una cuenta, todo se sincroniza
entre tus dispositivos.

**App:** https://bertox22.github.io/riftbound-scanner/

- **Escanear:** pones cada carta dentro del recuadro y se añade sola en cuanto la reconoce (con
  vibración y pitido). Si duda, te enseña las candidatas para que toques la correcta. Para añadir
  varias copias iguales seguidas basta con retirar la carta del recuadro y poner la siguiente.
  Cada carta escaneada tiene su fila con − n + (suma o quita copias de la colección al momento; con
  0 desaparece) y al tocarla se abre una hoja con copias normales y foil, la versión, la ficha y
  "Quitar".
- **Colección:** filtros por set, tipo (incluido "Campeón", que son las unidades Campeón) y dominio,
  cantidades normales/foil, exportación a Excel/CSV y copia de seguridad en JSON.
  - Al quitar la última copia con «−», la carta se queda en gris (no desaparece) y el aviso deja
    **Deshacer**.
  - **Historial:** las cartas que has quitado (cuántas, si eran foil, cuándo y desde dónde: la
    colección, la ficha, el escáner u otro dispositivo), cada una con «Deshacer». Con cuenta también
    salen las que se quedaron a 0 en la nube, para recuperar las quitadas antes del historial.
  - **Balance:** apuntas a mano lo que compras y vendes, ya sean productos (una caja, sobres…) o
    cartas sueltas, con cantidad, precio por unidad y fecha, y ves el total (dos cajas a 35 € y una a
    35 € son −105 €; vender una carta por 6 € lo deja en −99 €). Solo se venden cartas que tienes:
    salen de la colección, quedan en el Historial como «venta» y vuelven si borras la venta. Comprar una
    carta no la añade: avisa «No la has incluido en la colección» hasta que la tengas, con un botón
    «Añadir». Con cuenta se sincroniza entre tus dispositivos y solo lo ves tú. Es tu cuenta de gastos:
    no usa los precios de Cardmarket.
- **Importar:** cualquier Excel o CSV (o una lista pegada tipo "3x Arena Kingpin"). La app adivina
  las columnas (código, set, nº, nombre, copias, foil), busca cada carta por código, por nombre o
  por nombre aproximado, y enseña todo para revisarlo antes de sumar o reemplazar la colección.
- **Mazos:** Leyenda, Campeón, mazo principal (40), Runas (12), Campos de batalla (3) y sideboard
  (hasta 10 cartas, que cuentan para el máximo de 3 copias; se pasan cartas 1 por 1 entre mazo y
  sideboard), con validación de reglas (dominios, máximo 3 copias, cartas de firma) y aviso de las
  cartas que te faltan. Como máximo 15 mazos (la lista muestra el contador x/15).
  - El editor es un tablero visual: Leyenda y Campeón | principal; debajo Runas | Campos de
    batalla; y el sideboard en su propia fila. Cada carta lleva su cantidad (− n +), la flecha para
    pasarla entre mazo y sideboard y las copias que te faltan como "-n" (también los campos).
  - Las casillas "+ Añadir…" abren una hoja para añadir varias cartas seguidas, con su propio filtro
    "Solo las que tengo". Las runas se limitan a los dominios de la Leyenda.
  - Cada mazo se exporta desde su botón en "Mis mazos" (sin entrar en el editor) como lista de
    texto, Excel o CSV, o se copia la lista. El Excel abre con la hoja "Mazo" (la lista completa por
    secciones con copias, código, tipo, coste, si la tienes y precio) y detrás el resumen (curva,
    avisos, cartas que faltan) y la tabla detallada. También se exportan todos a la vez.
  - En "Mis mazos" cada mazo con partidas muestra su balance (p. ej. "7–3 · 70 %") y el botón del
    trofeo apunta una partida con ese mazo ya elegido.
  - Se pueden importar listas de cualquier web (secciones Legend/Champion/Main Deck/Runes/Battlefields
    opcionales: lo que no tenga sección se coloca por tipo de carta) o archivos .txt, CSV y Excel.
- **Partidas:** al acabar una partida apuntas el resultado, tu mazo, la Leyenda del rival (cada
  Leyenda sale una vez aunque tenga versión foil, Metal o Signature), los puntos de cada juego
  (8–7, o hasta 3 juegos al mejor de 3: el resultado y el marcador se marcan solos), quién empezó
  (al mejor de 3, cada juego), el evento, la fecha y notas. El marcador admite 3–0 y 0–3 por si se
  juega el tercer juego aunque ya haya ganador. Si el rival es un amigo, eliges también con cuál de
  sus mazos jugó (y su Leyenda se pone sola). Las estadísticas muestran el porcentaje de victorias (sin contar
  empates), el balance V–D–E, cómo te va empezando tú o el rival, y los resultados por mazo y contra
  cada Leyenda, con un filtro por mazo.
- **Mesa (marcador en vivo):** en Partidas, «Iniciar partida» pide tu mazo (o tu Leyenda), el
  rival (te sugiere cuentas al escribir; si no tiene cuenta, basta su nombre; si es un amigo, también
  su mazo), su Leyenda, si es a un
  juego o al mejor de 3 y a cuántos puntos. La mesa ocupa toda la pantalla: cada jugador tiene su
  mitad (la del rival, girada), teñida con el color del dominio de su Leyenda, con sus puntos en
  grande, una pista hasta los puntos de victoria y los botones − y + en su borde (tocar el número
  también suma). Llegar a los puntos solo avisa («Gana el juego», en dorado): los juegos se cierran a
  mano con «Siguiente». La barra del medio tiene salir, «Sortear» (antes del primer punto: quien gana
  elige en su mitad si empieza o empieza el otro, y eso queda apuntado en la partida; en los
  siguientes juegos elige quien perdió el anterior, y queda apuntado quién empezó cada uno), el juego
  y el marcador, reiniciar y «Terminar». Con 2–0, «Jugar el 3.º» deja jugar el tercer juego igualmente
  (la partida acaba 3–0 o 2–1). Al terminar, la
  partida se guarda sola en tu historial (y si el rival es un amigo, le llega como partida espejo).
  La pantalla no se apaga y una recarga no pierde la partida.
- **Cuenta (opcional):** el botón de la barra superior abre la cuenta. Con ella, colección, mazos y
  partidas se guardan en la nube y aparecen en todos tus dispositivos. Sin cuenta la app funciona
  igual, solo en el dispositivo. Ver [Cuentas y sincronización](#cuentas-y-sincronización).
- **Perfil y amigos (con cuenta):**
  - En la cuenta editas tu perfil (nombre visible, ciudad, «Sobre ti») y eliges si es público.
    Cada mazo se puede compartir por separado desde el editor («Compartir este mazo»).
  - Tu perfil tiene su enlace, `#@usuario` (y `#@usuario/mazo` para un mazo): muestra tus
    estadísticas, las Leyendas que más juegas y los mazos que compartes. Los perfiles públicos se
    ven sin cuenta.
  - Con el botón de la lupa (arriba, junto a la cuenta) buscas jugadores y los sigues. Si os seguís los dos sois amigos: veis los mazos y
    las partidas del otro aunque el perfil sea privado.
  - **Partida espejo:** al apuntar una partida puedes elegir a un amigo como rival. A él le aparece
    en Partidas para guardarla en su historial con todo al revés (resultado, marcador, puntos,
    Leyendas, quién empezó cada juego y los mazos: el que apuntó como tuyo pasa a ser tu mazo) o
    descartarla. En su perfil ves vuestro cara a cara («Tú contra X»).
  - **¿Cuánto me falta?:** en el mazo de otro jugador ves qué cartas te faltan de tu colección y lo
    que costarían en Cardmarket, y puedes copiarlo a tus mazos.
- **Intercambios (con cuenta, solo entre amigos):** en Colección → Intercambios (`#intercambios`).
  - **Ofrezco / Busco:** marcas las cartas desde la ficha o desde estas listas, y «Ofrecer repetidas»
    añade las copias que pasan de 3 (sin contar runas). Solo las ven tus amigos y no quitan nada de la colección.
  - **Proponer:** desde el perfil de un amigo o desde «Con quién cambiar». Eliges lo que das (de tu
    colección) y lo que pides (cualquier carta; primero las que encajan), con un mensaje opcional y el
    valor de cada lado en Cardmarket. Un lado puede ir vacío, para regalar o para pedir.
  - **Bandeja:** quien recibe acepta, rechaza o hace una contraoferta (rechaza la propuesta y abre
    otra al revés); quien propone puede cancelar. Un punto dorado avisa de lo que espera por ti.
  - **Hecho:** cuando os habéis dado las cartas, cualquiera de los dos lo marca. La app de cada uno
    suma y resta en su colección una sola vez, aunque tengas varios dispositivos, y ajusta sus listas.
    Lo que das queda en el Historial de cartas quitadas.

La pestaña abierta se guarda en la dirección (`#coleccion`, `#intercambios`, `#mazos`, `#partidas`, `#mesa`, o `#@usuario` en un perfil), así que al
recargar se vuelve a ella.

**Precios:** cada noche se descargan los precios de Cardmarket (€) y TCGplayer ($) de riftbound.gg.
La colección muestra el precio de cada carta y el valor total, se puede ordenar por precio, el escáner
avisa cuando una carta vale 5 € o más (o cuando existe una versión con la misma ilustración mucho más
cara, como las Showcase firmadas) y las exportaciones llevan las columnas "Precio €" y "Valor €".
Las runas de arte alternativo ("Showcase") solo existen en foil y se valoran como tales.

**Erratas:** las cartas cuyo texto oficial ha cambiado respecto al impreso usan el texto vigente
(fuente: la base de datos de [riftbound.gg](https://riftbound.gg/rules/errata/)). La app avisa al
escanearlas, la ficha muestra también el texto impreso y la exportación lleva una columna "Errata".

Incluye todos los sets publicados: Origins, Proving Grounds, Spiritforged, Unleashed, Vendetta,
Radiance y las cartas promocionales.

## Cuentas y sincronización

Las cuentas van con [Supabase](https://supabase.com) (plan gratuito). El esquema y la puesta en
marcha están en [`supabase/README.md`](supabase/README.md).

- **Crear cuenta:** usuario (el nombre que verán los demás), correo y contraseña. Supabase envía un
  enlace para confirmar el correo y al abrirlo se vuelve a la app con la sesión iniciada. Los
  correos salen por SMTP de Brevo.
- **Entrar** con el correo (las cuentas antiguas, de antes de pedir correo, entran con su usuario).
  "¿Has olvidado la contraseña?" envía un enlace y la app pide la nueva.
- **Sincronización:** el `localStorage` sigue siendo la copia de trabajo. Con la sesión iniciada,
  cada cambio se sube a los pocos segundos y al abrir la app o volver a ella se baja lo que haya
  cambiado en otros dispositivos. Sin conexión sigue funcionando y sube lo pendiente al volver. El
  punto del botón de cuenta indica el estado.
- La app compara lo local con una "foto" de lo que hay en la nube (`rb.sync.v1`) y sube solo lo
  que difiere. Si la misma carta, mazo o partida cambia en dos dispositivos sin conexión, gana el
  último que sube. Los mazos y partidas borrados se marcan (`deleted_at`) para que el borrado llegue
  a los demás dispositivos. Lo que se cambia mientras se sincroniza no se pisa: se sube en la vuelta
  siguiente. Si no caben todos los mazos (15 por cuenta), se sincroniza todo lo demás y la app avisa.
- **La primera vez** que una cuenta con datos entra en un dispositivo con datos, la app pregunta qué
  hacer con las cartas, los mazos y las partidas, cada cosa por separado: juntar, quedarse con lo de
  la cuenta o con lo del dispositivo. Las cartas se pueden juntar sin duplicar (la cantidad mayor de
  cada una, la opción por defecto) o sumando las copias. No pregunta por lo que ya coincide o solo
  está en un lado.
- Si a una cuenta le falta su perfil, la app lo repara sola (`ensure_profile()`) y solo cierra la
  sesión si Supabase confirma que la cuenta ya no existe.
- Sin sesión no se carga Supabase. En la web solo va la clave pública (publishable); la clave
  secreta no se pone nunca en la app.

## Diseño

Negro neutro con capas por luminosidad y tipografía Inter con cifras tabulares. El dorado queda
para los datos (copias, precios, la carta reconocida, el porcentaje de victorias). Botones en
pastilla (el principal en blanco), casillas como interruptores, diálogos como hoja inferior en el
móvil y animaciones que respetan "reducir movimiento". El recuadro guía del escáner no cambia de
tamaño ni de posición: `scanner.js` recorta con él.

## Cómo funciona el reconocimiento

Todo ocurre en el propio móvil, sin enviar imágenes a ningún servidor:

1. Se recorta la zona del recuadro guía de cada fotograma de la cámara.
2. Un modelo de visión **DINOv2-small** (ONNX, capas MatMul cuantizadas a int8, ~25 MB) la convierte en un vector.
3. Se busca el vector más parecido entre los precalculados de las ~1.600 cartas (`web/data/index.bin`).

Las cartas con exactamente la misma ilustración (reimpresiones, promos) no se pueden distinguir con
la cámara: se propone la edición normal y puedes cambiar la versión en la lista de escaneadas.

## Estructura

```
web/                 la app (estática, se puede publicar tal cual)
  index.html, styles.css
  js/                app.js (escáner y colección), decks.js, matches.js (partidas),
                     cloud.js, merge.js y account-ui.js (cuenta y sincronización), profile.js (página de
                     perfil), friends.js (seguir y amigos), trades.js (intercambios), table.js (mesa), ledger.js (balance), store.js (localStorage),
                     import-ui.js, importer.js, export.js, prices.js, recognizer.js, scanner.js
  data/cards.json    datos de las cartas
  data/index.*       embeddings de referencia
  models/            modelo ONNX
  thumbs/            miniaturas
tools/
  fetch_cards.py     descarga cartas e imágenes (galería oficial + Riftcodex) y aplica erratas
  errata.py          erratas desde la base de datos de riftbound.gg
  build_index.py     calcula los embeddings de referencia
  calibrate.py       mide la precisión y propone umbrales
  eval_models.py     comparativa de modelos (usada para elegir DINOv2)
supabase/            esquema de la base de datos (scripts SQL por fases) y su README
```

## Probar en el PC

```bash
python -m http.server 8000 --directory web
```

Abre http://localhost:8000. En el PC la cámara funciona en `localhost`; en el móvil hace falta que
la web se sirva por **HTTPS** (los navegadores no dejan usar la cámara en http).

## Publicar en GitHub Pages (para usarla desde el móvil)

1. Crea un repositorio vacío en GitHub (por ejemplo `riftbound-scanner`), sin README.
2. Súbelo:
   ```bash
   git remote add origin https://github.com/<tu-usuario>/riftbound-scanner.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. El flujo `.github/workflows/pages.yml` publica la carpeta `web/` en cada push. La app queda en
   `https://<tu-usuario>.github.io/riftbound-scanner/`. Ábrela en el móvil y usa
   "Añadir a pantalla de inicio" para tenerla como una app.

Sin cuenta, la colección, los mazos y las partidas se guardan solo en el navegador (localStorage:
`rb.collection.v1`, `rb.decks.v1`, `rb.matches.v1`, `rb.ledger.v1`). Usa **Colección → Exportar copia** de vez en
cuando para no perderlos si borras los datos del navegador, o crea una cuenta para tenerlos en la
nube. La copia JSON incluye colección, mazos, partidas y balance.

## Actualización automática (diaria)

El workflow `.github/workflows/update-cards.yml` se ejecuta cada día a las 23:00 UTC (00:00 en
España en invierno, 01:00 en verano): descarga cartas y erratas, y si hay cambios los sube y vuelve
a publicar la app. Con cartas nuevas recalcula el índice de reconocimiento solo para ellas. Si una
fuente falla o devuelve datos incompletos no sube nada (y GitHub avisa por correo del fallo).
Se puede lanzar a mano desde la pestaña **Actions → Actualizar cartas y erratas → Run workflow**.

## Actualizar a mano

```bash
python -m venv .venv
.venv/Scripts/python -m pip install numpy pillow onnxruntime onnx
.venv/Scripts/python tools/fetch_cards.py
.venv/Scripts/python tools/build_index.py
```

`fetch_cards.py` solo descarga las imágenes nuevas. Después vuelve a publicar la carpeta `web/`.

Fuentes de datos: [galería oficial de Riftbound](https://riftbound.leagueoflegends.com/en-us/card-gallery/)
y [Riftcodex](https://riftcodex.com). Riftbound y sus imágenes son propiedad de Riot Games; este es
un proyecto personal no oficial.
