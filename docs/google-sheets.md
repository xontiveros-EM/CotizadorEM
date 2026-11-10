# Google Sheets de EM Agency

La versión 3 sincroniza cotizaciones reales con una hoja compartida. No descarga Excel ni CSV de cotizaciones.

Hoja indicada por la agencia:
https://docs.google.com/spreadsheets/d/1xHk3d5HBF458_2jKFSj7rhIvRN9VNto40vJ6tgx6ipI/edit

La función usa ese ID por defecto y crea la pestaña **Cotizaciones** si no existe. No cambia otras pestañas. Los datos de la hoja en blanco no se conectan por conocer únicamente su dirección: hace falta autorizar el acceso siguiente.

## Conexión manual, una sola vez

1. En Google Cloud, usa el proyecto de EM Agency y habilita **Google Sheets API**.
2. Crea una cuenta de servicio para el cotizador. Obtén una clave JSON y consérvala de forma privada.
3. En la hoja, pulsa Compartir y agrega como **Editor** el correo que aparece en el campo **client_email** de ese archivo JSON. No necesitas hacer pública la hoja.
4. En el proyecto Supabase **xguieynlzqutjhehqdnk**, abre **Edge Functions > Secrets** y guarda:
   - **GOOGLE_SERVICE_ACCOUNT_EMAIL**: el valor de **client_email** del JSON.
   - **GOOGLE_PRIVATE_KEY**: el valor de **private_key**, incluyendo BEGIN/END PRIVATE KEY. Admite saltos reales o los caracteres literales \\n del JSON.
5. Opcionalmente guarda **GOOGLE_SHEET_ID** si cambias de hoja y **GOOGLE_SHEET_TAB** si cambias la pestaña. Los valores por defecto ya corresponden a la hoja anterior y a Cotizaciones.
6. Actualiza el código de la función **super-worker** con el archivo **manual/quote-documents.ts**. Es un solo archivo **index.ts**, no una carpeta. El mismo código también funciona si creas una función llamada quote-documents; en ese caso configura VITE_DOCUMENTS_FUNCTION en la página.
7. Guarda una cotización real y revisa el resultado de sincronización. Puedes reintentar desde su detalle. Si Google devuelve un error, la página conserva la cotización y permite descargar el PDF.

La clave privada va únicamente en Supabase Secrets. No la pegues en GitHub, en un archivo público ni en el chat.

## Comportamiento

- Cada fila se identifica por el ID interno inmutable de la cotización en la columna A. Los reintentos actualizan la misma fila.
- Se sincronizan los datos del cliente, precios finales, estado, folio de cotización, número y fecha de OC, nombre/correo/WhatsApp del vendedor y enlace de consulta del PDF.
- Las cotizaciones de muestra no consumen folios y no se envían a esta hoja comercial.
- Si eliminas una cotización real que ya tenía fila, se marca **Eliminada** y se conserva su número e historial. Se retira el enlace al PDF. Si nunca se sincronizó, eliminarla no crea una fila nueva.
- El enlace de la columna PDF abre el detalle autenticado del cotizador y su botón de PDF. No es una dirección pública al archivo: los enlaces directos de Supabase duran diez minutos. Este enlace de consulta no caduca y protege los precios y datos de clientes.
- La primera sincronización escribe encabezados de A a W. Dedica esa pestaña al cotizador; no alteres ni dupliques la columna ID. Puedes tener otras pestañas para tus análisis.
- Las escrituras usan RAW: nombres o notas que comiencen con = no se ejecutan como fórmulas.
- Un bloqueo de base de datos evita que dos sincronizaciones asignen la misma fila. Si el documento cambia durante la operación, queda pendiente para un reintento.

## Diagnóstico

- **Falta conectar Google Sheets**: faltan Secrets de la cuenta de servicio.
- **Google rechazó la operación (403)**: verifica la API habilitada y el permiso Editor de la cuenta de servicio.
- **Hay IDs duplicados**: elimina las filas duplicadas de esa pestaña antes de reintentar; conserva el registro correcto.
- **Esta cotización fue eliminada**: no se generan nuevos PDFs. El historial y el folio quedan reservados.
- El PDF funciona sin credenciales de Google; conectarlas solo activa la sincronización.

Referencias oficiales de la integración:
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update