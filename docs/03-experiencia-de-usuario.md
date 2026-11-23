# Experiencia de usuario

## Principios

1. **Pocas decisiones, bien puestas.** El usuario dice qué quiere; el producto
   decide el cómo. Lo avanzado aparece cuando hace falta.
2. **Nada se publica sin que alguien lo apruebe.**
3. **Cada pantalla dice la verdad**: programado no es publicado; una función que
   aún no existe no aparece en el menú; lo que requiere una acción manual se avisa.
4. **Siempre se puede volver atrás**: borradores con autoguardado, versiones,
   confirmación antes de borrar.
5. **Sirve en el móvil**, con claro y oscuro, y con teclado y lector de pantalla
   (objetivo WCAG 2.2 AA).

## Navegación

Menú final del producto (nueve áreas, no más):

| Área | Qué resuelve | Fase |
|---|---|---|
| **Inicio** | Qué toca hoy: próximas publicaciones, pendientes, recomendaciones | 1 (versión inicial) |
| **Crear** | Centro de creación: instrucción, recursos, redes, formato, propuestas, edición, programar | 2 |
| **Calendario** | Mes, semana, día, por campaña y por red | 3 |
| **Biblioteca** | Fotos, vídeos, logotipos y documentos de la marca | 1 |
| **Campañas** | Series y lanzamientos | 3–4 |
| **Estadísticas** | Resultados e informes | 5 |
| **Asistente** | Estratega: preguntas y planes en lenguaje natural | 4 |
| **Marca** | Perfil de marca, fuentes, versiones | 1 |
| **Configuración** | Equipo, redes conectadas, organización, plan | 1 (equipo y organización) |

Hoy el menú muestra solo lo construido: Inicio, Biblioteca, Marca, Equipo y
Configuración. Las demás áreas se añaden cuando funcionen de verdad.

Un solo selector, el de **marca** (en el menú lateral; en móvil y tablet, en la
cabecera): lista todas las marcas a las que se tiene acceso, agrupadas por
organización si hay más de una, y la organización se lee debajo del nombre de la
marca (desde el 23/11/2026; antes había dos selectores, organización y marca).
Una agencia entra a una vista con todas sus marcas; una empresa con una sola
marca entra directa.

## Recorridos principales

**Alta (nuevo cliente, sin intervención técnica)**
Registro → crear organización (empresa o agencia) → asistente de marca en siete
pasos cortos (básicos, negocio, público y objetivos, voz, identidad visual,
fuentes, resumen) → marca operativa. Solo el nombre es obligatorio; el borrador
se guarda solo; se puede importar un JSON en lugar de rellenar.

**Marca**
Editor por secciones con indicador de completitud y «siguientes pasos». Cada
guardado es una versión con autor, fecha y nota; se puede ver y restaurar
cualquiera. Exportar a JSON en un clic.

**Biblioteca**
Arrastrar archivos → progreso por archivo → aviso si ya existe uno idéntico →
rejilla con filtros por tipo, etiqueta y carpeta. Cada recurso guarda sus
derechos de uso (licencia, titular, caducidad).

**Equipo**
Invitar por correo con un rol → la persona abre el enlace, entra o se registra,
y acepta. Por ahora el enlace se copia y se envía a mano (el envío automático
necesita un proveedor de correo).

**Crear (Fase 2, diseño)**
Una sola caja: «Prepárame las redes de la próxima semana». El producto muestra
qué ha entendido, qué va a hacer y el progreso de cada paso; devuelve propuestas
editables, con la comprobación de marca visible, y un botón para programar lo
aprobado.

## Estados y mensajes

- Carga con esqueletos, no con pantallas en blanco.
- Vacíos que explican qué hacer a continuación.
- Errores en español, con la causa y la salida («No tienes permiso para…»,
  «El archivo supera los 50 MB»).
- Acciones destructivas con confirmación que nombra lo que se va a borrar.

## Pendiente de diseño

Atajos de teclado, vistas previas realistas por red, comentarios y menciones,
notificaciones, y el editor visual por capas.
