# Riftbound Scanner

Aplicación web para registrar tu colección de cartas de **Riftbound** con la cámara del móvil,
armar mazos con las cartas que tienes y apuntar tus partidas. Con una cuenta, todo se sincroniza
entre tus dispositivos. Se instala en el móvil como una app ("Añadir a pantalla de inicio") y
funciona sin conexión.

**App:** https://bertox22.github.io/riftbound-scanner/

**Novedades de la versión 73 (noviembre de 2026):** la pestaña **Partidas** rediseñada para que no
sea una lista interminable. Un panel de resumen (el % de victorias en grande, las cifras a su lado,
la forma reciente y la evolución con eje) y un panel de desglose con pestañas (Mazos, Leyendas rivales,
Tus Campos, Campos rivales, Eventos) en vez de cinco secciones apiladas. En el móvil, los filtros van
en una fila. Los perfiles de los amigos usan el mismo aspecto.

**Novedades de la versión 72, en Partidas y la Mesa:**
- **Estadísticas por Campo de batalla:** cómo te va con cada Campo tuyo y contra cada Campo del
  rival, por juegos.
- **Forma reciente:** tus últimas 10 partidas (V, D, E), la racha actual y la mejor, y la gráfica de
  tu % de victorias a lo largo del tiempo.
- **Eventos:** filtro por evento al lado del de mazo y la sección «Por evento» («tienda x» y «Tienda X»
  cuentan como el mismo).
- **Exportar las partidas a CSV** (lo que tengas filtrado), listo para abrir en Excel.
- **Mesa:** botón para **deshacer** lo último (un punto, cerrar un juego, el sorteo, un Campo,
  reiniciar) y **temporizador de ronda** opcional para torneos (30, 50 o 60 min; por defecto, sin
  temporizador), con pausa y ajuste de minutos tocando el centro de la barra.

**Novedades de la versión 71, en Mazos:**
- **Curva y dominios** en el editor: barras por coste de energía, coste medio, cartas por tipo y, por
  dominio, cuántas cartas, cuánto poder piden y cuántas runas llevas.
- **Mano de prueba:** roba 4 cartas, haz el mulligan (hasta 2) y sigue robando. Y la probabilidad de
  tener una carta: en la mano inicial, tras el mulligan y tras robar N más.
- **Compartir el mazo como imagen** (WhatsApp, Discord…): Leyenda y Campeón, la lista con las copias,
  Runas, Campos y Sideboard.
- **Notas y versiones del mazo:** notas libres y «Guardar versión» con una nota corta. Cada versión
  muestra qué cartas cambiaron y cómo le ha ido («v3 · −2 Brawl, +2 Shuriken Flip · 7–2 · 78 %»).

**Novedades de la versión 70:**
- **Progreso por set:** botón «Sets» en Colección. Cuántas cartas tienes de cada set («Vendetta
  91/166 · 54 %», contando las numeradas del 1 al total; las variantes y showcase aparte), cuántas te
  faltan y lo que costarían en Cardmarket, la lista de las que faltan (las más caras primero) y «Ver en
  la colección».
- **Filtro por rareza** en Colección (Común, Infrecuente, Rara, Épica, Showcase, Promo).
- **Valor de la colección:** botón «Valor». Gráfica de cuánto valían tus cartas cada día (7 días, 30
  días o todo; toca la gráfica para ver un día) y lo que más sube y más baja. En la ficha de cada carta,
  la gráfica de su precio. Hay precios desde el 25 de octubre de 2026.
- **Añadir a «Busco» lo que falta**, de un toque: desde un set incompleto y desde «Te faltan…» de un
  mazo (tuyo o de otro jugador). Lo que ya buscabas no se duplica.
- **Guardar todas las miniaturas** para verlas sin conexión (unos 31 MB), al final de Escanear, con
  el progreso y «Parar».
- **Partidas entre vosotros:** en el perfil de un amigo, sus partidas contra ti que no tienes (para
  apuntártelas, por ejemplo si la descartaste o la borraste) y las tuyas contra él que no tiene (para
  enviárselas otra vez). Ver «Perfil y amigos».

**Mejoras anteriores (versiones 66 a 69):**
- **Sin conexión:** tras abrirla una vez con internet, abre y funciona sin cobertura (escáner,
  colección, mazos, partidas y Mesa). Detalles en «Sin conexión», más abajo.
- **Escáner más rápido:** hasta 4 hilos del procesador, unas 2,8 veces más rápido en un PC con el
  mismo resultado (en iPhone, como antes). Ver [Cómo funciona el reconocimiento](#cómo-funciona-el-reconocimiento).
- **Botón «atrás» del móvil:** cierra la hoja abierta, sale de la Mesa y vuelve de cualquier pestaña a
  Escanear, en vez de salir de la app.
- **Importar copia (JSON) sin riesgo:** pregunta por cartas, mazos, partidas y balance por separado,
  cerrar no cambia nada y deja «Deshacer». Antes «Cancelar» reemplazaba todos tus datos.
- **Aviso de versión nueva** («Recargar») si la app llevaba tiempo abierta, e iconos para instalarla
  en Android y iPhone. La versión en uso sale en pequeño al final de Escanear, con «lista sin
  conexión» o no; al tocarla, el detalle de lo que hay guardado (y el error, si no se pudo instalar).
- **Móvil:** el valor de la colección se ve entero arriba («364 · 97,48 €») y los Campos de cada
  partida van uno por juego («J1 Ruined Monastery – Threshold of the Gray»). En Partidas, «Por mazo»
  y «Contra cada Leyenda» se pliegan para que la lista no sea interminable.

- **Escanear:** pones cada carta dentro del recuadro y se añade sola en cuanto la reconoce (con
  vibración y pitido). Si duda, te enseña las candidatas para que toques la correcta. Para añadir
  varias copias iguales seguidas basta con retirar la carta del recuadro y poner la siguiente.
  Cada carta escaneada tiene su fila con − n + (suma o quita copias de la colección al momento; con
  0 desaparece) y al tocarla se abre una hoja con copias normales y foil, la versión, la ficha y
  "Quitar".
- **Colección:** filtros por set, tipo (incluido "Campeón", que son las unidades Campeón), dominio y
  rareza, cantidades normales/foil, exportación a Excel/CSV y copia de seguridad en JSON.
  - **Sets:** el progreso de cada set (las cartas numeradas del 1 al total impreso, con al menos una
    copia normal o foil; aparte, «con variantes y showcase»). En cada set, lo que falta y su coste en
    Cardmarket, «Ver en la colección» y, con cuenta, «Añadir las N a Busco». Los sets de promos solo
    dicen cuántas tienes.
  - **Valor:** cómo ha cambiado el valor de tu colección (7 días, 30 días o todo) y tus cartas que
    más suben y más bajan. Se calcula con las cartas que tienes hoy y el precio de cada día, así que no
    tiene huecos. La ficha de cada carta lleva la gráfica de su precio.
  - **Importar copia (JSON):** si tienes datos aquí y en la copia, la app pregunta qué hacer con
    cartas, mazos, partidas y balance por separado (juntar sin duplicar, sumar, quedarte con los de la
    copia o dejar los tuyos), con lo que quedará en cada caso. Cerrar la hoja no cambia nada, juntar
    mazos no deja pasar de 15 y el aviso tras importar deja **Deshacer**.
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
  - **Curva y dominios** (plegable, bajo el recuento): curva de energía del principal y el Campeón,
    coste medio, cartas por tipo y una tabla por dominio con cartas, poder que piden y runas.
  - **Mano de prueba** (también en el mazo de otro jugador): roba 4 cartas del principal (el Campeón
    empieza en su zona), toca hasta 2 para el mulligan (van al fondo) y roba más. Debajo, la
    probabilidad de tener al menos una copia de la carta que elijas (las versiones de una carta cuentan
    juntas) en la mano inicial, tras el mulligan devolviendo las demás y tras robar N cartas más.
  - **Compartir imagen:** un PNG del mazo (1080 px de ancho) con las miniaturas de la app. En el
    móvil abre el menú de compartir; en el PC se descarga.
  - **Notas y versiones** (plegable): notas libres del mazo y «Guardar versión» con una nota corta.
    La app compara cada versión con la anterior (+2 X, −1 Y, también sideboard, runas y Campos), avisa
    de los cambios aún sin guardar y reparte las partidas del mazo por versión según su fecha, con su
    balance. Hasta 20 versiones. Se sincronizan con la cuenta y se ven igual que el mazo (las notas
    también las ve quien vea el mazo compartido).
  - Se pueden importar listas de cualquier web (secciones Legend/Champion/Main Deck/Runes/Battlefields
    opcionales: lo que no tenga sección se coloca por tipo de carta) o archivos .txt, CSV y Excel.
- **Partidas:** al acabar una partida apuntas primero tu mazo y el rival, y después el resto: la
  Leyenda del rival (cada Leyenda sale una vez aunque tenga versión foil, Metal o Signature), los
  puntos de cada juego (8–7, o hasta 3 juegos al mejor de 3: el resultado y el marcador se marcan
  solos), el Campo de batalla de cada uno en cada juego, quién empezó (al mejor de 3, cada juego), el
  evento, la fecha y notas. El marcador admite 3–0 y 0–3 por si se juega el tercer juego aunque ya
  haya ganador. Si el rival es un amigo, no hace falta escribir su nombre (es su usuario): eliges con
  cuál de sus mazos jugó, su Leyenda queda fija («La de su mazo») y al elegir su Campo salen primero
  los de ese mazo. Un mazo que has borrado sigue saliendo con su Leyenda, como «Akali (borrado)», en
  las estadísticas, el filtro y el historial.
  - Las estadísticas cuentan juegos, no partidas (al mejor de 3, un 2–1 son dos victorias y una
    derrota, y un 0–3, tres derrotas; junto a las partidas se ven los juegos: «5 partidas · 11
    juegos»): el porcentaje de victorias (sin contar empates), el balance V–D–E, cómo te va en los
    juegos que empiezas tú o el rival, y los resultados por mazo, por evento, contra cada Leyenda,
    con cada Campo tuyo y contra cada Campo del rival, con filtros por mazo y por evento. El balance de
    cada mazo y los perfiles cuentan igual. Los Campos solo cuentan en los juegos que los tienen
    apuntados (un 2–1 sin los puntos de cada juego no sabe qué Campo fue con qué resultado).
  - **Cómo se ve:** los dos filtros en una fila; un **resumen** en un solo panel (el % de victorias
    en grande; al lado V–D, partidas y empezando tú o el rival; la forma reciente; y en el PC, a la
    derecha, la evolución con su eje y una línea en el 50 %); y un **desglose** en otro panel con
    pestañas (Mazos, Leyendas rivales, Tus Campos, Campos rivales, Eventos; solo las que tienen datos,
    y recuerda la última). Cada fila lleva el V–D y el % con su barra; con menos de 3 juegos el % va en
    gris porque aún dice poco. Se ven 6 filas y el resto con «Ver todas». Los perfiles de los amigos
    usan el mismo resumen y la misma lista.
  - **Forma reciente:** las últimas 10 partidas de la más antigua a la más nueva (V, D o E; al
    mantener el dedo, la fecha y el rival), su balance, la racha actual («Racha 3 V») y la mejor
    racha de victorias. Con 3 partidas o más, la gráfica del % de victorias acumulado (toca un punto
    para ver la fecha y el balance de entonces).
  - **Eventos:** el evento es texto libre; se agrupa sin mayúsculas ni espacios de más y se muestra
    como lo escribes más a menudo.
  - **Exportar CSV** (junto a «Historial»): las partidas que se ven con los filtros, una fila por
    partida (fecha, mazos, Leyendas, rival, resultado, marcador, puntos, Campos, quién empezó, evento
    y notas), con «;» para que Excel en castellano lo abra con doble clic.
- **Mesa (marcador en vivo):** en Partidas, «Iniciar partida» pide tu mazo (o tu Leyenda), el
  rival (te sugiere cuentas al escribir; si no tiene cuenta, basta su nombre; si es un amigo, también
  su mazo), su Leyenda, si es a un
  juego o al mejor de 3, a cuántos puntos y el temporizador de ronda (No, 30, 50 o 60 min; recuerda
  lo último que elegiste). La mesa ocupa toda la pantalla: cada jugador tiene su
  mitad (la del rival, girada), teñida con el color del dominio de su Leyenda, con sus puntos en
  grande, una pista hasta los puntos de victoria y los botones − y + en su borde (tocar el número
  también suma). Llegar a los puntos solo avisa («Gana el juego», en dorado): los juegos y la
  partida se cierran a mano. La barra del medio tiene salir, «Sortear» (antes del primer punto: quien
  gana elige en su mitad si empieza o empieza el otro, y eso queda apuntado en la partida; en los
  siguientes juegos elige quien perdió el anterior, y queda apuntado quién empezó cada uno), el juego
  y el marcador (con temporizador, el reloj encima), **deshacer** y una sola acción en blanco:
  - **Deshacer** (la flecha curva) vuelve atrás lo último: un punto, cerrar un juego, el sorteo, quién
    empieza, un Campo o reiniciar. Se puede pulsar varias veces (hasta 30 pasos) y no toca el reloj.
  - Tocar el centro de la barra abre el menú de la partida: el **temporizador** (pausar y seguir, ±1
    min para cuadrarlo con el del juez, volver a empezar, desactivarlo o ponerlo si no había) y
    «Reiniciar la partida». El reloj se pone ámbar en los 5 últimos minutos y rojo al acabar (sigue
    contando: «+1:23»); al llegar a 0 avisa una vez (en Android también vibra). Funciona por la hora
    de fin, así que salir de la mesa o recargar no lo para.
  - Al mejor de 3, cuando alguien gana un juego, **«Terminar juego»** lo guarda y empieza el
    siguiente. «Siguiente» cierra un juego sin llegar a los puntos (por ejemplo, si alguien se rinde).
  - **«Terminar»**, cuando la partida ya tiene ganador, la guarda sola en tu historial (y si el rival
    es un amigo, le llega como partida espejo). Si se termina a medias, avisa antes.
  - Con 2–0, «Jugar el 3.º» deja jugar el tercer juego igualmente (la partida acaba 3–0 o 2–1).

  En cada juego se elige el Campo de batalla de cada jugador (primero los del mazo; los ya jugados
  salen marcados) y queda apuntado en la partida. La pantalla no se apaga y una recarga no pierde la
  partida.
- **Cuenta (opcional):** el botón de la barra superior abre la cuenta. Con ella, colección, mazos,
  partidas y balance se guardan en la nube y aparecen en todos tus dispositivos. Sin cuenta la app funciona
  igual, solo en el dispositivo. Ver [Cuentas y sincronización](#cuentas-y-sincronización).
- **Perfil y amigos (con cuenta):**
  - En la cuenta editas tu perfil (nombre visible, ciudad, «Sobre ti») y eliges si es público.
    Cada mazo se puede compartir por separado desde el editor («Compartir este mazo»).
  - Tu perfil tiene su enlace, `#@usuario` (y `#@usuario/mazo` para un mazo): muestra tus
    estadísticas, las Leyendas que más juegas y los mazos que compartes. Los perfiles públicos se
    ven sin cuenta; quien no es tu amigo ve tus partidas sin las notas ni los datos del rival.
  - Con el botón de la lupa (arriba, junto a la cuenta) buscas jugadores y los sigues. Si os seguís los dos sois amigos: veis los mazos y
    las partidas del otro aunque el perfil sea privado.
  - **Partida espejo:** al apuntar una partida puedes elegir a un amigo como rival. A él le aparece
    en Partidas para guardarla en su historial con todo al revés (resultado, marcador, puntos,
    Leyendas, Campos de batalla, quién empezó cada juego y los mazos: el que apuntó como tuyo pasa a
    ser tu mazo) o
    descartarla. En su perfil ves vuestro cara a cara («Tú contra X»).
  - **Partidas entre vosotros:** en el perfil de un amigo salen sus partidas contra ti que no tienes en
    tu historial («Apuntar en mi historial») y las tuyas contra él que no tiene («Enviársela», que le
    vuelve a sacar el aviso aunque la hubiera descartado). Solo se puede apuntar una partida quien era
    su rival con cuenta, y cada uno una sola vez (lo comprueba la base de datos). Si los dos apuntasteis
    la misma partida por separado (menos de 1 h entre las dos, resultado y Leyendas cruzados), se aparta
    en «parece que ya la tenéis» para no duplicarla.
  - **Añadir a Busco:** en «Te faltan…» de un mazo (tuyo o de otro), las cartas que faltan pasan a tu
    lista Busco de un toque.
  - **¿Cuánto me falta?:** en el mazo de otro jugador ves qué cartas te faltan de tu colección y lo
    que costarían en Cardmarket, y puedes copiarlo a tus mazos.
- **Intercambios (con cuenta, solo entre amigos):** en Colección, con el selector «Mis cartas /
  Intercambios» de arriba (`#intercambios`).
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
recargar se vuelve a ella. El botón «atrás» del móvil cierra la hoja abierta (la de arriba, si hay
varias) y, sin hojas, sale de la Mesa o vuelve de la pestaña en la que estés a Escanear; desde
Escanear, sale de la app.

**Sin conexión:** después de abrirla una vez con internet, la app abre y funciona sin conexión (en una
tienda o un torneo sin cobertura): escáner, colección, mazos, partidas y Mesa. Las miniaturas que ya
has visto también salen, y al final de Escanear puedes guardarlas todas de una vez (unos 31 MB); las imágenes grandes de la ficha y lo que va a la cuenta necesitan internet,
y los cambios se suben al volver. Con conexión siempre se abre la última versión; si la app llevaba
tiempo abierta en segundo plano y se ha publicado otra, avisa con «Recargar».

**Precios:** cada noche se descargan los precios de Cardmarket (€) y TCGplayer ($) de riftbound.gg.
La colección muestra el precio de cada carta y el valor total, se puede ordenar por precio, el escáner
avisa cuando una carta vale 5 € o más (o cuando existe una versión con la misma ilustración mucho más
cara, como las Showcase firmadas) y las exportaciones llevan las columnas "Precio €" y "Valor €".
Cada noche también se añade el día a `web/data/price-history.json` (un precio por carta y día, en
céntimos; pasados 90 días, uno por semana), del que salen la hoja «Valor» y la gráfica de la ficha.
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
  Cada cuenta tiene además un máximo de datos por tabla, muy por encima del uso normal; si se llega,
  la app lo dice.
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
pastilla (el principal en blanco y a la derecha), casillas como interruptores, diálogos como hoja
inferior en el móvil con la cabecera fija al desplazar, y animaciones que respetan "reducir
movimiento".

En portátil y ordenador (desde 768 px), Colección tiene una barra con las pestañas a la izquierda y
Balance e Historial a la derecha, y las hojas flotan centradas con margen. Desde 1120 px las pestañas
pasan al centro de la barra de arriba, las estadísticas y los mazos van a dos columnas y Escanear
queda en una columna centrada. El recuadro guía del escáner no cambia de
tamaño ni de posición: `scanner.js` recorta con él.

## Cómo funciona el reconocimiento

Todo ocurre en el propio móvil, sin enviar imágenes a ningún servidor:

1. Se recorta la zona del recuadro guía de cada fotograma de la cámara.
2. Un modelo de visión **DINOv2-small** (ONNX, capas MatMul cuantizadas a int8, ~25 MB) la convierte en un vector.
3. Se busca el vector más parecido entre los precalculados de las ~1.600 cartas (`web/data/index.bin`).

Las cartas con exactamente la misma ilustración (reimpresiones, promos) no se pueden distinguir con
la cámara: se propone la edición normal y puedes cambiar la versión en la lista de escaneadas.

**Velocidad:** el modelo usa hasta 4 hilos del procesador cuando la página está «aislada» (cabeceras
COOP y COEP). GitHub Pages no deja ponerlas, así que las añade el service worker (`sw.js`), en modo
`credentialless` para que sigan cargando las imágenes de Riot. En un PC pasa de ~350 ms a ~125 ms por
fotograma con el mismo resultado. Desde la segunda vez que se abre la app; en Safari (iPhone), que no
admite ese modo, va con 1 hilo como antes. El escáner muestra los ms de cada fotograma. WebGPU se probó
y no sirve con este modelo: sus capas cuantizadas dan resultados erróneos.

## Estructura

```
web/                 la app (estática, se puede publicar tal cual)
  index.html, styles.css, manifest.webmanifest, icon.svg, icons/ (PNG para instalarla)
  sw.js              service worker: app y datos sin conexión, y cabeceras para los hilos del escáner
  js/                app.js (escáner y colección), decks.js, matches.js (partidas),
                     cloud.js, merge.js y account-ui.js (cuenta y sincronización), profile.js (página de
                     perfil), friends.js (seguir y amigos), trades.js (intercambios), table.js (mesa), ledger.js (balance), store.js (localStorage),
                     import-ui.js, importer.js, export.js, backup.js (importar copia), back.js (botón atrás), prices.js,
                     pricehistory.js (historial de precios y gráficas), testhand.js (mano de prueba),
                     deckimage.js (mazo como imagen), recognizer.js, scanner.js
  data/cards.json    datos de las cartas
  data/prices.json   precios del día; data/price-history.json, el historial
  data/index.*       embeddings de referencia
  models/            modelo ONNX
  thumbs/            miniaturas
tools/
  fetch_cards.py     descarga cartas e imágenes (galería oficial + Riftcodex) y aplica erratas
  errata.py          erratas desde la base de datos de riftbound.gg
  price_history.py   añade cada noche el día a price-history.json (--backfill: lo rehace desde git)
  build_index.py     calcula los embeddings de referencia
  calibrate.py       mide la precisión y propone umbrales
  eval_models.py     comparativa de modelos (usada para elegir DINOv2)
supabase/            esquema de la base de datos (scripts SQL por fases) y su README
```

## Probar en el PC

```bash
python -m http.server 8000 --directory web
```

(En Windows, `py` en lugar de `python`.)

Abre http://localhost:8000. En el PC la cámara funciona en `localhost`; en el móvil hace falta que
la web se sirva por **HTTPS** (los navegadores no dejan usar la cámara en http).

En el PC el modo sin conexión está apagado para no estorbar al desarrollo; para probarlo, abre
http://localhost:8000/?sw (y en local pide siempre primero los archivos al servidor).

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
5. GitHub Pages deja guardar los archivos unos 10 minutos. Para que cada publicación llegue entera,
   `styles.css`, `app.js` y el resto de módulos (con el `importmap` de `index.html`) llevan la misma
   versión, `?v=69`: al publicar cambios de estilos o de código, súbela en todos a la vez. El service
   worker (`sw.js`) toma la versión de ahí solo: no hay que tocarlo.

Sin cuenta, la colección, los mazos y las partidas se guardan solo en el navegador (localStorage:
`rb.collection.v1`, `rb.decks.v1`, `rb.matches.v1`, `rb.ledger.v1`). Usa **Colección → Exportar copia** de vez en
cuando para no perderlos si borras los datos del navegador, o crea una cuenta para tenerlos en la
nube. La copia JSON incluye colección, mazos, partidas y balance, y se recupera con **Importar copia
(JSON)**.

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
