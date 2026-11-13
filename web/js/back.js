// Botón «atrás» del móvil: con una hoja abierta la cierra (la de arriba, si hay varias) y, sin hojas,
// vuelve a la pestaña anterior (`route` pinta la de la dirección). Cada hoja que se abre deja un paso en
// el historial ({ sheet }); al cerrarla con ✕, Escape o desde el código, ese paso se deshace solo.
// Vale para todos los <dialog> de index.html sin tocar el código que los abre.

const stack = []; // hojas abiertas con su paso: { dialog, token }
let seq = 0;
let skip = 0; // pasos atrás que da esta app (no el usuario) y no hay que atender

function opened(dialog) {
  const token = ++seq;
  history.pushState({ sheet: token }, '');
  stack.push({ dialog, token });
}

function closed(dialog) {
  const i = stack.findIndex((s) => s.dialog === dialog);
  if (i < 0) return; // ya se quitó al pulsar atrás
  const [{ token }] = stack.splice(i, 1);
  // Si después de cerrarla se ha ido a otra dirección (un perfil), ese paso se queda: se salta al volver.
  if (history.state?.sheet === token) {
    skip++;
    history.back();
  }
}

export function initBack(route) {
  for (const dialog of document.querySelectorAll('dialog')) {
    // Se mira el atributo open (no el aviso «close», que algunos navegadores no envían siempre). Llega
    // después del código que abre o cierra: si una hoja se cierra y se reabre seguido, no cambia nada.
    new MutationObserver(() => {
      const inStack = stack.some((s) => s.dialog === dialog);
      if (dialog.open && !inStack) opened(dialog);
      else if (!dialog.open && inStack) closed(dialog);
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
  window.addEventListener('popstate', (e) => {
    if (skip) { skip--; return; }
    const top = stack.pop();
    if (top) { top.dialog.close(); return; }
    // Paso de una hoja que ya no está abierta: se salta, sin que el usuario tenga que pulsar dos veces.
    if (e.state?.sheet) { history.back(); return; }
    route();
  });
}
