import type {
  ContentStatus,
  PublicationHoldReason,
  ScheduledPublicationRow,
  SocialAccountRow,
} from '@/lib/database.types';
import { formatTimeIn, fromZoned, toZoned } from './zone';

// Fechas del calendario (en la hora de la marca: ver zone.ts; sin zona, la del navegador) y el estado que se enseña de
// cada publicación. Sin dependencias: se prueba aparte.

/** Semana (la de planificar), mes (de un vistazo) y lista (la de móvil). */
export type CalendarView = 'week' | 'month' | 'agenda';

export const CALENDAR_VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'agenda', label: 'Lista' },
];

/** Días que cubre la lista: cuatro semanas desde el lunes de la semana elegida. */
export const AGENDA_DAYS = 28;

export function isCalendarView(value: unknown): value is CalendarView {
  return value === 'week' || value === 'month' || value === 'agenda';
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/** Lunes de la semana de la fecha. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  return addDays(d, -((d.getDay() + 6) % 7));
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Clave estable de un día (AAAA-MM-DD, hora local). */
export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Intervalo [desde, hasta) que cubre la vista. El mes se ve en semanas completas, solo las que toca (4 a 6 filas). */
export function viewRange(view: CalendarView, anchor: Date): { from: Date; to: Date; days: Date[] } {
  let from: Date;
  let count: number;
  if (view === 'week') {
    from = startOfWeek(anchor);
    count = 7;
  } else if (view === 'agenda') {
    from = startOfWeek(anchor);
    count = AGENDA_DAYS;
  } else {
    from = startOfWeek(startOfMonth(anchor));
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    count = (Math.round((startOfWeek(last).getTime() - from.getTime()) / 86_400_000) + 7);
  }
  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  return { from, to: addDays(from, count), days };
}

/** Avanza o retrocede la vista una unidad (semana, mes o cuatro semanas en la lista). */
export function shiftAnchor(view: CalendarView, anchor: Date, step: 1 | -1): Date {
  if (view === 'agenda') return addDays(anchor, AGENDA_DAYS * step);
  if (view === 'week') return addDays(anchor, 7 * step);
  return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
}

/** Lleva una fecha a otro día conservando la hora (arrastrar y soltar en mes o semana). */
export function moveToDay(original: Date, day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), original.getHours(), original.getMinutes());
}

/** Lleva una fecha a otro día y hora en punto (soltar en la vista de día). */
export function moveToHour(original: Date, day: Date, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, original.getMinutes());
}

/** Valor para <input type="datetime-local"> en la hora de la zona (sin zona, la del dispositivo). */
export function toLocalInput(iso: string | Date, zone?: string): string {
  const instant = typeof iso === 'string' ? new Date(iso) : iso;
  const d = zone ? toZoned(instant, zone) : instant;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** De <input type="datetime-local"> (hora de la zona) a ISO; null si no es una fecha. */
export function fromLocalInput(value: string, zone?: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return (zone ? fromZoned(d, zone) : d).toISOString();
}

export function formatTime(iso: string, zone?: string): string {
  return zone
    ? formatTimeIn(iso, zone)
    : new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function rangeTitle(view: CalendarView, anchor: Date): string {
  if (view === 'week' || view === 'agenda') {
    const from = startOfWeek(anchor);
    const to = addDays(from, view === 'week' ? 6 : AGENDA_DAYS - 1);
    const f = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `${f(from)} – ${f(to)} de ${to.getFullYear()}`;
  }
  return anchor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

// ── Estado que se enseña ─────────────────────────────────────────────────

/**
 * Lo que se ve en el calendario: «Programada» solo cuando la base de datos la
 * tiene armada, y «Publicada» solo con el identificador que dio la red.
 * Mientras no está armada, se ve en qué punto está la pieza (idea, borrador,
 * en revisión) o «Detenida» con el motivo. Un reel terminado a mano en
 * Instagram («Terminar en Instagram») es «Pendiente en Instagram» hasta que se
 * sabe que salió, y entonces «Publicada (a mano)».
 */
export type DisplayState =
  | 'idea'
  | 'draft'
  | 'in_review'
  | 'held'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'manual_pending'
  | 'manual_published';

export function displayState(
  pub: Pick<ScheduledPublicationRow, 'status' | 'hold_reason' | 'external_id'> & {
    manual?: { status: 'pending' | 'published' };
  },
  contentStatus: ContentStatus | null,
): DisplayState {
  if (pub.manual) return pub.manual.status === 'published' ? 'manual_published' : 'manual_pending';
  switch (pub.status) {
    case 'published':
      return pub.external_id ? 'published' : 'publishing';
    case 'publishing':
    case 'failed':
    case 'cancelled':
    case 'scheduled':
      return pub.status;
    case 'planned':
      if (pub.hold_reason === 'not_approved' && contentStatus && contentStatus !== 'approved') return contentStatus;
      return 'held';
  }
}

export const DISPLAY_LABEL: Record<DisplayState, string> = {
  idea: 'Idea',
  draft: 'Borrador',
  in_review: 'En revisión',
  held: 'Detenida',
  scheduled: 'Programada',
  publishing: 'Publicando',
  published: 'Publicada',
  failed: 'Falló',
  cancelled: 'Cancelada',
  manual_pending: 'Pendiente en Instagram',
  manual_published: 'Publicada (a mano)',
};

export const DISPLAY_TONE: Record<DisplayState, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  idea: 'neutral',
  draft: 'neutral',
  in_review: 'warning',
  held: 'warning',
  scheduled: 'primary',
  publishing: 'primary',
  published: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  manual_pending: 'warning',
  manual_published: 'success',
};

export const DISPLAY_STATES: DisplayState[] = [
  'idea',
  'draft',
  'in_review',
  'held',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
  'manual_pending',
  'manual_published',
];

export const HOLD_REASON_TEXT: Record<PublicationHoldReason, string> = {
  not_approved: 'La pieza no está aprobada: no se publicará hasta que alguien con permiso la apruebe.',
  content_changed:
    'La pieza ha cambiado desde que se programó: elige la versión aprobada y su exportación para volver a programarla.',
  content_archived: 'La pieza está archivada.',
  no_account: 'Falta elegir la cuenta en la que se publica.',
  account_disconnected: 'La cuenta se ha desconectado: conéctala otra vez o elige otra.',
  account_needs_reauth: 'El acceso a la cuenta ha caducado: vuelve a conectarla en Marca → Cuentas conectadas.',
  no_media: 'Falta elegir la imagen o el vídeo exportado de la versión aprobada.',
  invalid_media:
    'Los recursos no valen: hacen falta exportaciones JPEG de la versión aprobada (1 en una publicación, de 2 a 10 en un carrusel) o un vídeo en un reel.',
  unsupported_format: 'Este formato todavía no se publica automáticamente.',
  plan_no_publishing:
    'El plan de la organización ya no incluye la publicación en redes: lo programado está detenido. Al volver a un plan con publicación se programa solo otra vez.',
};

/** ¿Se puede mover, cambiar o cancelar? */
export function isEditable(status: ScheduledPublicationRow['status']): boolean {
  return status === 'planned' || status === 'scheduled' || status === 'failed';
}

/** ¿Se puede mover, cambiar o cancelar esta fila del calendario? Lo terminado a mano, nunca (se gestiona en el reel). */
export function isEntryEditable(entry: Pick<ScheduledPublicationRow, 'status'> & { manual?: unknown }): boolean {
  return !entry.manual && isEditable(entry.status);
}

/** Cupo de publicación: aviso cuando se acerca (80 %) o se alcanza. Sin cifras de la red, nada. */
export function quotaWarning(usage: number | null, total: number | null): 'near' | 'reached' | null {
  if (usage === null || total === null || total <= 0) return null;
  if (usage >= total) return 'reached';
  return usage >= total * 0.8 ? 'near' : null;
}

/** ¿Caduca pronto el acceso? (7 días). */
export function tokenExpiresSoon(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - now < 7 * 86_400_000;
}

/** Días que faltan para que el acceso de una cuenta caduque (redondeado hacia arriba; puede ser ≤ 0). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.ceil((Date.parse(iso) - now) / 86_400_000);
}

/** Con cuántos días de antelación se avisa si el acceso no se renueva solo. */
export const RENEWAL_WARNING_DAYS = 14;

export interface AccountAttention {
  tone: 'warning' | 'danger';
  /** Una frase para la marca y la agencia, sin jerga. */
  text: string;
}

/**
 * ¿Hay que hacer algo con el acceso de esta cuenta? Null si no.
 *  · «Hay que volver a conectarla»: el acceso ya no vale y lo programado está detenido.
 *  · Conectada por OAuth: el servidor renueva el acceso solo antes de que caduque. Solo se
 *    avisa si lo intentó y no pudo (con 14 días o menos de margen) o si quedan 7 días o menos.
 *  · Conectada con un token pegado: no se renueva sola; se avisa con 14 días.
 */
export function accountAttention(
  account: Pick<SocialAccountRow, 'status' | 'token_expires_at' | 'connection_method' | 'renewal_error'>,
  now = Date.now(),
  formatDay: (iso: string) => string = (iso) => new Date(iso).toLocaleDateString('es-ES'),
): AccountAttention | null {
  if (account.status === 'needs_reauth') {
    return {
      tone: 'danger',
      text: 'El acceso a Instagram ha caducado o se ha retirado: lo programado está detenido hasta volver a conectar la cuenta.',
    };
  }
  if (account.status !== 'active' || !account.token_expires_at) return null;
  const days = daysUntil(account.token_expires_at, now);
  const when = formatDay(account.token_expires_at);
  if (days <= 0) {
    return { tone: 'danger', text: `El acceso a Instagram caducó el ${when}: vuelve a conectar la cuenta.` };
  }
  const left = days === 1 ? 'queda 1 día' : `quedan ${days} días`;
  if (account.connection_method === 'token') {
    return days <= RENEWAL_WARNING_DAYS
      ? { tone: 'warning', text: `El acceso a Instagram caduca el ${when} (${left}): renueva la conexión avanzada antes.` }
      : null;
  }
  if (account.renewal_error && days <= RENEWAL_WARNING_DAYS) {
    return {
      tone: 'warning',
      text: `El acceso a Instagram caduca el ${when} (${left}) y no se ha podido renovar solo: vuelve a conectar la cuenta antes.`,
    };
  }
  if (days <= 7) {
    return {
      tone: 'warning',
      text: `El acceso a Instagram caduca el ${when} (${left}) y aún no se ha renovado: vuelve a conectar la cuenta antes.`,
    };
  }
  return null;
}

/** ¿Ya ha pasado? (fuera del render: para los manejadores de eventos). */
export function isPast(date: Date | string): boolean {
  return new Date(date).getTime() < Date.now();
}

/** Fecha por defecto al programar: el día pedido a las 10:00, o dentro de una hora. */
export function defaultScheduleDate(day: Date | null | undefined): Date {
  if (!day) return new Date(Date.now() + 3_600_000);
  const d = new Date(day);
  if (d.getHours() === 0 && d.getMinutes() === 0) d.setHours(10);
  return d;
}

/** Formatos que el publicador sabe publicar hoy (espejo de private.publication_format_supported). */
export const PUBLISHABLE_TARGETS = new Set(['instagram:post', 'instagram:carousel', 'instagram:reel', 'instagram:story']);
