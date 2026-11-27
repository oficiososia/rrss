// Interruptores de funcionalidad del frontend (decisión, no entorno).

/**
 * ¿Se enseñan las entradas para que la IA haga un reel? (decisión del dueño,
 * 26/11/2026: los reels hechos por la IA salen mal; de momento se hacen a mano
 * con plantilla de reel, fotos y vídeos propios, editor y «Terminar en Instagram».)
 *
 * Apagado (`false`) se ocultan «Hacer un reel como este» (menú «＋ Crear»,
 * «Crear contenido» y Reels), su ruta redirige a Reels y las campañas no
 * preparan ni montan los reels solas: quedan como borrador para montar a mano.
 * No se borra código ni funciones del servidor: para volver a activarlo, basta
 * con poner `true` aquí (siguen mandando `VITE_REEL_LIKE_ENABLED` y el trabajador).
 */
export const REELS_IA_VISIBLE = false;
