# Actualización del Cotizador EM Agency — versión 3

Esta entrega contiene código y archivos para actualización manual. No se ha publicado la página ni se han cambiado las conexiones de TSI.

## Qué incorpora

- PDF con el logo original y marca de agua, precios finales en MXN y la leyenda «No incluye IVA».
- Descarga de respaldo en el navegador si la función del servidor no responde, con un aviso visible.
- Cotizaciones reales y de muestra. Las muestras no reciben folio, no consumen consecutivos, no generan OC y no se envían a la hoja comercial.
- Botón Cargar ejemplo y opción Usar como base, con precios vigentes del catálogo.
- Eliminación con confirmación. Se oculta del listado activo, conserva historial y reserva el número para no reutilizarlo. Las cotizaciones con OC se conservan.
- Nombre y correo del vendedor tomados del usuario que inicia sesión. WhatsApp capturado manualmente para cada cotización.
- Numeración configurable de cotización y OC. La conversión conserva la cotización original y asigna una sola OC aunque se repita el botón.
- Sincronización con Google Sheets al guardar una cotización real, cambiar su estado, convertirla en OC o eliminarla. Si falla, queda el aviso y se puede reintentar.

## 1. Actualizar la base existente

1. Entra al proyecto de Supabase EM Agency: xguieynlzqutjhehqdnk.
2. Abre SQL Editor y crea una consulta nueva.
3. Abre el archivo manual/actualizar-cotizador-v3.sql de esta entrega, copia TODO su contenido y ejecútalo.
4. El resultado esperado es Success / No rows returned. No borra los registros anteriores.
5. No ejecutes otra vez supabase/schema.sql: ese archivo es únicamente para una instalación vacía.

El script V3 puede repetirse sin reiniciar los consecutivos. Durante la actualización, el código antiguo deja de crear cotizaciones con la serie anterior; completa los siguientes pasos para activar la página nueva.

## 2. Actualizar la función del PDF

Tu función existente se llama super-worker. La página nueva usa ese mismo nombre.

1. En Supabase abre Edge Functions > super-worker > Code.
2. Abre manual/quote-documents.ts de esta entrega. El primer renglón dice EM AGENCY GENERADOR PDF VERSION 3.
3. Reemplaza TODO el contenido de index.ts en el editor con ese archivo. No pegues el ZIP ni solo una parte.
4. Pulsa Deploy updates para aplicar esta función cuando decidas hacerlo.
5. Si descargas el código para comprobarlo, debe incluir VERSION 3 y las funciones generateQuotePdf y upsertSheetQuote.

La función exige una sesión válida y acceso como integrante autorizado. No hace pública la base. No es necesario borrar super-worker ni crear otra función.

Para instalación por CLI, existe también el código dividido en supabase/functions/quote-documents. Si eliges ese nombre, cambia VITE_DOCUMENTS_FUNCTION a quote-documents al construir la página. Para esta instalación manual deja super-worker.

## 3. Conectar Google Sheets

La dirección de tu hoja ya quedó preparada:
https://docs.google.com/spreadsheets/d/1xHk3d5HBF458_2jKFSj7rhIvRN9VNto40vJ6tgx6ipI/edit

Falta autorizar a la aplicación para escribir. Esto lo haces en tus cuentas nuevas:

1. En Google Cloud crea o selecciona un proyecto de EM Agency y habilita Google Sheets API.
2. En IAM y administración > Cuentas de servicio crea una cuenta para el cotizador.
3. En esa cuenta, Claves > Agregar clave > Crear clave nueva > JSON. Guarda el archivo de manera privada.
4. Abre la hoja de Google y compártela como Editor con el correo del campo client_email del JSON. No es el correo de una persona: suele terminar en gserviceaccount.com.
5. En Supabase > Edge Functions > Secrets agrega:
   - GOOGLE_SERVICE_ACCOUNT_EMAIL: valor client_email del JSON.
   - GOOGLE_PRIVATE_KEY: valor private_key, incluyendo BEGIN PRIVATE KEY y END PRIVATE KEY.
6. No es necesario agregar GOOGLE_SHEET_ID: la entrega ya usa tu hoja por defecto. GOOGLE_SHEET_TAB es opcional y su valor inicial es Cotizaciones.
7. La primera sincronización crea la pestaña Cotizaciones si no existe y escribe los encabezados.

No compartas el JSON ni su clave por el chat o GitHub. No necesitas modificar la conexión de Google de esta app.

Cada cotización usa una fila identificada por su ID interno. Cambiar el estado o crear la OC actualiza esa fila; no la duplica. Las eliminadas se marcan como Eliminada si ya estaban sincronizadas.

La columna PDF contiene un enlace permanente al detalle protegido del cotizador y su botón para consultar/descargar el documento. Se requiere iniciar sesión. Los archivos permanecen privados; no se guardan enlaces temporales que dejan de servir en diez minutos.

Instrucciones ampliadas y resolución de errores: docs/google-sheets.md.
Referencia de Google: https://developers.google.com/workspace/guides/create-credentials

## 4. Subir los archivos a GitHub

1. Descomprime el paquete de esta versión.
2. En xontiveros-EM/CotizadorEM reemplaza los archivos y carpetas correspondientes de la raíz. Conserva src, public, supabase, manual y tests como carpetas; no subas todos sus archivos sueltos.
3. Reemplaza .github/workflows/static.yml por la versión incluida. No agregues un segundo flujo de publicación.
4. Conserva package.json, package-lock.json e index.html en la raíz.
5. No subas node_modules, .env, exportaciones de clientes, archivos privados de Google ni el tabulador de costos internos.

El flujo incluido usa el proyecto EM Agency y super-worker. Solo se ejecuta manualmente y requiere marcar la confirmación de publicación.

## 5. Publicar cuando lo confirmes

1. En GitHub abre Actions > Publicar Cotizador EM.
2. Usa Run workflow, selecciona main y marca Confirmo publicar la web de EM Agency.
3. Espera a que terminen build y deploy.
4. No uses Re-run jobs sobre una ejecución vieja: volvería a ejecutar el código de esa ejecución.
5. Abre https://xontiveros-em.github.io/CotizadorEM/ y recarga con Ctrl + F5.

## 6. Completar vendedor y numeración

1. Inicia sesión con el usuario autorizado que ya utilizas.
2. En Configuración > Mi perfil completa tu nombre una sola vez. El correo proviene de tu cuenta; no se captura en cada cotización.
3. En Numeración de la agencia escribe el prefijo EXACTO de cotizaciones y el último número utilizado. No se inventó un prefijo ni un inicio para esa serie.
4. Para OC se propone el prefijo «OC » (con espacio) y el último número informado, 2710. Confirma el último realmente vigente antes de guardar. Si sigue en 2710, la próxima OC será OC 2711.
5. El número de dígitos permite ceros a la izquierda. Usa 0 si no los necesitan. Los espacios y guiones del prefijo se conservan.
6. Marca la confirmación de consecutivos y guarda.

Las cotizaciones anteriores conservan sus folios. Las nuevas usan la serie confirmada. No se permite retroceder consecutivos ni reutilizar números eliminados.

## 7. Uso diario y prueba inicial

1. Crea primero una Muestra o pulsa Cargar ejemplo. Revisa el PDF y elimínala cuando ya no la necesites: no altera la numeración.
2. Para una propuesta oficial selecciona Real, captura el WhatsApp del vendedor si corresponde y guarda.
3. Revisa que el PDF tenga vendedor, logo, marca de agua, folio y total sin desglose del fee.
4. Comprueba que Google Sheets muestre Sincronizada. Si falta la autorización de Google, aparecerá un aviso concreto; el guardado y el PDF siguen disponibles.
5. Marca Enviada y luego Aceptada cuando corresponda al seguimiento real.
6. Usa Convertir en orden de compra para asignar la OC y conservar la referencia de cotización.
7. El filtro Eliminadas permite consultar el historial de lo que retiraste del listado.

Una cotización con OC debe conservarse. Los registros antiguos no reciben automáticamente el nombre de quien los abre: si no se guardó el vendedor original, se deja sin dato.

## Verificación incluida

La entrega incluye pruebas de importes, permisos, muestras, datos del vendedor, numeración, conservación del historial, PDFs y sincronización mediante respuestas controladas. La conexión final con Google y la instalación en tu proyecto se comprueban después de que realices los pasos manuales anteriores.

No incluye cambios de Zoho ni migración de su historial; esa ampliación sigue fuera de este alcance.

