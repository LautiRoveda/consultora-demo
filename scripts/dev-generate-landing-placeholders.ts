/**
 * T-108 · Genera assets placeholder para `public/landing/`.
 *
 * Crea los 5 archivos referenciados desde `/features` y `/` (landing CP4)
 * cuando Lautaro aún no regeneró los PDFs/screenshots reales del cliente
 * demo (Cliente Demo SA / 30-00000000-1):
 *
 *   - demo-informe-ruido-preview.png        (1200x630, gradient + texto)
 *   - demo-planilla-epp-preview.png         (1200x630, gradient + texto)
 *   - demo-informe-ergonomia-preview.png    (1200x630, gradient + texto)
 *   - demo-informe-ruido.pdf                (1 página, valid PDF 1.4)
 *   - demo-planilla-epp.pdf                 (1 página, valid PDF 1.4)
 *
 * Reemplazá manualmente los archivos pre-CP5 smoke sin tocar código:
 * los paths del JSX en /features + landing siguen apuntando a los mismos
 * nombres. Buscar `TODO(T-108-CP5-assets)` para listar todos los usos.
 *
 * Uso:
 *   $ pnpm exec tsx scripts/dev-generate-landing-placeholders.ts
 *
 * Idempotente: sobrescribe los archivos existentes.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const OUTPUT_DIR = join(process.cwd(), 'public', 'landing');

const PLACEHOLDERS = [
  { filename: 'demo-informe-ruido-preview.png', title: 'Informe técnico · Ruido' },
  { filename: 'demo-planilla-epp-preview.png', title: 'Planilla EPP · Res SRT 299/11' },
  { filename: 'demo-informe-ergonomia-preview.png', title: 'Informe técnico · Ergonomía' },
] as const;

const PDF_PLACEHOLDERS = [
  { filename: 'demo-informe-ruido.pdf', title: 'Informe Ruido (preview pending)' },
  { filename: 'demo-planilla-epp.pdf', title: 'Planilla EPP (preview pending)' },
] as const;

async function makePngPlaceholder(filename: string, title: string): Promise<number> {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f4f4fa"/>
      <stop offset="100%" stop-color="#e4e3f5"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="60" y="60" width="1080" height="510" fill="#ffffff" stroke="#5650f5" stroke-width="3" stroke-dasharray="12 10" rx="16"/>
  <text x="600" y="290" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#1a1a2e">${title}</text>
  <text x="600" y="350" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#666">Preview pending — generar pre-merge</text>
  <text x="600" y="420" text-anchor="middle" font-family="monospace" font-size="16" fill="#999">TODO(T-108-CP5-assets)</text>
</svg>`;
  const outputPath = join(OUTPUT_DIR, filename);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  const stats = await stat(outputPath);
  return stats.size;
}

/**
 * Hand-crafted minimal PDF 1.4 con 1 página A4. Offsets del xref se calculan
 * en runtime para evitar drift cuando cambia el copy.
 */
function buildMinimalPdf(text: string): Buffer {
  const objects: string[] = [];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  const pushObj = (content: string) => {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += content;
  };

  pushObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  pushObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  pushObj(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  );

  // Content stream: simple text rendering. `(${text}) Tj` requires escaping
  // parens and backslash; placeholder copy es ASCII safe sin special chars.
  const contentStream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  pushObj(
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'binary')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  );
  pushObj('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const xrefOffset = Buffer.byteLength(body, 'binary');
  body += 'xref\n0 6\n';
  body += '0000000000 65535 f \n';
  for (const off of offsets) {
    body += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  objects.push(...offsets.map(String));
  return Buffer.from(body, 'binary');
}

async function makePdfPlaceholder(filename: string, text: string): Promise<number> {
  const pdfBytes = buildMinimalPdf(text);
  const outputPath = join(OUTPUT_DIR, filename);
  await writeFile(outputPath, pdfBytes);
  return pdfBytes.byteLength;
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`Generando placeholders en ${OUTPUT_DIR}`);
  console.log('');

  for (const p of PLACEHOLDERS) {
    const size = await makePngPlaceholder(p.filename, p.title);
    console.log(`  PNG  ${p.filename.padEnd(40)} ${size} bytes`);
  }
  for (const p of PDF_PLACEHOLDERS) {
    const size = await makePdfPlaceholder(p.filename, p.title);
    console.log(`  PDF  ${p.filename.padEnd(40)} ${size} bytes`);
  }

  console.log('');
  console.log('Listo. Reemplazá pre-CP5 smoke con assets reales del Cliente Demo SA');
  console.log('(grep TODO(T-108-CP5-assets) para listar usos).');
}

void main();
