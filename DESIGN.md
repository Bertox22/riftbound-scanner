---
name: Hextech
description: Sistema visual de Riftbound Scanner. Inspirado en el aire de los juegos de Runeterra (azul noche, oro viejo, magia turquesa), sin usar marcas, logotipos ni ilustraciones de Riot Games.
colors:
  bg: "#070b14"          # fondo: azul noche casi negro
  surface: "#0e1522"     # paneles
  surface-2: "#162033"   # paneles dentro de paneles, campos en hojas
  surface-3: "#1e2b42"   # hover de surface-2
  hover: "#121b2b"       # hover de surface
  border: "#1c2638"      # separadores finos
  line: "#3d3423"        # contorno de botones y hojas (oro apagado)
  line-strong: "#785a28" # contorno al pasar por encima / activo
  gold: "#c8aa6e"        # oro hextech: títulos, bordes activos, botón principal
  gold-bright: "#f0e6d2" # brillo del oro, texto sobre fondo dorado oscuro
  gold-deep: "#785a28"   # sombra del oro
  accent: "#d9b56a"      # dato: copias, precios, % de victorias, carta reconocida
  accent-ink: "#1a1306"  # texto sobre dorado
  magic: "#38c6c0"       # turquesa: foco del teclado y enlaces
  text: "#ece4d3"        # texto principal (crema, no blanco puro)
  muted: "#a8a192"
  faint: "#7c7768"
  ok: "#3fc07a"
  warn: "#e5a93b"
  danger: "#e5484d"
  # dominios (Leyendas, Mesa, chips)
  fury: "#c8323c"
  calm: "#4b8d31"
  mind: "#1a6ea2"
  body: "#da6e10"
  chaos: "#6a3f8f"
  order: "#bba012"
typography:
  display: "Cinzel (Google Fonts), 600-700; sustituye a la serif de titulares de los juegos de Riot"
  body: "Inter (Google Fonts), 400/500/600, cifras tabulares"
radius:
  control: 4px
  panel: 6px
  sheet: 10px
  chip: 999px
---

# Hextech · DESIGN.md

## Overview

Una app de coleccionista que parece parte del juego: **azul noche profundo, oro viejo y un toque
de magia turquesa**. El oro enmarca (bordes, títulos, el botón principal) y el oro más vivo
(`accent`) marca los **datos**: copias, precios, porcentajes, la carta reconocida. Formas rectas
con esquinas casi vivas, líneas finas doradas en vez de sombras y titulares en mayúsculas
espaciadas con una serif clásica. Las cartas son las protagonistas: el marco no compite con ellas.

## Colors

- **Fondo y capas:** `bg` → `surface` → `surface-2` → `surface-3`, todos azul noche. Las capas se
  separan por luminosidad y por una **línea dorada de 1 px muy apagada** (`line`), no por sombras.
- **Oro:** `gold` para lo que enmarca o se puede pulsar como principal; `gold-deep` en degradados y
  contornos; `gold-bright` para brillos.
- **Dato (`accent`):** solo cifras y estados de la colección. No se usa para decorar.
- **Magia (`magic`):** el foco del teclado y los enlaces de texto. Nada más.
- **Estados:** `ok` (victoria, guardado), `warn` (avisos, errata), `danger` (borrar, derrota).
- **Dominios:** Fury, Calm, Mind, Body, Chaos, Order, con el color de su banda en las cartas;
  solo en Leyendas, la Mesa y chips de dominio.

## Typography

- **Display — Cinzel** (sustituto libre de la serif de titulares de Riot): títulos de vista, de
  hoja, de sección y la marca. Mayúsculas con `letter-spacing: .06–.12em`, peso 600–700.
- **Texto — Inter:** todo lo demás, 14 px base, cifras tabulares donde se cuentan o comparan
  números.
- **Jerarquía:** título de vista 22 px Cinzel · título de hoja 18–20 px Cinzel · sección 12–13 px
  Cinzel en mayúsculas y dorado apagado · cuerpo 14 px Inter · secundario 12 px.
- **Botones:** Inter 600, 13 px, mayúsculas con `letter-spacing: .06em`.

## Layout

Igual que antes: una columna en el móvil (16 px de margen), contenido hasta 960 px, pestañas abajo
en el móvil y arriba al centro desde 1120 px. Espaciado de 4/8/12/16/24/32 px.

## Elevation & Depth

- Sin sombras en el contenido: profundidad por capas de azul y por la línea dorada.
- Las **hojas** (diálogos) flotan con una sombra negra amplia, un contorno `line` y una línea
  superior en degradado dorado (el «filo hextech»).
- El fondo de la página lleva un halo azul muy suave arriba, fijo.

## Shapes

- Controles (botones, campos, selectores): **4 px**.
- Paneles y filas (mazos, partidas, resumen, recientes): **6 px**.
- Hojas: **10 px** (en el móvil, solo arriba).
- Chips y contadores: pastilla (999 px).
- Cartas: 6–8 px, como las cartas reales.
- El rombo (cuadrado girado 45°) es el motivo decorativo: marca la pestaña activa y los separadores
  de título.

## Components

- **Botón principal:** degradado dorado (`gold-bright` → `gold` → `gold-deep`), texto `accent-ink`,
  contorno de 1 px `gold-bright` al 35 %; al pasar, más brillo.
- **Botón secundario:** fondo transparente, contorno `line`, texto `text`; al pasar, contorno
  `line-strong` y fondo `hover`.
- **Peligro:** contorno granate y texto `danger`.
- **Botón de icono:** cuadrado de 4 px de radio en `surface-2`; los de cantidad (− +), igual.
- **Campos:** `surface` (en hojas, `surface-2`), contorno `border`; al enfocar, contorno `gold`.
- **Interruptores:** pista azul con contorno; activado, pista dorada y bola `accent-ink`.
- **Pestañas inferiores:** fondo `bg` con un filo dorado arriba; la activa en `gold` con un rombo
  pequeño encima del icono.
- **Pestañas de panel (desglose):** subrayado de 2 px en `gold`.
- **Segmentado:** celdas de 4 px; la elegida, dorada (victoria en verde, derrota en rojo).
- **Contador de copias (badge):** pastilla dorada; foil, plateado con brillo.
- **Aviso (toast):** panel `surface-2` con contorno `gold-deep` y texto crema.
- **Mesa:** cada mitad teñida con el color de su dominio; la barra del medio en `bg` con botones
  `surface-2`; «Terminar» y el principal, en oro.

## Do's and Don'ts

**Do**
- Usar el oro para enmarcar y el `accent` solo para datos.
- Mantener las cartas como protagonistas: marcos finos, sin brillos encima de ellas.
- Titulares en Cinzel y en mayúsculas espaciadas; el resto en Inter.
- Contraste AA: texto crema sobre azul noche, texto oscuro sobre dorado.
- Respetar «reducir movimiento».

**Don't**
- No usar logotipos, wordmarks, emblemas ni ilustraciones de Riot Games o de Riftbound.
- No pintar fondos enteros de dorado ni poner degradados dorados en paneles grandes.
- No usar el turquesa como color de marca: solo foco y enlaces.
- No volver a las pastillas redondas en botones y campos (solo chips y contadores).
- No mover ni redimensionar el recuadro guía del escáner (`.guide`): `scanner.js` recorta con él.
