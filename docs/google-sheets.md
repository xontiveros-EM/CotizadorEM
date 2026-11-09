# PDF y Google Sheets

El proyecto no está publicado ni conectado a Google. Esta configuración se aplicará exclusivamente al proyecto nuevo de EM Agency, después de identificarlo. No debe aplicarse en TSI/Tanabi.

## PDF

La función `quote-documents` comprueba la sesión y el acceso del equipo a la cotización antes de leer datos o usar la clave privada de Supabase. Genera el documento con los datos guardados y sus precios originales, en MXN y con la leyenda **No incluye IVA.** Se admiten logos PNG/JPG de hasta 2 MB. Los logos del servidor deben proceder del bucket `brand-assets` del mismo proyecto; no se descargan direcciones externas.

Los PDF se guardan en el bucket privado `quote-pdfs`. El enlace de descarga caduca en 10 minutos. Google Sheets guarda una dirección permanente al detalle de la cotización (`APP_URL/?quote=ID`), desde donde un usuario autorizado abre el PDF. La hoja no vuelve públicos los documentos.

## Cuenta de Google y hoja necesarias

1. Identificar la cuenta de Google de EM Agency y crear o elegir la hoja destino.
2. En el proyecto de Google Cloud de esa cuenta, habilitar Google Sheets API y crear una cuenta de servicio para esta integración.
3. Compartir únicamente la hoja destino con el correo de esa cuenta de servicio como editor.
4. Crear una pestaña vacía llamada `Cotizaciones`, o indicar otro nombre mediante `GOOGLE_SHEET_TAB`. Debe dedicarse al cotizador; no insertar, mover ni ordenar físicamente sus filas durante una sincronización. Las vistas de filtro son apropiadas para consultar los datos.
5. Guardar el correo y la clave privada de la cuenta de servicio directamente en los secretos del proyecto Supabase nuevo. No enviarlos al chat, no guardarlos en GitHub y no ponerlos en variables `VITE_*`.

Las columnas se crean al sincronizar por primera vez: ID, Folio, Fecha, Cliente, Empresa, Correo, Campaña, Estado, Vigencia, Moneda, Subtotal, Descuento, Total, IVA, PDF y Actualización. El enlace PDF requiere iniciar sesión en el cotizador.

## Secretos de la función

| Nombre | Valor |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Correo de la cuenta de servicio autorizada en la hoja. |
| `GOOGLE_PRIVATE_KEY` | Clave privada PEM; acepta saltos de línea reales o `\n`. |
| `GOOGLE_SHEET_ID` | ID incluido entre `/d/` y `/edit` en el enlace de la hoja. |
| `GOOGLE_SHEET_TAB` | `Cotizaciones` por defecto. |
| `APP_URL` | URL HTTPS final del cotizador; se define después de aprobar su publicación. |
| `ALLOWED_ORIGIN` | Origen exacto de la aplicación, sin ruta ni `/` final. Para pruebas locales, por ejemplo `http://localhost:5173`. |
| `SUPABASE_PUBLISHABLE_KEY` | Clave pública del proyecto si no está disponible `SUPABASE_ANON_KEY`. |

Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno de las funciones. La clave de servicio nunca se envía al navegador. La función mantiene `verify_jwt = true` y además valida al usuario dentro de su código. Antes de desplegar, comprobar la ayuda de la versión instalada de Supabase CLI y seleccionar explícitamente el proyecto nuevo; la CLI ha cambiado sus opciones de despliegue.

## Reintentos y estados

La aplicación solicita la sincronización después de guardar una cotización o cambiar su estado. Si falta configurar Google, el PDF sigue disponible y la sincronización permanece pendiente. El botón de sincronizar permite reintentar. Los estados de la integración distinguen pendiente, en curso, sincronizada y error; no se muestra una sincronización ficticia.

Un bloqueo global con vencimiento serializa las escrituras de Google Sheets. La función busca el ID inmutable de la cotización y actualiza su fila, en lugar de añadir otra en cada reintento. Si se interrumpe la respuesta después de que Google guardó la fila, el próximo intento encontrará ese mismo ID. Si cambia la cotización durante el envío, queda pendiente para enviar la versión más reciente. No existe todavía un proceso periódico en producción: los errores pendientes se reintentan desde la aplicación.

Los valores se envían con `valueInputOption=RAW`, por lo que textos que empiecen con `=` no se ejecutan como fórmulas. No debe editarse manualmente la columna ID. Si se detectan IDs duplicados, la sincronización se detiene y pide corregirlos.

## Verificación antes de uso real

- Acceso rechazado sin sesión o sin autorización del equipo.
- PDF de una y varias páginas, logo visible, totales correctos y leyenda de IVA.
- Una cotización aparece una sola vez después de dos reintentos.
- Cambiar su estado actualiza esa fila y conserva el folio.
- El enlace de la hoja abre el detalle tras iniciar sesión y permite abrir el PDF.
- Al retirar permisos de Google, la aplicación muestra el error y permite reintentar tras recuperarlos.

La integración real con Google y el almacenamiento remoto necesitan las cuentas nuevas y sus permisos; las pruebas locales no sustituyen esa verificación.

Referencias oficiales: [Google Sheets: actualizar valores](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update), [cuentas de servicio de Google](https://developers.google.com/identity/protocols/oauth2/service-account), [PDF privados en Supabase Storage](https://supabase.com/docs/guides/storage/serving/downloads) y [autenticación de Edge Functions](https://supabase.com/docs/guides/functions/auth-headers).
