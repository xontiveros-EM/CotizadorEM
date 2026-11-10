# Base de datos de EM Agency — V3

Proyecto previsto: xguieynlzqutjhehqdnk. No se deben ejecutar estos scripts en TSI/Tanabi.

## Actualización e instalación

- Base existente: ejecutar únicamente manual/actualizar-cotizador-v3.sql.
- Proyecto nuevo y vacío: ejecutar supabase/schema.sql una vez y después manual/actualizar-cotizador-v3.sql.
- No repetir el esquema original sobre tablas existentes. El script V3 sí es repetible y no reinicia contadores.
- El acceso requiere un usuario de Supabase Auth y su UUID activo en private.staff_members. Crear una cuenta no otorga membresía automáticamente.

Los integrantes activos comparten el espacio interno de EM Agency. Retirar la membresía impide nuevas lecturas y operaciones aunque el usuario conserve una sesión.

## Datos y permisos

RLS protege las siete tablas públicas: company_settings, instagram_accounts, rates, quotes, quote_items, quote_events y sheet_sync. private.document_counters conserva las series oficiales y no tiene acceso directo desde el cliente.

El cliente puede importar catálogo y cambiar los campos autorizados de marca. No puede insertar ni modificar directamente totales, folios, OC, vendedor histórico, conceptos ni eventos. Las operaciones públicas son funciones security invoker que llaman implementaciones privadas con comprobación explícita de usuario y membresía, permisos mínimos y search_path vacío.

La moneda es MXN, el impuesto calculado es cero y el PDF indica No incluye IVA. Los servicios usan precios finales de cliente, sin desglose del fee.

## Numeración y muestras

get_document_numbering y save_document_numbering leen y confirman las series de cotización y OC. El prefijo, último número y cantidad de dígitos son configurables. Los espacios y guiones se conservan.

No se inventa la serie de cotizaciones: inicia sin configurar. OC propone OC seguido de espacio y último número 2710, pendiente de confirmación. Los folios anteriores se conservan.

create_quote_v3 valida y guarda una cotización con las tarifas y condiciones originales. Para una real bloquea la fila de su contador y asigna un número único; para una muestra deja folio y quote_number nulos, sin modificar contadores ni generar pendiente en Sheets.

request_id serializa los reintentos: el mismo guardado devuelve la misma cotización. Datos distintos con la misma solicitud se rechazan. El procedimiento de creación antiguo solicita actualizar la página para impedir que se siga emitiendo la serie anterior.

convert_quote_to_oc requiere una cotización real, aceptada, vigente y no eliminada. Bloquea la cotización y el contador; conserva folio y asigna oc_folio una sola vez. Repetir la operación devuelve la misma OC.

## Vendedor e historial

La creación toma nombre y correo del usuario autenticado en el servidor; el cliente solo proporciona el WhatsApp manual. Nombre, correo y WhatsApp quedan guardados en la cotización.

Los históricos sin vendedor conocido mantienen esos campos vacíos. Modificar el perfil posteriormente no cambia documentos anteriores.

set_quote_status conserva el historial y aplica las transiciones comerciales originales. Las muestras y eliminadas no participan en esas transiciones.

delete_quote realiza eliminación lógica con confirmación en pantalla. Conserva la fila, conceptos, eventos y folio; no devuelve números al contador. Las cotizaciones con OC no pueden eliminarse.

## PDF y Google Sheets

quote-pdfs permanece privado. Las funciones comprueban la sesión y la lectura por RLS antes de usar permisos administrativos. Los enlaces de archivo duran diez minutos; la hoja conserva un enlace al detalle autenticado de la aplicación.

brand-assets admite lectura de logos y subidas del equipo. El logo original de EM está embebido también en el generador para que el PDF funcione sin una subida adicional.

Cada cambio comercial queda pendiente en sheet_sync. acquire_sheet_lock y release_sheet_lock reservan un bloqueo global para evitar filas duplicadas. finish_sheet_sync confirma la versión; si cambió durante el envío, queda pendiente de reintento. Los fallos no revierten el guardado de la cotización.

Las muestras no se envían a la hoja comercial. Las cotizaciones reales eliminadas actualizan su fila como Eliminada si ya existía.

## Verificación

El esquema original y la actualización se ejecutan en bases aisladas de PostgreSQL WASM (PGlite 0.5.16), con Auth y Storage simulados. Se prueban permisos, importes, idempotencia, conservación de históricos, vendedor, numeración, muestras, conversión y eliminación.

Desde la raíz del proyecto:
- npm ci --prefix tests/database
- npm test --prefix tests/database
- node tests/database/verify-v3.mjs

La actualización V3 se ejecuta varias veces en las pruebas para comprobar que no reinicie contadores ni cambie datos existentes. El flujo manual de GitHub ejecuta ambas verificaciones antes de construir.

Las pruebas locales no sustituyen la comprobación de Auth, Storage, la función desplegada y la autorización real de Google en las cuentas del usuario.

