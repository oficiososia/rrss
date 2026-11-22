# Costes de rrss y margen por plan (22/11/2026)

Estudio del 22/11/2026 para decidir precios. **Solo documentación:** no se ha
tocado código ni configuración, no se ha llamado a ninguna API de pago, no se ha
leído ninguna clave ni se ha entrado en ninguna cuenta. Los precios de
infraestructura se han consultado hoy en las páginas oficiales que se citan
(§8); lo que no se ha visto en una fuente oficial va marcado **NO CONFIRMADO** y
lo que es cálculo o suposición propia, como *supuesto*. Los costes de IA **no se
repiten aquí**: salen de `docs/modelos-ia-comparativa.md` (opción recomendada,
con proceso en la UE).

**Hoja de cálculo editable:**
`C:\Users\migue\Desktop\Oficiosos\codigo-restaurante\rrss-recursos-comparativa\costes-rrss.xlsx`
(fuera del repositorio). Cuatro pestañas: «Supuestos» (precios y volúmenes, en
azul lo que se puede cambiar), «Costes fijos», «Coste por marca» y «Escenarios».
Todas las cifras de este documento salen de ella; si cambias un número allí, el
margen se recalcula solo. **Ábrela con Excel**: las fórmulas se calculan al
abrir (no se ha podido abrir con Excel desde esta sesión; las 273 fórmulas se
han comprobado con un evaluador aparte y dan lo mismo que este documento).

**Moneda.** Los proveedores cobran en dólares y los planes se suponen en euros
(la moneda de cuenta sigue sin decidir, `docs/facturacion.md`). Para sumar se
usa **1 € = 1,10 $**, el mismo supuesto redondo de los otros estudios; no se ha
consultado el cambio del día. Todo **sin IVA**.

---

## 1. Resumen en una página

| Pregunta | Respuesta |
|---|---|
| ¿Cuánto cuesta tenerlo encendido? | **Unos 47 € al mes** lo mínimo para cobrar al primer cliente (51 $). **Unos 108 € al mes** lo recomendado (119 $). Con unas 50 marcas, unos 122 € |
| ¿Cuánto cuesta cada marca? | **0,37 €** al mes una marca de uso ligero, **2,17 €** una normal y **9,20 €** una intensa. Más del 95 % es IA |
| ¿Se gana dinero con los precios propuestos? | Sí. Con uso típico, el margen por cliente es del **95 %** en Básico (29 €), **89 %** en Profesional (79 €) y **86 %** en Agencia (199 €), antes de costes fijos |
| ¿Y en el peor caso? | El cupo de IA hace de tope. Con todas las marcas del plan a pleno uso: 93 % en Básico, **65 %** en Profesional y **45 %** en Agencia |
| ¿Cuántos clientes hacen falta para cubrir los fijos? | Lo mínimo: **2 clientes Básico o 1 Profesional**. Lo recomendado: **4 Básico, o 2 Profesional, o 1 Agencia** |
| ¿Qué puede dispararse? | La imagen y el vídeo con IA. El resto (servidores, almacenamiento, correo) son céntimos por marca |
| ¿Qué hay que cambiar? | Bajar el cupo de IA de Agencia de 100 a 50 € y el de Profesional de 25 a 20 €, y cargar los precios reales de IA antes de vender (§6) |

Este margen es **de infraestructura**: no cuenta sueldos, horas de soporte,
gestoría, abogado ni impuestos.

---

## 2. Costes fijos al mes para lanzar

Lo que se paga aunque no haya ningún cliente. Precios en dólares, sin IVA.

| Proveedor | Qué | Mínimo viable | Recomendado | Fuente (22/11/2026) |
|---|---|---|---|---|
| **Supabase** | Producción en plan **Pro**. Incluye 10 $ de cómputo (un proyecto «Micro»), 8 GB de base de datos, 100 GB de archivos, 250 GB de salida, 100.000 usuarios al mes y 2 millones de llamadas a funciones | 25 $ | 25 $ | <https://supabase.com/pricing> |
| Supabase | Staging: se queda en una **organización gratuita aparte** (500 MB de base de datos, 1 GB de archivos; se pausa tras una semana sin uso). No se puede mezclar un proyecto gratuito dentro de la organización Pro: allí costaría 10 $ más | 0 $ | 0 $ | <https://supabase.com/pricing>, <https://supabase.com/docs/guides/platform/billing-on-supabase> |
| **Vercel** | Plan **Pro**, un asiento que despliega. Incluye 20 $ de crédito de uso al mes | 20 $ | 20 $ | <https://vercel.com/docs/plans/pro-plan> |
| Vercel | Segundo asiento que despliega (20 $ por persona; los de solo lectura son gratis) | 0 $ | 20 $ | Igual |
| **Fly.io** | Sin cuota. Parada, la máquina solo paga el disco (0,15 $ por GB y mes, unos 0,6 GB). El trabajo va por segundo (§3) | 0,09 $ | 0,09 $ | <https://fly.io/docs/about/pricing/> |
| **Cloudflare R2** | Sin cuota. 10 GB gratis; después 0,015 $ por GB y mes. Descargar es gratis | 0 $ | 0 $ | <https://developers.cloudflare.com/r2/pricing/> |
| **Resend** (correo) | Gratis: 3.000 correos al mes y **100 al día**. Pro: 20 $ con 50.000 y sin tope diario | 0 $ | 20 $ | <https://resend.com/pricing> |
| **Dominio** | Un `.com`, unos 13 $ al año. **NO CONFIRMADO** en fuente oficial (precio de terceros: unos 11 $ a precio de coste). Vercel Pro regala el primer año de un dominio `.app`, `.dev`, `.co`, `.studio` y otros | 1,10 $ | 1,10 $ | <https://vercel.com/docs/plans/pro-plan> (el regalo) |
| **GitHub** | Plan Free: 2.000 minutos de Actions al mes en repositorios privados. Minuto extra en Linux de 2 núcleos: 0,006 $. *Supuesto:* 1.000 minutos extra en el recomendado | 0 $ | 6 $ | <https://github.com/pricing>, <https://docs.github.com/en/billing/reference/actions-runner-pricing> |
| **Stripe** | Sin cuota mensual. Cobra por operación (§4) | 0 $ | 0 $ | <https://stripe.com/es/pricing> |
| **IA por API** (OpenAI, Google Cloud, fal.ai) | Sin cuota: pago por uso (§3) | 0 $ | 0 $ | `docs/modelos-ia-comparativa.md` §13 |
| IA de la casa | *Supuesto:* bolsa para pruebas a ciegas, demostraciones y las marcas propias | 5 $ | 20 $ | Supuesto propio |
| Buzón de soporte | *Supuesto:* un buzón con el dominio propio. **NO CONFIRMADO** (precio no consultado) | 0 $ | 7 $ | — |
| **Total** | | **51 $ ≈ 47 €** | **119 $ ≈ 108 €** | |

Con unas 50 marcas se añade subir el cómputo de Supabase a «Small» (5 $ netos) y
algo más de bolsa de pruebas: **unos 134 $ ≈ 122 € al mes**.

Cosas que conviene saber:

- **Vercel Hobby no vale para vender.** Las condiciones de Vercel lo limitan a
  uso personal o no comercial, y da 4 horas de CPU al mes sin poder comprar
  más. El proyecto `rrss` vive en el equipo `casa-tomas`: al pasar ese equipo a
  Pro, los 20 $ se comparten con las webs del restaurante.
- **Supabase gratuito no vale para producción:** se pausa tras una semana sin
  uso, no tiene copias de seguridad y solo da 1 GB de archivos.
- **No incluido** (no es infraestructura): el abogado para las páginas legales,
  la gestoría, seguros y las horas de trabajo.

---

## 3. Coste variable por marca y mes

### 3.1 Los tres perfiles (*supuestos propios*: aún no hay clientes de pago)

| Cada mes, una marca… | Ligero | Normal | Intenso |
|---|---|---|---|
| Publica | 8 piezas | 20 | 45 |
| Pide pies de foto a la IA | 12 | 30 | 120 |
| Da órdenes al copiloto | 40 | 150 | 500 |
| Cambia el fondo de fotos con IA | 2 | 10 | 35 |
| Genera imágenes con IA | 1 | 5 | 30 |
| Anima fotos con IA (clips de 5 s) | 0 | 2 | 10 |
| Subtitula audio | 0,5 min | 3 min | 12 min |
| Quita fondos en el servidor (Fly) | 5 | 20 | 80 |
| Monta reels | 1 | 4 | 12 |
| Ocupa en almacenamiento | 1 GB | 5 GB | 20 GB |

El perfil «Intenso» equivale, por marca, al «volumen base» de
`docs/modelos-ia-comparativa.md` §2 repartido entre 7-8 marcas.

### 3.2 Precio de cada cosa

| Partida | Precio | De dónde sale |
|---|---|---|
| Pie de foto | 0,0077 $ | Claude Sonnet 5.5 por Vertex UE (comparativa §5) |
| Orden del copiloto | 0,00036 $ | Claude Haiku 5.5 por Vertex UE (comparativa §5) |
| Cambiar el fondo de una foto | 0,11 $ | OpenAI en la UE; *estimación*, tarifa **NO CONFIRMADA** (comparativa §6) |
| Imagen generada | 0,058 $ | OpenAI, calidad media, UE; **NO CONFIRMADA** (comparativa §8) |
| Clip animado de 5 s | 0,30 $ | MiniMax H3 por fal.ai, 0,06 $ por segundo; **NO CONFIRMADO** (`docs/ia-medios.md` §15) |
| Subtítulos | 0,005 $ por minuto | OpenAI `gpt-transcribe` con el 10 % de la UE (comparativa §7) |
| Quitar el fondo en el servidor | **0,0007 $** por foto | Fly: 23 s de modelo medidos (dato del encargo) + 10 s de arranque + 30 s de espera, a 0,0000113 $ por segundo |
| Montar un reel | 0,0011 $ | Fly: *supuesto* de 60 s de montaje + arranque + espera |
| Almacenamiento | 0,015 $ por GB y mes | Cloudflare R2; los primeros 10 GB de la cuenta son gratis |

**Cómo sale el precio de Fly.** La máquina del trabajador es `shared-cpu-2x`
con 4 GB en Fráncfort (`worker/fly.toml`). Fly publica hoy 13,39 $ al mes por
esa máquina con 2 GB en Ashburn y **6 $ por cada GB adicional** (el estudio de
alojamiento suponía 5 $). Fráncfort es un 15 % más caro (*supuesto:* la misma
subida que publica para la máquina de 1 GB, 7,73 $ frente a 6,70 $). Resultado:
**unos 29 $ al mes si estuviera encendida todo el mes**, es decir, 0,04 $ por
hora. Como se apaga sola, mil recortes cuestan unos 0,70 $.

### 3.3 Resultado por marca (todas las funciones encendidas)

| Partida | Ligero | Normal | Intenso |
|---|---|---|---|
| Pies de foto | 0,09 $ | 0,23 $ | 0,92 $ |
| Copiloto | 0,01 $ | 0,05 $ | 0,18 $ |
| Fotos editadas con IA | 0,22 $ | 1,10 $ | 3,85 $ |
| Imágenes generadas | 0,06 $ | 0,29 $ | 1,74 $ |
| Clips animados con IA | 0 $ | 0,60 $ | 3,00 $ |
| Subtítulos | 0,00 $ | 0,01 $ | 0,06 $ |
| Recortes en Fly | 0,00 $ | 0,01 $ | 0,06 $ |
| Reels en Fly | 0,00 $ | 0,00 $ | 0,01 $ |
| Almacenamiento | 0,02 $ | 0,08 $ | 0,30 $ |
| **Total en dólares** | **0,41 $** | **2,38 $** | **10,12 $** |
| **Total en euros** | **0,37 €** | **2,17 €** | **9,20 €** |
| De eso, IA | 95 % | 96 % | 96 % |

Lo que no aparece porque no llega a un céntimo por marca: la base de datos y
las funciones de Supabase (caben de sobra en lo incluido en Pro), el tráfico de
Vercel (la web es estática y los 20 $ de crédito lo cubren) y el correo.

**Lectura:** la imagen (editar y generar) y el vídeo con IA son más de cuatro
quintas partes del coste. El texto, los subtítulos, los reels, los recortes y el
almacenamiento son calderilla incluso en el perfil intenso.

**Por plan no cuesta lo mismo**, porque no todos incluyen lo mismo. La propuesta
de `docs/facturacion.md` da a Básico solo texto, y a Profesional y Agencia
texto, imagen, reels y publicación (**sin vídeo con IA**):

| IA por marca y mes | Ligero | Normal | Intenso |
|---|---|---|---|
| En Básico (solo texto) | 0,11 $ | 0,29 $ | 1,10 $ |
| En Profesional y Agencia (sin vídeo con IA) | 0,39 $ | 1,69 $ | 6,75 $ |
| Con todo, incluido el vídeo con IA | 0,39 $ | 2,29 $ | 9,75 $ |

---

## 4. Margen por plan y punto de equilibrio

### 4.1 Comisiones de Stripe e IVA

- Tarifa estándar en España (<https://stripe.com/es/pricing>, 22/11/2026):
  **1,5 % + 0,25 €** por cobro con tarjeta estándar del Espacio Económico
  Europeo, más **0,7 %** de Stripe Billing por ser suscripción. Total: 2,2 % +
  0,25 €. Sin cuota mensual.
- Más caras: tarjetas «premium» del EEE 2,8 %, Reino Unido 2,5 %,
  internacionales 3,15 %. Una disputa (contracargo) cuesta 20 €.
- Stripe Tax, si se usa para calcular el IVA: 0,5 % más por cobro. Sin decidir
  (`docs/facturacion.md`); en los cálculos está **apagado**.
- **IVA (nota).** Los precios de los planes van sin IVA; al cliente español se
  le cobra un 21 % más, que no es ingreso. Pero Stripe calcula su comisión sobre
  **lo que paga el cliente, IVA incluido**: un plan de 29 € se cobra a 35,09 € y
  la comisión es 1,02 € (un 3,5 % del precio sin IVA). Las facturas de los
  proveedores extranjeros suelen venir sin IVA (inversión del sujeto pasivo):
  es neutro para la empresa, pero **confírmalo con la gestoría**.

### 4.2 Margen de un cliente

«Uso típico» = las marcas que de verdad usa el cliente (*supuesto:* 1, 3 y 10)
con una mezcla de 30 % ligeras, 50 % normales y 20 % intensas. «Peor caso» =
todas las marcas del plan, todas intensas.

| | Básico (29 €) | Profesional (79 €) | Agencia (199 €) |
|---|---|---|---|
| **Uso típico** | 1 marca | 3 marcas | 10 marcas |
| IA | 0,36 € | 6,30 € | 21,02 € |
| Trabajador de Fly | 0,02 € | 0,07 € | 0,23 € |
| Almacenamiento | 0,07 € | 0,28 € | 0,93 € |
| Comisiones de Stripe | 1,02 € | 2,35 € | 5,55 € |
| **Coste del cliente** | **1,47 €** | **9,00 €** | **27,72 €** |
| **Margen** | **27,53 € (95 %)** | **70,00 € (89 %)** | **171,28 € (86 %)** |
| **Peor caso** | 1 marca intensa | 5 marcas intensas | 25 marcas intensas |
| IA que pedirían | 1,00 € | 30,70 € | 153,49 € |
| IA que se paga (tope = cupo) | 1,00 € | **25,00 €** | **100,00 €** |
| **Margen** | **26,85 € (93 %)** | **50,99 € (65 %)** | **90,49 € (45 %)** |

- **El cupo de IA es el freno.** En el peor caso, Profesional y Agencia chocan
  con su cupo (25 y 100 €) y la base de datos no deja gastar más. Por eso el
  margen nunca baja de esas cifras… **siempre que los precios de IA cargados en
  la plataforma sean los reales** (hoy son los del simulador, ver §5).
- **Agencia es el plan más justo:** su cupo es la mitad del precio. Y sale a
  7,96 € por marca frente a los 29 € de Básico.
- Si se añadiera el **vídeo con IA** a Profesional y Agencia sin tocar el
  precio, el margen típico bajaría a 85 % y 82 % (el peor caso no cambia: manda
  el cupo).

### 4.3 Punto de equilibrio (cubrir los costes fijos)

| Para cubrir… | Solo con Básico | Solo con Profesional | Solo con Agencia |
|---|---|---|---|
| Los fijos mínimos (47 €) | 2 clientes (2 marcas) | 1 cliente | 1 cliente |
| Los fijos recomendados (108 €) | **4 clientes (4 marcas)** | **2 clientes (unas 6 marcas)** | **1 cliente (unas 10 marcas)** |
| Los recomendados, en el peor caso | 5 clientes | 3 clientes | 2 clientes |

Dicho de otra forma: **con 4 clientes Básico (116 € al mes) la infraestructura
recomendada está pagada.** A partir de ahí, de cada euro nuevo quedan entre 85 y 95
céntimos (con uso típico).

---

## 5. Qué puede dispararse y qué topes hay

### 5.1 Las cinco partidas de riesgo

| N.º | Riesgo | Por qué | Cuánto puede ser |
|---|---|---|---|
| 1 | **Imagen con IA con precios mal cargados** | El cupo protege solo si la tabla de precios de la plataforma es la real. Hoy tiene precios del simulador y los modelos «nacen inactivos y sin precio verificado». OpenAI cobra por tokens y su tarifa por imagen no está confirmada | Si una edición costara 0,26 $ (la cota que reserva rrss) en vez de 0,11 $, el coste de una marca normal pasa de 2,38 a 3,88 $ |
| 2 | **Vídeo con IA (fal.ai)** | Es lo más caro por unidad: 0,30 $ un clip de 5 s y hasta 0,84 $ uno de 10 s con el modelo de respaldo. Precios **sin confirmar** (la ficha y la página general de fal.ai no coinciden) | 10 clips al mes son 3 $ por marca: casi un tercio del coste de una marca intensa |
| 3 | **Plan Agencia lleno y cupos puestos a mano** | 25 marcas por 199 € con 100 € de cupo: en el peor caso el margen baja al 45 %. Además, un superadministrador puede sobrescribir el cupo, y los planes «Heredado» y «Enterprise» no tienen límites de marcas ni de almacenamiento | Hasta 100 € al mes por cada cliente Agencia; sin tope en un cupo sobrescrito |
| 4 | **Modelo de texto caro por configuración** | Staging tiene hoy el copiloto con `gpt-6.1-terra`, diez veces más caro que Haiku 5.5. Con Sonnet sería veinte veces | Poco en euros: una marca intensa pasa de 10,12 a 11,74 $. Cuenta dentro del cupo |
| 5 | **Lo que no tiene tope mensual** | Recortes y reels en Fly (solo hay un máximo de 5 trabajos a la vez por marca), una máquina de Fly que no se apague, la salida de Supabase cuando las fotos pasan por `drive-media`, los minutos de GitHub Actions | Poco dinero, pero sin freno: Fly encendida todo el mes, unos 29 $; salida de Supabase, 0,09 $ por GB por encima de 250 GB |

Otros dos que no son de uso: el **tipo de cambio** (con el dólar a la par, el
margen baja 2-3 puntos) y las **subidas de precio** de los proveedores (Fly
subió la memoria este año; Gemini 3.8 Flash se duplica el 01/01/2027).

### 5.2 Topes que ya existen en el producto

| Tope | Dónde está | Estado |
|---|---|---|
| **Cupo mensual de IA por organización.** Se reserva el coste máximo antes de llamar; sin cupo no se llama al proveedor | Base de datos (`ai_reserve_generation`); errores `AI001` y `AI002` | Implementado y probado en base de datos. **Sin probar con proveedores reales** |
| Funciones por plan (texto, imagen, vídeo, reels, publicación) | Base de datos, error `PL002` | Implementado y probado |
| Límite de marcas, personas y almacenamiento por plan | Base de datos, error `PL001` | Implementado y probado |
| Plan «Prueba» con cupo 0: quien no paga no gasta IA | Plan por defecto | Implementado |
| Coste máximo enseñado antes de generar | Diálogos de imagen, edición y vídeo | Implementado |
| OpenAI: se descuenta del cupo la cota reservada (hasta 0,26 $), no el consumo real | `docs/ia-medios.md` §13 | Implementado. Juega a favor: el cupo se agota antes que el dinero |
| Vídeo con IA: 10 s como máximo por clip; apagado por defecto | `ai-media`, `VITE_AI_ANIMATE_ENABLED` | Implementado, sin probar con fal.ai real |
| Máximo de 5 trabajos de medios a la vez por marca (reels, recortes) y 20 extracciones | Base de datos (`request_media_job`) | Implementado y probado |
| Recorte en la función de Vercel: 60 por persona y día, 600 por marca y mes | Migración `20261213120000` | Implementado. La función está **apagada** por defecto y la migración sin aplicar |
| Reel de 90 s como máximo; 50 MB por archivo; un intento dura como mucho 1 hora | Trabajador | Implementado |
| La máquina de Fly se apaga sola al vaciar la cola | `worker/fly.toml` | Implementado; en Fly, lo que diga la primera factura |
| Tope de gasto de Supabase Pro, activado por defecto | Panel de Supabase | Es del proveedor. Qué partidas cubre: **NO CONFIRMADO** hoy |
| Aviso de gasto de Vercel a los 200 $ y pausa opcional al llegar al límite | Panel de Vercel | Es del proveedor; hay que configurar el límite duro |

### 5.3 Topes que faltan

1. **Precios reales de IA cargados y verificados** en la plataforma. Sin esto el
   cupo mide con una regla falsa (pendiente P1 en `docs/PENDIENTES.md`).
2. **Alertas de gasto**: de cupo, del coste de IA y de errores (pendiente P1,
   «Vigilancia»). Hoy nadie se entera si una partida se dispara.
3. **Límite de gasto en el panel de cada proveedor de IA** (OpenAI, Google
   Cloud, fal.ai): saldo de prepago sin recarga automática o presupuesto
   mensual. Cómo se configura en cada uno: **NO CONFIRMADO** hoy.
4. **Tope mensual de recortes en el servidor y de reels por marca.** Hoy solo
   se limita cuántos hay a la vez. Es barato, pero no tiene techo.
5. **Reparto del cupo entre las marcas de una organización.** En una agencia,
   una sola marca puede gastarse el cupo de las 25.
6. **Bolsas extra de IA de pago.** Cuando un cliente agota el cupo, hoy solo
   puede esperar al mes siguiente o pedir que se lo suban a mano (gratis).
7. **Tope de clips de vídeo con IA por plan** (en número, no solo en dinero).
8. **Aviso si la máquina de Fly lleva encendida más de unas horas.**

---

## 6. Recomendaciones

### 6.1 Qué contratar ahora y cuándo subir

| Proveedor | Ahora | Subir cuando… |
|---|---|---|
| Supabase | **Pro (25 $)** para producción, con el tope de gasto activado. Staging, en una organización gratuita aparte | La base de datos vaya justa de memoria o conexiones: cómputo «Small» (+5 $). *Supuesto:* hacia las 30-50 marcas; sin medir |
| Vercel | **Pro con 1 asiento (20 $)** antes del primer cobro. Poner un límite duro de gasto (por ejemplo 40 $) | Un segundo asiento (+20 $) si despliegan dos personas |
| Fly.io | Tarjeta y nada más (pago por segundo). Borrar la máquina sobrante que cita `docs/PENDIENTES.md` | No hace falta: con 50 marcas normales son unas 23 horas de máquina al mes, **menos de 1 $** |
| Cloudflare R2 | Cuenta gratuita, cubo en la UE | Solo se paga al pasar de 10 GB: con 50 marcas, unos 4 € al mes |
| Resend | **Gratis** (3.000 al mes, 100 al día) | Pro (20 $) al pasar de 100 correos en un día o al añadir avisos por correo (impagos, informes) |
| Dominio | Uno propio. Si vale un `.app` o `.studio`, el primer año lo regala Vercel Pro | — |
| GitHub | Plan Free. Poner un presupuesto de Actions con tope (por ejemplo 10 $) | Si el CI se queda sin minutos a mitad de mes |
| Stripe | Tarifa estándar, sin cuotas | Decidir Stripe Tax (0,5 %) con la gestoría |
| IA | Las claves en el orden de `docs/modelos-ia-comparativa.md` §1. En cada panel, **saldo de prepago pequeño y sin recarga automática** al empezar | Al tener un mes de facturas reales: cargar los precios reales en la plataforma |

### 6.2 Cupos de IA por plan para no perder dinero

**Regla propuesta:** que el cupo de IA no pase de la **cuarta parte del precio**
del plan. Así, aunque todos los clientes lo agoten, queda más del 70 %.

| Plan | Precio | Cupo propuesto hoy | % del precio | **Cupo recomendado** | Margen en el peor caso |
|---|---|---|---|---|---|
| Básico | 29 € | 5 € | 17 % | **3 €** (solo texto: 3 € son unos 400 pies de foto) | 93 % |
| Profesional | 79 € | 25 € | 32 % | **20 €** | 65 % → **71 %** |
| Agencia | 199 € | 100 € | 50 % | **50 €** | 45 % → **71 %** |

Además:

- **Descontar el cupo con un recargo del 30 %** sobre el coste real (es decir,
  poner en la tabla de precios de IA el coste × 1,3). Cubre los errores de
  estimación, el cambio de moneda y las subidas. En la hoja es la celda
  «Recargo sobre el coste de IA».
- **Vídeo con IA fuera de los planes base.** Venderlo como extra, o incluirlo
  solo en Agencia. Con el cupo recomendado, 20 € dan para unos 70 clips de 5 s.
- **Bolsas extra de pago** cuando se agote el cupo (por ejemplo, 10 € de cupo
  por 10 €, que cuestan 7,70 € con el recargo). Hoy no existen en el producto.
- **Agencia:** pensar en un precio por marca adicional a partir de cierto
  número, porque a 7,96 € por marca es el plan con menos margen.
- No dar cupo a mano sin apuntarlo: un cupo sobrescrito se salta estas cuentas.

### 6.3 Tres escenarios

*Supuestos propios:* el reparto de clientes por plan, 30 % de marcas ligeras,
50 % normales y 20 % intensas, y los precios y cupos de la propuesta actual.

| | **5 marcas** | **20 marcas** | **50 marcas** |
|---|---|---|---|
| Clientes | 3 Básico + 1 Profesional (2 marcas) | 6 Básico + 2 Profesional (3 marcas) + 1 Agencia (8 marcas) | 12 Básico + 6 Profesional (3 marcas) + 2 Agencia (10 marcas) |
| **Ingresos al mes** (sin IVA) | **166 €** | **531 €** | **1.220 €** |
| Comisiones de Stripe | 5 € | 16 € | 37 € |
| IA | 5 € | 32 € | 84 € |
| Trabajador de Fly | 0,10 € | 0,42 € | 1,07 € |
| Almacenamiento | 0,25 € | 1,57 € | 4,21 € |
| Costes fijos | 47 € (mínimo) | 108 € (recomendado) | 122 € |
| **Coste total** | **58 €** | **158 €** | **249 €** |
| **Margen al mes** | **108 € (65 %)** | **373 € (70 %)** | **971 € (80 %)** |
| Coste por marca | 11,52 € | 7,92 € | 4,98 € |
| **Si todas las marcas fueran intensas y con vídeo con IA** | 93 € (56 %) | 276 € (52 %) | 713 € (58 %) |

Con pocos clientes mandan los costes fijos; con muchos, la IA. En ningún
escenario la infraestructura se come más de la mitad de los ingresos.

---

## 7. Supuestos propios y lo no confirmado

**Supuestos que son míos** (todos se cambian en la pestaña «Supuestos»):

1. El cambio 1 € = 1,10 $ y que los planes se cobran en euros.
2. Los tres perfiles de uso y la mezcla 30/50/20. No hay datos reales de uso.
3. El reparto de clientes por plan y las marcas que usa cada uno (1, 3 y 10).
4. Que el cupo de IA se descuenta a precio de coste (recargo 0 %).
5. El reel: 60 s de montaje en Fly (sin medir con vídeos reales de móvil).
6. El 15 % de recargo de Fráncfort para la máquina de 4 GB.
7. La bolsa de pruebas de IA, el buzón de soporte y los minutos extra de Actions.
8. Los clientes pagan con tarjeta estándar del EEE y Stripe Tax está apagado.

**NO CONFIRMADO en fuente oficial hoy:**

1. **Fly.io:** el precio de `shared-cpu-2x` con 4 GB en Fráncfort (no se
   publica; es un cálculo). Y si la cuenta tiene gasto perdonado: la
   documentación de hoy habla de 5 $ de uso al mes en organizaciones personales
   del plan gratuito; `docs/alojamiento.md` decía que no se cobran facturas de
   menos de 5 $.
2. **Dominio:** el precio (solo visto en páginas de terceros).
3. **Vercel:** la frase exacta de «solo uso no comercial» de Hobby no aparece
   en la página de precios leída hoy; consta en sus condiciones (visto por
   búsqueda). Y las peticiones incluidas en Pro: la página de precios dice 10
   millones al mes y la documentación, 1 millón. No afecta a estas cuentas.
4. **Supabase:** qué cubre exactamente el tope de gasto y el precio de las
   copias al minuto (PITR). El consumo real de funciones (la aplicación sondea
   cada 60 s) no se ha medido.
5. **GitHub Actions:** los minutos que gasta de verdad el CI de `rrss` (no se
   ha mirado la cuenta).
6. **IA:** todo lo que ya marca `docs/modelos-ia-comparativa.md` §12; sobre
   todo la tarifa por imagen de OpenAI y los precios de fal.ai.
7. **Recorte en Fly: 23 s por foto.** Es el dato del encargo;
   `docs/edicion-fotos.md` todavía dice «sin medir (estimación 20-35 s)».
8. **Stripe:** probado solo con un Stripe simulado (`docs/facturacion.md`); las
   comisiones son las de la página pública, no las de una cuenta real.
9. **Buzón de soporte:** precio no consultado.

---

## 8. Fuentes (consultadas el 22/11/2026)

- Supabase: <https://supabase.com/pricing>,
  <https://supabase.com/docs/guides/platform/billing-on-supabase>
- Vercel: <https://vercel.com/pricing>, <https://vercel.com/docs/plans/pro-plan>,
  <https://vercel.com/docs/plans/hobby>,
  <https://vercel.com/docs/functions/usage-and-pricing> (en Fráncfort: 0,184 $
  por hora de CPU activa y 0,0152 $ por GB-hora de memoria),
  <https://vercel.com/docs/limits/fair-use-guidelines>,
  <https://vercel.com/legal/terms>
- Fly.io: <https://fly.io/docs/about/pricing/> (la página comercial
  `fly.io/pricing` no cargó)
- Cloudflare R2: <https://developers.cloudflare.com/r2/pricing/> (modificada el
  30/10/2026)
- Resend: <https://resend.com/pricing>
- Stripe: <https://stripe.com/es/pricing>
- GitHub: <https://github.com/pricing>,
  <https://docs.github.com/en/billing/reference/actions-runner-pricing>
- IA: `docs/modelos-ia-comparativa.md` §13 (no se han vuelto a consultar)
- Del repositorio: `docs/facturacion.md` (planes), `docs/alojamiento.md` (Fly),
  `docs/almacenamiento-r2.md` (R2), `docs/edicion-fotos.md` (recorte),
  `docs/ia-medios.md` (cotas y vídeo), `docs/PENDIENTES.md`, `docs/ESTADO.md`,
  `worker/fly.toml`
