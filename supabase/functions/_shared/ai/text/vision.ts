// Visión en los adaptadores de texto: imágenes como parte de la entrada
// (`AiInput.images`). Sin dependencias de Deno ni de Node.
//
// Qué adaptadores las admiten (los demás fallan con `unsupported_input` antes de
// llamar a nadie, y la función que las necesita no se ofrece):
//   * `openai`            Chat Completions, `image_url` con datos en base64, detalle bajo.
//   * `anthropic`, `anthropic-bedrock`, `anthropic-vertex`
//                         API de mensajes, bloque `image` en base64.
//   * `mistral`           NO: el adaptador no manda imágenes.
// ⚠ SIN PROBAR CONTRA NINGÚN SERVICIO REAL: solo con HTTP simulado.

/** Adaptadores de texto que admiten imágenes en la entrada. */
export const VISION_PROVIDER_IDS: readonly string[] = ['openai', 'anthropic', 'anthropic-bedrock', 'anthropic-vertex'];

export function supportsImages(providerId: string): boolean {
  return VISION_PROVIDER_IDS.includes(providerId);
}

/** Base64 sin `Buffer` (vale en Deno y en Node). */
export function base64(data: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    binary += String.fromCharCode(...data.subarray(i, i + step));
  }
  return btoa(binary);
}

export function imageDataUrl(image: { data: Uint8Array; mimeType: string }): string {
  return `data:${image.mimeType};base64,${base64(image.data)}`;
}
