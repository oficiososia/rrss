import { ChevronLeft, ChevronRight, ImagePlus, Plus, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card, EmptyState, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { themeFromProfile } from '../../../agency/catalogo/tema.ts';
import { useActiveProfile } from '@/features/brand/api';
import { parseProfile } from '@/features/brand/profile';
import { contentPaths } from '@/features/content/labels';
import { useContentMutations } from '@/features/content/api';
import { ImagePickerDialog } from '@/features/content/editor/AssetPickerDialog';
import { loadAppFont } from '@/features/content/editor/canvas/appFont';
import { pageView, validateDocument } from '@/features/content/document';
import { useImageLookup } from '@/features/content/templates/useImageLookup';
import { useBrand, useOrg } from '@/features/orgs/context';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { construirMenu, medidorDeMenus, type ResultadoMenu } from './disenos';
import {
  MAX_TAPAS,
  PRESETS_EVENTO,
  TIPOS,
  contarPlatos,
  datosIniciales,
  type DatosMenu,
  type FormatoMenu,
  type TipoMenu,
} from './modelos';

// «Menús»: plantillas para publicar el menú del día, las tapas, la tapa de la semana, la carta o los
// vinos, y (aparte) los eventos especiales. Escribir → elegir la foto → ver cómo queda → publicar o
// programar. Lo último abre el editor ya en «Compartir» (ahí se exporta la imagen, se escribe el pie y se
// publica o se programa con las mismas garantías de siempre).

type FotoDestino = { tipo: 'general' } | { tipo: 'tapa'; indice: number };

export function MenusPage() {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const navigate = useNavigate();
  const canEdit = can('edit');
  const mutations = useContentMutations(org.id, brand.id);

  const [tipo, setTipo] = useState<TipoMenu>('menu-dia');
  const [preset, setPreset] = useState('nochevieja');
  const [formato, setFormato] = useState<FormatoMenu>('story');
  // Lo escrito en cada plantilla se conserva al pasar a otra y volver.
  const [guardados, setGuardados] = useState<Partial<Record<string, DatosMenu>>>({});
  const clave = tipo === 'evento' ? `evento:${preset}` : tipo;
  const datos = useMemo(() => guardados[clave] ?? datosIniciales(tipo, preset), [guardados, clave, tipo, preset]);
  const cambiar = (cambios: Partial<DatosMenu>) => setGuardados((g) => ({ ...g, [clave]: { ...datos, ...cambios } }));

  const [eligiendo, setEligiendo] = useState<FotoDestino | null>(null);
  const [pagina, setPagina] = useState(0);
  const [creando, setCreando] = useState(false);

  const info = TIPOS.find((t) => t.id === tipo)!;
  const profile = useActiveProfile(brand.id);
  const theme = useMemo(
    () => themeFromProfile(profile.data ? parseProfile(profile.data.data) : null),
    [profile.data],
  );

  const fotosUsadas = useMemo(
    () => [...(datos.foto ? [datos.foto] : []), ...datos.tapas.flatMap((t) => (t.foto ? [t.foto] : [])), ...(theme.logo ? [theme.logo] : [])],
    [datos.foto, datos.tapas, theme.logo],
  );
  const imagenes = useImageLookup(brand.id, fotosUsadas);

  // El diseño, con la letra ya cargada (si no, se mediría con otra y los textos no cabrían).
  const [fuenteLista, setFuenteLista] = useState(false);
  useEffect(() => {
    let vivo = true;
    void loadAppFont().then(() => vivo && setFuenteLista(true));
    return () => {
      vivo = false;
    };
  }, []);
  const [construido, setConstruido] = useState<{ story: ResultadoMenu; post: ResultadoMenu } | null>(null);
  useEffect(() => {
    if (!fuenteLista) return;
    const timer = setTimeout(() => {
      const medir = medidorDeMenus();
      setConstruido({
        story: construirMenu(tipo, datos, 'story', theme, medir),
        post: construirMenu(tipo, datos, 'post', theme, medir),
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [fuenteLista, tipo, datos, theme]);
  const resultado = construido?.[formato] ?? null;
  const paginas = resultado?.paginas ?? 1;
  const paginaVista = Math.min(pagina, paginas - 1);

  // La vista previa: la página elegida, dibujada con el mismo motor que la exportación.
  const validado = useMemo(() => (resultado ? validateDocument(resultado.document) : null), [resultado]);
  const [vista, setVista] = useState<string | null>(null);
  const [falloVista, setFalloVista] = useState(false);
  useEffect(() => {
    if (!validado?.ok) return;
    let vivo = true;
    let url: string | null = null;
    void (async () => {
      try {
        const { renderDocument } = await import('@/features/content/editor/canvas/exporter');
        const rendered = await renderDocument(pageView(validado.document, paginaVista), imagenes, {
          format: 'jpeg',
          quality: 0.9,
          // Pantalla normal: media resolución (sobra para 340 px); con pantalla de alta densidad, entera.
          pixelRatio: Math.min(1, Math.max(0.5, (window.devicePixelRatio || 1) * 0.5)),
        });
        if (!vivo) return;
        url = URL.createObjectURL(rendered.blob);
        setVista(url);
        setFalloVista(false);
      } catch {
        if (vivo) setFalloVista(true);
      }
    })();
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [validado, imagenes, paginaVista]);
  const errorVista = falloVista || (validado !== null && !validado.ok);

  const sinPlatos = contarPlatos(tipo, datos) === 0;
  const formatoPieza = formato === 'story' ? 'story' : paginas > 1 ? 'carousel' : 'post';
  const noSePuede = !resultado || sinPlatos || (formato === 'story' && resultado.desborda) || (resultado.desborda && paginas > 10);

  async function publicar() {
    if (!resultado || noSePuede) return;
    setCreando(true);
    try {
      if (!validado?.ok) throw new Error('El diseño no es válido');
      const titulo = `${info.nombre}${datos.titulo.trim() && tipo !== 'menu-dia' ? ` · ${datos.titulo.trim()}` : ''}`.slice(0, 120);
      const item = await mutations.create.mutateAsync({ title: titulo, network: 'instagram', format: formatoPieza });
      await mutations.saveVersion.mutateAsync({
        contentId: item.id,
        document: validado.document,
        note: `Desde la plantilla de menús «${info.nombre}»`,
      });
      navigate(`${contentPaths(org.id, brand.id).item(item.id)}?compartir=1`);
    } catch (e) {
      toast.error(translateError(e));
      setCreando(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="space-y-6">
        <PageHeader title="Menús" />
        <EmptyState icon={UtensilsCrossed} title="Solo lectura" description="Para crear un menú hace falta poder editar la marca." />
      </div>
    );
  }

  const diarias = TIPOS.filter((t) => t.grupo === 'diarias');
  const eventos = TIPOS.filter((t) => t.grupo === 'eventos');

  return (
    <div className="space-y-6" data-testid="menus-page">
      <PageHeader
        title="Menús"
        description="Escribe los platos, pon la foto, mira cómo queda y publícalo o prográmalo."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-5">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">1 · Elige la plantilla</h2>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Plantillas de cada día">
              {diarias.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tipo === t.id}
                  data-testid={`menus-tipo-${t.id}`}
                  onClick={() => {
                    setTipo(t.id);
                    setPagina(0);
                  }}
                  className={cn(
                    'rounded-lg border p-3 text-left text-sm transition-colors',
                    tipo === t.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-subtle',
                  )}
                >
                  <span className="block font-semibold">{t.nombre}</span>
                  <span className="block text-xs text-muted">{t.descripcion}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-border pt-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Eventos especiales</h3>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Eventos especiales">
                {PRESETS_EVENTO.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={tipo === 'evento' && preset === e.id}
                    data-testid={`menus-evento-${e.id}`}
                    onClick={() => {
                      setTipo(eventos[0]!.id);
                      setPreset(e.id);
                      setPagina(0);
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm transition-colors',
                      tipo === 'evento' && preset === e.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-subtle',
                    )}
                  >
                    {e.nombre}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-4">
            <h2 className="text-sm font-semibold">2 · Escribe</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Antetítulo" optional>
                {(p) => <Input {...p} value={datos.kicker} onChange={(e) => cambiar({ kicker: e.target.value })} maxLength={80} />}
              </Field>
              <Field label={tipo === 'tapa-semana' ? 'Nombre de la tapa' : 'Título'}>
                {(p) => <Input {...p} value={datos.titulo} onChange={(e) => cambiar({ titulo: e.target.value })} maxLength={80} />}
              </Field>
            </div>

            {tipo === 'tapa-semana' && (
              <Field label="Descripción" hint="Una o dos frases." optional>
                {(p) => (
                  <Textarea {...p} rows={3} value={datos.descripcion} onChange={(e) => cambiar({ descripcion: e.target.value })} maxLength={400} />
                )}
              </Field>
            )}

            {(tipo === 'menu-dia' || tipo === 'vinos' || tipo === 'evento') && (
              <div className="space-y-3">
                {datos.secciones.map((s, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-border p-3" data-testid={`menus-seccion-${i + 1}`}>
                    <div className="flex items-end gap-2">
                      <Field label={`Sección ${i + 1}`} className="flex-1">
                        {(p) => (
                          <Input
                            {...p}
                            value={s.titulo}
                            maxLength={40}
                            onChange={(e) =>
                              cambiar({ secciones: datos.secciones.map((x, k) => (k === i ? { ...x, titulo: e.target.value } : x)) })
                            }
                          />
                        )}
                      </Field>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Quitar la sección ${i + 1}`}
                        onClick={() => cambiar({ secciones: datos.secciones.filter((_, k) => k !== i) })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                    <Field
                      label="Platos"
                      hint={
                        tipo === 'vinos'
                          ? 'Uno por línea. Con precio: «Nombre | 3,50 €».'
                          : 'Uno por línea. Con precio: «Nombre | 3,50 €» (opcional).'
                      }
                    >
                      {(p) => (
                        <Textarea
                          {...p}
                          rows={Math.max(3, s.texto.split('\n').length)}
                          value={s.texto}
                          onChange={(e) =>
                            cambiar({ secciones: datos.secciones.map((x, k) => (k === i ? { ...x, texto: e.target.value } : x)) })
                          }
                        />
                      )}
                    </Field>
                  </div>
                ))}
                {datos.secciones.length < 8 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => cambiar({ secciones: [...datos.secciones, { titulo: '', texto: '' }] })}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Añadir sección
                  </Button>
                )}
              </div>
            )}

            {tipo === 'tapas' && (
              <div className="space-y-3">
                {datos.tapas.map((t, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3" data-testid={`menus-tapa-${i + 1}`}>
                    <Field label={`Tapa ${i + 1}`} className="min-w-[10rem] flex-1">
                      {(p) => (
                        <Input
                          {...p}
                          value={t.nombre}
                          maxLength={80}
                          onChange={(e) =>
                            cambiar({ tapas: datos.tapas.map((x, k) => (k === i ? { ...x, nombre: e.target.value } : x)) })
                          }
                        />
                      )}
                    </Field>
                    <Field label="Precio" className="w-28">
                      {(p) => (
                        <Input
                          {...p}
                          value={t.precio}
                          maxLength={16}
                          onChange={(e) =>
                            cambiar({ tapas: datos.tapas.map((x, k) => (k === i ? { ...x, precio: e.target.value } : x)) })
                          }
                        />
                      )}
                    </Field>
                    <FotoCampo
                      etiqueta={`Foto de la tapa ${i + 1}`}
                      id={t.foto}
                      url={t.foto ? imagenes.get(t.foto) : undefined}
                      onElegir={() => setEligiendo({ tipo: 'tapa', indice: i })}
                      onQuitar={() =>
                        cambiar({ tapas: datos.tapas.map((x, k) => (k === i ? { ...x, foto: null } : x)) })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar la tapa ${i + 1}`}
                      onClick={() => cambiar({ tapas: datos.tapas.filter((_, k) => k !== i) })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
                {datos.tapas.length < MAX_TAPAS && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => cambiar({ tapas: [...datos.tapas, { nombre: '', precio: '', foto: null }] })}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Añadir tapa
                  </Button>
                )}
              </div>
            )}

            {tipo !== 'tapas' && tipo !== 'vinos' && (
              <Field label="Precio" optional>
                {(p) => <Input {...p} value={datos.precio} onChange={(e) => cambiar({ precio: e.target.value })} maxLength={24} />}
              </Field>
            )}
            <Field label="Líneas de abajo" hint="Una por línea: qué incluye, cuándo, el lema, la hora…" optional>
              {(p) => <Textarea {...p} rows={2} value={datos.pie} onChange={(e) => cambiar({ pie: e.target.value })} maxLength={400} />}
            </Field>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-fg">Color del diseño</span>
              <div className="flex items-center gap-2" role="radiogroup" aria-label="Color del diseño">
                {(
                  [
                    ['claro', 'Claro'],
                    ['oscuro', 'Oscuro'],
                  ] as const
                ).map(([e, nombre]) => (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={datos.estilo === e}
                    data-testid={`menus-estilo-${e}`}
                    onClick={() => cambiar({ estilo: e })}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm',
                      datos.estilo === e ? 'border-primary bg-primary/5' : 'border-border hover:bg-subtle',
                    )}
                  >
                    {nombre}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {info.foto !== 'por-tapa' && (
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">3 · Foto</h2>
              <p className="text-xs text-muted">{info.textoFoto} Las fotos de los platos son las reales de la biblioteca.</p>
              <FotoCampo
                etiqueta={info.foto === 'principal' ? 'Foto de la tapa' : 'Foto de fondo'}
                id={datos.foto}
                url={datos.foto ? imagenes.get(datos.foto) : undefined}
                onElegir={() => setEligiendo({ tipo: 'general' })}
                onQuitar={() => cambiar({ foto: null })}
              />
            </Card>
          )}
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{info.foto === 'por-tapa' ? '3' : '4'} · Así queda</h2>
              <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Formato">
                {(
                  [
                    ['story', 'Historia'],
                    ['post', 'Publicación'],
                  ] as const
                ).map(([f, nombre]) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={formato === f}
                    data-testid={`menus-formato-${f}`}
                    onClick={() => {
                      setFormato(f);
                      setPagina(0);
                    }}
                    className={cn('rounded-md px-3 py-1 text-sm', formato === f ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg')}
                  >
                    {nombre}
                  </button>
                ))}
              </div>
            </div>
            <div
              className={cn('relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-subtle', formato === 'story' ? 'aspect-[9/16] max-w-[260px]' : 'aspect-[4/5] max-w-[340px]')}
              data-testid="menus-vista"
            >
              {vista && !errorVista ? (
                <img src={vista} alt="Vista previa del menú" className="h-full w-full object-contain" />
              ) : (
                <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted">
                  {errorVista ? 'No se ha podido dibujar la vista previa.' : 'Dibujando…'}
                </p>
              )}
            </div>
            {paginas > 1 && (
              <div className="flex items-center justify-center gap-3 text-sm" data-testid="menus-paginas">
                <Button variant="ghost" size="sm" aria-label="Página anterior" disabled={paginaVista === 0} onClick={() => setPagina(paginaVista - 1)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <span>
                  Página {paginaVista + 1} de {paginas}
                </span>
                <Button variant="ghost" size="sm" aria-label="Página siguiente" disabled={paginaVista >= paginas - 1} onClick={() => setPagina(paginaVista + 1)}>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            )}
            {resultado && paginas > 1 && formato === 'post' && (
              <p className="text-xs text-muted">Es largo: se reparte en un carrusel de {paginas} páginas para que se lea bien.</p>
            )}
            {resultado && formato === 'story' && resultado.desborda && (
              <p className="text-xs font-medium text-danger" role="alert" data-testid="menus-aviso-largo">
                Es demasiado largo para una historia (es una sola imagen). Pásalo a «Publicación», que lo reparte en un carrusel, o
                quita algún plato.
              </p>
            )}
            {sinPlatos && <p className="text-xs text-muted">Escribe al menos un plato para poder publicarlo.</p>}
            <div className="flex flex-col gap-2">
              <Button onClick={() => void publicar()} disabled={noSePuede} loading={creando} data-testid="menus-publicar">
                Publicar o programar
              </Button>
              <p className="text-center text-xs text-muted">
                Se abre «Compartir» con el pie ya escrito. Programado no es publicado: hasta que sale, aparece en el calendario.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <ImagePickerDialog
        brandId={brand.id}
        libraryPath={`/o/${org.id}/m/${brand.id}/biblioteca`}
        uploadTo={{ organizationId: org.id }}
        open={eligiendo !== null}
        onOpenChange={(open) => !open && setEligiendo(null)}
        title="Elegir foto"
        onPick={(asset) => {
          const destino = eligiendo;
          setEligiendo(null);
          if (!destino) return;
          if (destino.tipo === 'general') cambiar({ foto: asset.id });
          else cambiar({ tapas: datos.tapas.map((x, k) => (k === destino.indice ? { ...x, foto: asset.id } : x)) });
        }}
      />
    </div>
  );
}

function FotoCampo({
  etiqueta,
  id,
  url,
  onElegir,
  onQuitar,
}: {
  etiqueta: string;
  id: string | null;
  url: string | undefined;
  onElegir: () => void;
  onQuitar: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {id && (
        <span className="block h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-subtle">
          {url && <img src={url} alt="" className="h-full w-full object-cover" />}
        </span>
      )}
      <Button variant="secondary" size="sm" onClick={onElegir} aria-label={id ? `Cambiar: ${etiqueta}` : `Elegir: ${etiqueta}`}>
        <ImagePlus className="h-4 w-4" aria-hidden />
        {id ? 'Cambiar foto' : 'Elegir foto'}
      </Button>
      {id && (
        <Button variant="ghost" size="sm" aria-label={`Quitar: ${etiqueta}`} onClick={onQuitar}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
