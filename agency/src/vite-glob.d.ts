// La herramienta comprueba tipos de módulos de la aplicación que, a su vez,
// nombran (solo como tipo) el catálogo de estilos de reel, que Vite arma con
// `import.meta.glob`. Aquí no se ejecuta: basta con que el tipo exista.
interface ImportMeta {
  glob: (pattern: string, options?: Record<string, unknown>) => Record<string, unknown>;
}
