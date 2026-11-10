import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = ['supabase/functions/_shared/brand.js', 'supabase/functions/_shared/pdf.js', 'supabase/functions/_shared/sheets.js', 'supabase/functions/quote-documents/index.ts'];
const pieces = await Promise.all(files.map(async file => (await fs.readFile(new URL(file, root), 'utf8')).replace(/^import .*;\r?\n/gm, '')));
const header = '// EM AGENCY GENERADOR PDF VERSION 3\n// Funciona con el nombre instalado super-worker o con quote-documents.\n// Archivo en el editor de Supabase: index.ts. Generado por tools/bundle-documents.mjs.\n';
const imports = "import { createClient } from 'npm:@supabase/supabase-js@2.119.0';\nimport { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';\n";
await fs.writeFile(new URL('manual/quote-documents.ts', root), header + imports + '\n' + pieces.join('\n'));
console.log('Función de documentos v3 preparada para pegar en el editor de Supabase.');