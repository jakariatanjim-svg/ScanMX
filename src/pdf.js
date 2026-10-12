const encoder = new TextEncoder();

function text(value) {
  return encoder.encode(value);
}

function partSize(part) {
  return part instanceof Blob ? part.size : part.byteLength;
}

/** Build a compact PDF with each processed JPEG kept as a blob instead of copied into memory. */
export async function createPdfBlob(pages) {
  if (!pages?.length) throw new Error('Add at least one scan before exporting a PDF.');

  const objectCount = 2 + pages.length * 3;
  const objects = new Array(objectCount + 1);
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objects[1] = [text('<< /Type /Catalog /Pages 2 0 R >>')];
  objects[2] = [text(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`)];

  pages.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const landscape = page.width > page.height;
    const pageWidth = landscape ? 841.89 : 595.28;
    const pageHeight = landscape ? 595.28 : 841.89;
    const margin = 24;
    const fit = Math.min((pageWidth - margin * 2) / page.width, (pageHeight - margin * 2) / page.height);
    const drawWidth = page.width * fit;
    const drawHeight = page.height * fit;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const stream = text(`q ${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im0 Do Q\n`);

    objects[pageId] = [text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)];
    objects[contentId] = [text(`<< /Length ${stream.length} >>\nstream\n`), stream, text('endstream')];
    objects[imageId] = [
      text(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.blob.size} >>\nstream\n`),
      page.blob,
      text('\nendstream'),
    ];
  });

  const parts = [text('%PDF-1.4\n%ScanMX\n')];
  const offsets = new Array(objectCount + 1).fill(0);
  let byteOffset = partSize(parts[0]);
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = byteOffset;
    const objectParts = [text(`${id} 0 obj\n`), ...objects[id], text('\nendobj\n')];
    parts.push(...objectParts);
    byteOffset += objectParts.reduce((sum, part) => sum + partSize(part), 0);
  }

  const xrefOffset = byteOffset;
  const xrefRows = ['xref', `0 ${objectCount + 1}`, '0000000000 65535 f '];
  for (let id = 1; id <= objectCount; id += 1) xrefRows.push(`${String(offsets[id]).padStart(10, '0')} 00000 n `);
  parts.push(text(`${xrefRows.join('\n')}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return new Blob(parts, { type: 'application/pdf' });
}
