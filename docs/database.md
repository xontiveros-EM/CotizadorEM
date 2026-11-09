# Base de datos de EM Agency

Esquema preparado para un proyecto Supabase **nuevo y vacío** de xontiveros-EM. No se ha aplicado en ningún servicio externo.

## Alta del proyecto y equipo

1. Verificar que la conexión pertenece a xontiveros-EM y seleccionar su proyecto nuevo.
2. Revisar y ejecutar supabase/schema.sql una sola vez desde el editor SQL. Todo el esquema se crea en una transacción.
3. Invitar al usuario inicial desde Auth y consultar su UUID. La dirección de Google proporcionada para la hoja no se usa automáticamente como identidad de Supabase.
4. Dar acceso al UUID confirmado con esta instrucción, sustituyendo el marcador por el UUID real:

~~~sql
insert into private.staff_members(user_id)
values ('UUID-REAL-DEL-USUARIO'::uuid);
~~~

No basta con crear una cuenta en Auth: el usuario debe estar en el equipo autorizado. Todos los miembros activos comparten el catálogo y las cotizaciones de esta única agencia.

Para retirar acceso, establecer active=false en private.staff_members. Las reglas comprueban la membresía en cada lectura y operación; no dependen de información editable del perfil.

## Datos y permisos

Las siete tablas públicas tienen reglas de acceso por equipo: company_settings, instagram_accounts, rates, quotes, quote_items, quote_events y sheet_sync. El catálogo admite perfiles sin tarifas y seguidores desconocidos como null.

Los miembros pueden importar cuentas y tarifas y cambiar nombre, logo, vigencia y condiciones. No pueden insertar ni alterar directamente folios, conceptos, totales, impuestos o historial. La moneda queda fijada en MXN y el impuesto en cero.

Los folios usan una secuencia de PostgreSQL y una restricción UNIQUE. Se asigna COT-AAAA-000001 con el año de Ciudad de México y un consecutivo global. La secuencia no se reinicia en enero; pueden existir huecos y los folios nunca se reciclan.

## Operaciones

- create_quote valida equipo, cliente, vigencia, cantidades y tarifas activas; obtiene los precios desde el catálogo, calcula en numeric y guarda una copia de precios, cuenta, empresa, condiciones y logo.
- request_id permite repetir una solicitud tras un corte de red sin crear otra cotización. Reutilizarlo con datos distintos se rechaza. La UI lo renueva al completar una cotización.
- set_quote_status bloquea la fila y comprueba la transición. Borrador puede pasar a enviada o cancelada; enviada puede pasar a aceptada, rechazada o cancelada. No se reabren estados terminales.
- Una cotización vencida no puede enviarse ni aceptarse. Vencida es una condición calculada; se conserva su último estado comercial en el historial.
- acquire_sheet_lock y release_sheet_lock se reservan al servidor. Serializan los cambios en Google Sheets.
- finish_sheet_sync comprueba y bloquea la versión de la cotización antes de marcarla sincronizada. Si cambió durante el envío, queda pendiente.

El servidor puede guardar la ruta del PDF y el estado de integración. La clave privada de servicio permanece exclusivamente en las funciones del servidor.

## Archivos

quote-pdfs es privado. Solo el equipo autorizado o el servidor puede leerlo. El frontend obtiene un enlace firmado temporal después de comprobar la sesión.

brand-assets permite leer logos y restringe las subidas al equipo. Los originales PNG/JPG se guardan con nombres nuevos, por lo que el logo que usó una cotización anterior permanece disponible.

## Importar el catálogo preparado

En Catálogo, seleccionar data/catalogo-em-2026.json tras iniciar sesión en el proyecto nuevo. Conserva las 194 cuentas y las 210 tarifas, incluidas las cuentas sin servicios cotizables. El CSV representa únicamente las cuentas con tarifas.

Los archivos de costos y comisión son internos. Los objetos importados contienen precios finales del cliente; las cotizaciones y PDF no incluyen un desglose del Fee EM.

## Verificación realizada

El esquema completo se ejecutó en PostgreSQL WASM mediante PGlite 0.5.16 con las estructuras de Auth y Storage simuladas.

Pasaron **30 comprobaciones**: acceso anónimo y externo denegado, equipo autorizado, folio, idempotencia, totales sin IVA, precios históricos tras cambios del catálogo, transiciones e historial, permisos de configuración, exclusión mutua de Sheets y finalización por versión.

Para reproducir esta prueba aislada:

~~~text
cd tests/database
npm ci
npm test
~~~

Este motor local ejecuta PostgreSQL; no sustituye la verificación de Supabase Auth, Storage, la función desplegada y Google Sheets con las cuentas reales. La concurrencia de varias conexiones de PostgreSQL y los avisos de seguridad del proyecto deben verificarse al conectar el proyecto nuevo.

