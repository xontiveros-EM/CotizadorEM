# Configuración manual del Cotizador EM Agency

No es necesario cambiar las conexiones de TSI en Codex. Trabaja en el navegador con las cuentas de EM Agency. Esta guía no publica por sí sola el sitio.

Destino: GitHub xontiveros-EM/CotizadorEM.
Supabase: xguieynlzqutjhehqdnk.
Dirección prevista de la web, todavía sin activar:
https://xontiveros-em.github.io/CotizadorEM/

## 1. Corregir la carga de GitHub

La revisión del repositorio encontró todos los archivos sueltos en la primera pantalla. Faltan las carpetas src, public y supabase; así no puede construirse la aplicación.

En Windows:
1. Busca CotizadorEM-CARGA-MANUAL.zip en la carpeta EM AGENCY.
2. Haz clic derecho sobre el ZIP y elige Extraer todo.
3. Abre la carpeta extraída. Debes ver carpetas como src, public, supabase, tests, docs, manual y .github, junto a package.json e index.html.
4. No descargues los archivos uno por uno desde la vista del ZIP, porque se pierden sus carpetas y pueden cambiar de nombre.
5. En GitHub abre CotizadorEM, selecciona Add file > Upload files.
6. Arrastra la selección completa de carpetas y archivos de la carpeta extraída. Conserva sus nombres y carpetas.
7. Confirma la carga con el mensaje Preparar cotizador y publicación manual.
8. Comprueba que existen src/main.js, public/brand/em-agency.png, supabase/schema.sql y .github/workflows/publicar.yml.

No es necesario borrar todo el repositorio para añadir estas carpetas. Los archivos sueltos antiguos pueden ordenarse después; el funcionamiento depende de las rutas correctas.

La carga incluye solo código y configuración pública. No incluye .env real, costos internos, catálogo de talentos, PDF de muestra ni dependencias instaladas.

### Visibilidad y documento interno publicado

El repositorio actual está público y contiene tabulador.md, un documento con costos y comisiones. Para mantener esa información reservada, cambia el repositorio a Private en Settings > General > Danger Zone > Change repository visibility.

El paquete nuevo no contiene ese documento. Borrar su copia actual no elimina el contenido de versiones anteriores del repositorio.

GitHub Pages en repositorios privados requiere un plan que lo permita. Si Settings > Pages solicita mejorar el plan, deja el repositorio privado y no pagues ni lo vuelvas público por seguir esta guía: se elegirá otra forma de alojar la web. El código queda preparado sin cambiar tus conexiones.

## 2. Crear la base de Supabase

Abre directamente el proyecto:
https://supabase.com/dashboard/project/xguieynlzqutjhehqdnk

Si ya ejecutaste supabase/schema.sql correctamente, no lo repitas.

Si no lo has ejecutado:
1. Abre SQL Editor > New query.
2. Abre el archivo supabase/schema.sql del paquete.
3. Copia TODO su contenido, pégalo y pulsa Run.
4. Debe terminar sin errores. El archivo crea tablas, permisos, folios y buckets.

Puedes comprobar el resultado ejecutando manual/comprobar-base.sql. Debe mostrar siete tablas: company_settings, instagram_accounts, rates, quotes, quote_items, quote_events y sheet_sync.

## 3. Crear acceso para entrar al cotizador

El cotizador usa correo y contraseña, independientes de las cuentas administrativas de GitHub y Supabase.

1. En Supabase abre Authentication > Users.
2. Selecciona Add user > Create new user.
3. Escribe el correo y la contraseña que usarás en el cotizador.
4. Si aparece Auto Confirm User, actívalo para ese usuario inicial.
5. Crea el usuario y copia su UID/UUID.
6. Abre SQL Editor y ejecuta manual/autorizar-usuario.sql después de sustituir el marcador por ese UUID.
7. No compartas la contraseña en el chat ni la subas a GitHub.

No basta con enviar una invitación: la aplicación actual no tiene una pantalla para establecer contraseña desde una invitación.

## 4. Activar PDF desde el editor de Supabase

Este paquete incluye un archivo único para evitar copiar manualmente varias carpetas.

1. Abre Edge Functions > Deploy a new function > Via Editor.
2. Usa exactamente el nombre quote-documents.
3. Sustituye el contenido del editor por TODO el archivo manual/quote-documents.ts.
4. Mantén habilitada la verificación de JWT/autenticación de la función.
5. Pulsa Deploy function.
6. Abre Edge Functions > Secrets y añade:

ALLOWED_ORIGIN = https://xontiveros-em.github.io
APP_URL = https://xontiveros-em.github.io/CotizadorEM/

ALLOWED_ORIGIN lleva únicamente el origen, sin /CotizadorEM/. APP_URL sí lleva la carpeta y la barra final.

Para probar la app local antes de publicar, usa temporalmente ALLOWED_ORIGIN = http://127.0.0.1:4173. Cámbialo por el origen de GitHub al pasar a la web.

La función usa las credenciales del servidor que proporciona el proyecto. No copies la clave service_role ni una clave secret en GitHub. No necesitas configurar Google todavía para generar y descargar PDF; la sincronización quedará pendiente.

El archivo único se generó desde los mismos componentes de PDF e integración de la aplicación. Su generación de PDF y controles de sesión pasaron pruebas locales con respuestas simuladas; queda pendiente la prueba contra tu proyecto real.

## 5. Preparar y aprobar la publicación

Este paso es el que hará visible la web por Internet. No lo ejecutes hasta haber revisado la configuración y querer publicarla.

1. En el repositorio abre Settings > Pages.
2. En Build and deployment > Source elige GitHub Actions.
3. Abre Actions y selecciona Publicar Cotizador EM.
4. Selecciona Run workflow.
5. Marca Confirmo publicar la web de EM Agency.
6. Ejecuta Run workflow y espera a que termine correctamente.
7. Abre la URL que entregue el resultado del despliegue.

La publicación solo se ejecuta manualmente con esa confirmación. Subir cambios al repositorio no inicia una publicación.

El flujo ya contiene los tres datos públicos de conexión del proyecto nuevo. No hacen falta claves privadas para construir el frontend.

La compilación está preparada para /CotizadorEM/. Si cambias el nombre del repositorio, también debe ajustarse esa carpeta en el flujo y en APP_URL.

Si falla, abre el trabajo que aparece en rojo y comparte el mensaje de error, sin contraseñas ni claves privadas.

## 6. Cargar el catálogo y el logo

Después de abrir la web e iniciar sesión:

1. En Catálogo selecciona el archivo local data/catalogo-em-2026.json del proyecto original de tu carpeta EM AGENCY.
2. Se importarán 194 cuentas y 210 tarifas finales. Las cuentas sin precio siguen sin servicios cotizables.
3. En Configuración sube public/brand/em-agency.png para guardar el logo en el proyecto Supabase nuevo.
4. Revisa el nombre, las condiciones y la vigencia.
5. Crea una cotización de prueba y descarga su PDF.
6. Comprueba que los importes estén en MXN, el Fee EM no aparezca y la leyenda diga No incluye IVA.

El catálogo real no se incluye en el ZIP que se sube a GitHub ni en el sitio estático. Está en la carpeta local para importarlo con tu sesión autorizada.

## 7. Conectar Google Sheets después

Desde xontiveros@em.agency.com:
1. Crea la hoja y una pestaña vacía llamada Cotizaciones.
2. En Google Cloud habilita Google Sheets API y crea una cuenta de servicio para el cotizador.
3. Comparte solo esa hoja con el correo de la cuenta de servicio como Editor.
4. En los Secrets del proyecto Supabase nuevo configura GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID y GOOGLE_SHEET_TAB = Cotizaciones.
5. Mantén la clave privada únicamente en Supabase; no la envíes al chat ni la subas a GitHub.
6. En el cotizador abre una cotización y pulsa Sincronizar con Sheets.
7. Repite la sincronización para comprobar que se actualiza la misma fila, conservando el folio.
8. Prueba el enlace PDF desde la hoja: abrirá el detalle y solicitará iniciar sesión.

Mientras falten esos datos, el PDF puede funcionar y Google Sheets seguirá pendiente.

## Verificación de esta preparación

29 pruebas de la aplicación y del archivo único de la función aprobadas.
Compilación para /CotizadorEM/ aprobada.
Se comprobaron las rutas del logo, plantilla y archivo de entrada en la salida compilada.
Las 30 comprobaciones SQL de la entrega anterior siguen siendo la validación local de la base.
No se modificó ningún proyecto remoto ni se publicó la web desde Codex.

Referencias:
https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
https://vite.dev/guide/static-deploy.html#github-pages
https://supabase.com/docs/guides/functions/quickstart-dashboard

