import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfBlob } from '../src/pdf.js';

const tinyJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function byteOffsetForObject(bytes, id) {
  const text = new TextDecoder('latin1').decode(bytes);
  const xref = Number(text.match(/startxref\n(\d+)/)?.[1]);
  assert.ok(Number.isFinite(xref), 'PDF should contain a startxref pointer');
  const table = text.slice(xref).split('\n');
  const objectOffset = Number(table[id + 2]?.slice(0, 10));
  return { text, objectOffset };
}

test('creates a one-page PDF with a valid xref pointer and embedded JPEG bytes', async () => {
  const pdf = await createPdfBlob([{ blob: new Blob([tinyJpeg], { type: 'image/jpeg' }), width: 1200, height: 1600 }]);
  assert.equal(pdf.type, 'application/pdf');
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const { text, objectOffset } = byteOffsetForObject(bytes, 5);
  assert.ok(new TextDecoder().decode(bytes.slice(0, 8)).startsWith('%PDF-1.4'));
  assert.ok(text.includes('/Count 1'));
  assert.ok(text.includes('/MediaBox [0 0 595.28 841.89]'));
  assert.ok(text.includes('/Filter /DCTDecode'));
  assert.ok(objectOffset > 0);
  assert.equal(text.slice(objectOffset, objectOffset + 10), '5 0 obj\n<<');
});

test('preserves page order and uses landscape paper for wide scans', async () => {
  const pdf = await createPdfBlob([
    { blob: new Blob([tinyJpeg]), width: 1600, height: 1000 },
    { blob: new Blob([tinyJpeg]), width: 1000, height: 1600 },
  ]);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.includes('/Count 2'));
  assert.ok(text.includes('/MediaBox [0 0 841.89 595.28]'));
  assert.ok(text.includes('/MediaBox [0 0 595.28 841.89]'));
  assert.ok(text.indexOf('3 0 obj') < text.indexOf('6 0 obj'));
});

test('rejects an empty export', async () => {
  await assert.rejects(createPdfBlob([]), /at least one scan/i);
});
