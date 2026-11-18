/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Moneda de cuenta de la IA (ISO 4217). Sin ella, los importes van en «unidades de cuenta». */
  readonly VITE_AI_ACCOUNT_CURRENCY?: string;
  /** `true` si el servidor tiene un proveedor de IA de texto: enseña redactar, comprobar tono y proponer perfil. */
  readonly VITE_AI_TEXT_ENABLED?: string;
  /** `true` si el servidor tiene un modelo de imagen: enseña «Con IA» en el editor. */
  readonly VITE_AI_IMAGE_ENABLED?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
