# Grabaciones para el banco del copiloto

Esta carpeta es para **tus propias grabaciones**: órdenes dichas en voz alta, tal
como las dirías en el editor. El banco las transcribe con el transcriptor del
servidor (`ai-transcribe`), manda el texto al copiloto y comprueba si hace lo que
se esperaba. Así se ve cuánto se pierde por el camino de la voz (nombres de
platos, cifras, muletillas) y no solo con órdenes escritas.

Aquí no hay ninguna grabación de ejemplo: sin grabaciones, el modo de audio se
salta con un aviso.

## Cómo grabar

- **Formato.** Lo más cómodo es `.wav` (cualquier frecuencia, mono o estéreo, sin
  comprimir): el banco lo pasa a 16 kHz mono. También valen `.m4a` (la grabadora
  del móvil) y `.webm`, pero para esos hace falta tener `ffmpeg` instalado y en el
  PATH; si no está, esas grabaciones se saltan y se dice.
- **Una orden por archivo**, de menos de 2 minutos (lo normal son 3-10 segundos).
- **Habla como hablas de verdad**: con pausas, «eh…», correcciones («no, mejor…»).
  Eso es justo lo que se quiere medir.
- **Sin datos personales de terceros** (nombres de clientes, teléfonos reales): el
  audio sale hacia el proveedor del transcriptor.
- **Nombres de archivo** sencillos, sin espacios: `titulo-arriba.wav`,
  `menu-del-dia.m4a`.

## `casos.json`

Al lado de las grabaciones va un archivo `casos.json` que dice qué se espera de
cada una. Es una lista; cada elemento tiene el archivo y el caso:

```json
[
  { "archivo": "sube-el-titulo.wav", "caso": "simple-sube-titulo" },
  { "archivo": "menu-otono.m4a", "caso": "titubeo-menu-otono" },
  {
    "archivo": "paella-domingo.wav",
    "caso": {
      "order": "Pon de título Paella los domingos",
      "document": "vacio",
      "expected": [{ "op": "add_text", "text": "Paella los domingos", "style": "title" }]
    }
  }
]
```

- `"caso"` puede ser el **identificador de un caso del banco** (están en
  `scripts/copiloto-banco/casos.ts`; se ven todos con
  `npx vite-node scripts/copiloto-banco.ts --detalle`). Entonces la grabación debe
  decir esa misma orden, con tus palabras y titubeos.
- O puede ser **un caso propio**, con:
  - `order`: lo que dices en la grabación (sirve para compararlo con lo transcrito);
  - `document`: de qué documento se parte: `vacio`, `menu`, `seleccion` (el menú
    con el título elegido) o `carrusel`;
  - `expected`: las operaciones que se esperan, igual que en los casos del banco
    (`op` y los campos clave; las capas por su identificador: `titulo`,
    `subtitulo`, `logo`, `fondo`…);
  - opcionales: `anyOrder` (las operaciones pueden venir en cualquier orden),
    `note` (se espera además una frase para la persona) y `assets` (fotos elegidas:
    `canas`, `terraza`, `spinning`).

Una grabación que no esté en `casos.json` no se usa (el banco lo avisa).

## Cómo lanzarlo

El modo de audio solo funciona con `--apply` (llama al servicio real y **cuesta**:
una transcripción y una llamada al copiloto por grabación y ruta). Con las cuatro
variables `COPILOTO_BANCO_*` puestas (ver el principio de
`scripts/copiloto-banco.ts`):

```
npx vite-node scripts/copiloto-banco.ts --apply --audio scripts/copiloto-banco/audio --modos tools --caso simple-sube-titulo
```

(`--caso` o `--grupo` limitan las órdenes escritas que se envían además de las
grabaciones; las grabaciones se envían todas.)

Al final sale una tabla con cada grabación: lo que se dijo, lo que entendió el
transcriptor y si el copiloto acertó.

## Privacidad

Las grabaciones son tuyas y no se suben al repositorio: el `.gitignore` de esta
carpeta deja fuera los `.wav`, `.m4a` y `.webm`. Lo que sí se puede subir es
`casos.json`.
