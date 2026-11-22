// Registro de manejadores: los tipos de trabajo que este trabajador reclama.
import type { Handler } from '../handler.ts';
import { createCutoutHandler } from './cutout.ts';
import { createImageProcessHandler } from './image-process.ts';
import { createReelTemplateHandler } from './reel-template.ts';
import { createReportPdfHandler } from './report-pdf.ts';
import type { MediaDeps } from './shared.ts';
import { createSourceExtractHandler } from './source-extract.ts';
import { createVideoDerivativesHandler } from './video-derivatives.ts';

/**
 * Manejadores en uso. `media.document.export` (documento por capas a imagen)
 * tiene su punto de enganche en `document-export.ts`, pero no se registra
 * hasta que esté implementado.
 */
export function createMediaHandlers(deps: MediaDeps): Handler[] {
  return [
    createImageProcessHandler(deps),
    createReelTemplateHandler(deps),
    createVideoDerivativesHandler(deps),
    // Texto de las fuentes de la marca (PDF, Word, web): no usa FFmpeg.
    createSourceExtractHandler(),
    // Informe mensual de analítica (Fase 5).
    createReportPdfHandler(),
    // Quitar el fondo (BEN2 en CPU): solo si la máquina tiene el modelo (`deps.cutout`); si no, no reclama el tipo.
    ...(deps.cutout ? [createCutoutHandler({ engine: deps.cutout })] : []),
  ];
}
