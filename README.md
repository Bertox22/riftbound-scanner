# Riftbound Scanner

Aplicación web para registrar tu colección de cartas de **Riftbound** con la cámara del móvil
y armar mazos con las cartas que tienes.

**App:** https://bertox22.github.io/riftbound-scanner/

- **Escanear:** pones cada carta dentro del recuadro y se añade sola en cuanto la reconoce (con
  vibración y pitido). Si duda, te enseña las candidatas para que toques la correcta. Para añadir
  varias copias iguales seguidas basta con retirar la carta del recuadro y poner la siguiente.
- **Colección:** filtros por set, tipo y dominio, cantidades normales/foil, exportación a Excel/CSV y
  copia de seguridad en JSON.
- **Importar:** cualquier Excel o CSV (o una lista pegada tipo "3x Arena Kingpin"). La app adivina
  las columnas (código, set, nº, nombre, copias, foil), busca cada carta por código, por nombre o
  por nombre aproximado, y enseña todo para revisarlo antes de sumar o reemplazar la colección.
- **Mazos:** Leyenda, Campeón, mazo principal (40), Runas (12) y Campos de batalla (3), con
  validación de reglas (dominios, máximo 3 copias, cartas de firma) y aviso de las cartas que te faltan.
  Se pueden importar listas de cualquier web (secciones Legend/Champion/Main Deck/Runes/Battlefields
  opcionales: lo que no tenga sección se coloca por tipo de carta) o archivos .txt, CSV y Excel.

**Erratas:** las cartas cuyo texto oficial ha cambiado respecto al impreso usan el texto vigente
(fuente: la base de datos de [riftbound.gg](https://riftbound.gg/rules/errata/)). La app avisa al
escanearlas, la ficha muestra también el texto impreso y la exportación lleva una columna "Errata".

Incluye todos los sets publicados: Origins, Proving Grounds, Spiritforged, Unleashed, Vendetta,
Radiance y las cartas promocionales.

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
  index.html, styles.css, js/
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

La colección se guarda en el navegador del móvil (localStorage). Usa **Colección → Exportar copia**
de vez en cuando para no perderla si borras los datos del navegador.

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
