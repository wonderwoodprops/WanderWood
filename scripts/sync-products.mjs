import { writeFile } from 'node:fs/promises';

const sheetUrl = process.env.PRODUCTS_TSV_URL;
if (!sheetUrl) throw new Error('Missing PRODUCTS_TSV_URL environment variable');

const response = await fetch(sheetUrl);
if (!response.ok) throw new Error(`Failed to fetch TSV: ${response.status} ${response.statusText}`);

const text = await response.text();
const rows = text.split(/\r?\n/).filter(Boolean);
const products = rows.slice(1)
  .map((row, index) => {
    const [nameRaw = '', priceRaw = '', descriptionRaw = '', imageUrlsRaw = ''] = row.split('\t');
    const name = nameRaw.trim();
    if (!name) return null;
    const images = imageUrlsRaw.split(',').map((u) => u.trim()).filter(Boolean);
    return {
      id: `p-${index}`,
      name,
      description: descriptionRaw.trim().replace(/\s\s+/g, '\n'),
      price: Number(priceRaw.replace(/[^\d.]/g, '')) || 0,
      images: images.length ? images : ['https://placehold.co/600x400?text=WanderWood'],
    };
  })
  .filter(Boolean);

await writeFile('products.json', JSON.stringify(products, null, 2) + '\n', 'utf8');
console.log(`Wrote products.json with ${products.length} products.`);
