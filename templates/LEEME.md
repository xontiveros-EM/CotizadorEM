# Materiales para Cotizador EM Agency

Adjunta tu base actual de precios y cuentas de Instagram en Excel o CSV. Se adaptará al formato de importación sin inventar precios ni cuentas. Para preparar un CSV nuevo, usa catalogo.csv, que contiene únicamente los encabezados.

Cada fila corresponde a una tarifa de una cuenta:

| Columna | Contenido |
| --- | --- |
| handle | Usuario de Instagram, con o sin @. Sin URL. |
| display_name | Nombre visible de la cuenta. |
| category | Categoría; se puede dejar vacía. |
| followers | Seguidores como entero, sin comas ni separadores; deja vacío si no se conocen. Un cero indica cero real. |
| service | Servicio o formato. |
| unit_price | Precio unitario en MXN, con máximo dos decimales, sin separadores de miles. |
| currency | MXN. |

Repite los datos de la cuenta si ofrece varios servicios y cambia el servicio y precio. Para una misma cuenta, el nombre, categoría y seguidores deben coincidir en todas sus filas. No repitas la combinación cuenta y servicio.

Guarda el archivo como **CSV UTF-8**. Se admiten separadores de coma o punto y coma, campos entre comillas, comillas duplicadas y saltos de línea dentro de campos entre comillas. Con separador de punto y coma también se admite coma decimal en precios. No escribas signos $, fórmulas, importes negativos ni separadores de miles.

Adjunta también los logos originales, preferentemente PNG con transparencia o JPG de buena calidad. Si solo los tienes en SVG o PDF, adjúntalos para preparar la versión adecuada para el documento. Indica qué logo aparece en el encabezado y, si aplica, cuáles acompañan las cuentas.

Todas las cotizaciones usarán **MXN** y la leyenda **“No incluye IVA”**, sin sumar impuestos. La vigencia y los términos se podrán configurar.

Las cuentas de GitHub, Supabase y Google deben ser las nuevas de EM Agency. No adjuntes contraseñas ni claves secretas al catálogo o al repositorio. La publicación requiere confirmación del usuario.


