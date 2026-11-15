const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function safeImages(raw) {
  try {
    const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
    return parsed.filter((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch { return false; }
    });
  } catch { return []; }
}

async function getProducts(env) {
  const { results = [] } = await env.DB.prepare(
    "SELECT id, slug, name, price, description, images_json FROM products WHERE is_active = 1 ORDER BY sort_order ASC, name ASC"
  ).all();
  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: Number(row.price) || 0,
    description: row.description || "",
    images: safeImages(row.images_json)
  }));
}

async function getTestimonials(env) {
  const { results = [] } = await env.DB.prepare(
    "SELECT id, name, contact, content, images_json FROM testimonials WHERE is_active = 1 ORDER BY sort_order ASC"
  ).all();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    contact: row.contact || "",
    content: row.content || "",
    images: safeImages(row.images_json)
  }));
}

function renderProductCard(product, index) {
  const images = product.images.length ? product.images : ["https://placehold.co/600x400?text=WanderWood"];
  const imageHtml = images.map((url, i) =>
    `<img src="${escapeHtml(url)}" class="gallery-img ${i === 0 ? "active" : ""}" data-index="${i}" alt="${escapeHtml(product.name)}">`
  ).join("");
  const dots = images.length > 1
    ? images.map((_, i) => `<div class="dot ${i === 0 ? "active" : ""}"></div>`).join("")
    : "";
  return `
    <div class="wood-card p-4 cursor-pointer" data-aos="zoom-in" data-product-index="${index}">
      <div class="gallery-container mb-5 open-product-modal cursor-pointer" data-product-index="${index}">
        ${imageHtml}<div class="dots-container">${dots}</div>
      </div>
      <h4 class="text-xl font-bold mb-1">${escapeHtml(product.name)}</h4>
      <div class="flex justify-between items-center gap-3">
        <span class="text-xl font-bold text-[#3d2b1f]">₪${product.price}</span>
        <div class="flex gap-2">
          <button class="open-product-modal bg-white border border-gray-300 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition" data-product-index="${index}">פרטים</button>
          <button class="add-to-order bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-[#bc986a] transition" data-product-index="${index}">הוסף</button>
        </div>
      </div>
    </div>`;
}

function renderTestimonial(item) {
  const images = item.images.length ? `
    <div class="flex justify-start gap-2 flex-wrap mb-4">
      ${item.images.map((url, index) => `<img src="${escapeHtml(url)}" alt="תמונת המלצה ${index + 1}" class="testimonial-thumb w-[84px] h-[84px] sm:w-[96px] sm:h-[96px] object-cover rounded-2xl border border-[#ecdcc8] shadow-sm cursor-zoom-in">`).join("")}
    </div>` : "";
  return `
    <article class="bg-white border border-[#efe2d3] rounded-2xl p-6 shadow-[0_15px_30px_rgba(61,43,31,0.08)] text-right" data-aos="fade-up">
      <div class="pb-4 border-b border-[#eee2d4] mb-4">
        <p class="font-bold text-[#3d2b1f]">${escapeHtml(item.name || "לקוחה")}</p>
        <p class="text-sm text-[#8a653f] text-right">${escapeHtml(item.contact || "")}</p>
      </div>
      ${images}
      <p class="text-[#5a4331] italic leading-loose"><span class="text-[#bc986a] text-2xl align-middle">“</span>${escapeHtml(item.content)}<span class="text-[#bc986a] text-2xl align-middle">”</span></p>
    </article>`;
}

async function signMedia(key, expires, secret) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(`${key}.${expires}`));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyMedia(key, expires, signature, secret) {
  if (!secret || !/^\d+$/.test(expires) || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = await signMedia(key, expires, secret);
  return expected === signature;
}

async function handleUpload(request, env, url) {
  if (!env.UPLOADS) return json({ error: "אחסון התמונות עדיין לא הופעל בחשבון Cloudflare." }, 503);
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) return json({ error: "לא נבחר קובץ תמונה." }, 400);
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type)) return json({ error: "אפשר להעלות JPG, PNG או WEBP בלבד." }, 415);
  const fileHeader = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = fileHeader[0] === 0xff && fileHeader[1] === 0xd8 && fileHeader[2] === 0xff;
  const isPng = fileHeader.length >= 8 && fileHeader[0] === 0x89 && fileHeader[1] === 0x50 && fileHeader[2] === 0x4e && fileHeader[3] === 0x47;
  const isWebp = fileHeader.length >= 12 && String.fromCharCode(...fileHeader.slice(0,4)) === "RIFF" && String.fromCharCode(...fileHeader.slice(8,12)) === "WEBP";
  if (!(isJpeg || isPng || isWebp)) return json({ error: "תוכן הקובץ אינו תואם לתמונה תקינה." }, 415);
  if (file.size > 32 * 1024 * 1024) return json({ error: "גודל התמונה חורג מ־32MB." }, 413);
  if (!env.UPLOAD_SIGNING_SECRET) return json({ error: "העלאת התמונות לא הוגדרה במלואה." }, 503);

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `customer-uploads/${crypto.randomUUID()}.${extension}`;
  await env.UPLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "private, max-age=3600" },
    customMetadata: { uploadedAt: new Date().toISOString() }
  });
  const expires = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365);
  const signature = await signMedia(key, expires, env.UPLOAD_SIGNING_SECRET);
  return json({ ok: true, url: `${url.origin}/media/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}` });
}

async function handleMedia(request, env, url) {
  if (!env.UPLOADS) return new Response("Not found", { status: 404 });
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  const expires = url.searchParams.get("expires") || "";
  const signature = url.searchParams.get("signature") || "";
  if (!await verifyMedia(key, expires, signature, env.UPLOAD_SIGNING_SECRET)) {
    return new Response("קישור התמונה אינו תקף או שפג תוקפו.", { status: 403 });
  }
  const object = await env.UPLOADS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

async function handleOrder(request, env) {
  if (!env.ORDERS_SCRIPT_URL) return json({ ok: false, error: "מערכת ההזמנות הישנה לא הוגדרה." }, 503);
  const payload = await request.json();
  const required = ["name", "email", "phone", "order_details"];
  if (required.some((key) => !String(payload[key] || "").trim())) {
    return json({ ok: false, error: "חסרים פרטים בטופס ההזמנה." }, 400);
  }
  const body = new URLSearchParams();
  body.set("formData", JSON.stringify(payload));
  const upstream = await fetch(env.ORDERS_SCRIPT_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const text = (await upstream.text()).trim();
  if (!upstream.ok || text !== "Success") {
    console.error(JSON.stringify({ message: "legacy order endpoint failed", status: upstream.status, response: text.slice(0, 300) }));
    return json({ ok: false, error: "לא הצלחנו להשלים את שליחת ההזמנה. נסי שוב." }, 502);
  }
  return json({ ok: true });
}

async function renderPage(request, env) {
  const url = new URL(request.url);
  const assetUrl = new URL("/index.html", url.origin);
  const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!asset.ok) return asset;
  let html = await asset.text();

  const [products, testimonials] = await Promise.all([getProducts(env), getTestimonials(env)]);
  const productCards = products.map(renderProductCard).join("");
  const testimonialCards = testimonials.map(renderTestimonial).join("");
  html = html.replace(/<!-- SSR_PRODUCTS -->[\s\S]*?<!-- \/SSR_PRODUCTS -->/, productCards);
  html = html.replace(/<!-- SSR_TESTIMONIALS -->[\s\S]*?<!-- \/SSR_TESTIMONIALS -->/, testimonialCards);

  const requestedProduct = url.searchParams.get("product");
  const product = requestedProduct
    ? products.find((item) => item.id === requestedProduct || item.slug === requestedProduct)
    : null;
  const baseUrl = `${url.origin}/`;
  const title = product ? `${product.name} - WanderWood` : "WanderWood | אביזרי עץ לצילום בהתאמה אישית";
  const description = product
    ? `${product.name} של WanderWood: ${product.description || "אביזר עץ איכותי בהתאמה אישית לצילום מקצועי."}`.slice(0, 300)
    : "WanderWood מתמחה באביזרי עץ לצילום בהתאמה אישית: אביזרי צילום לילדים, פתרונות לצלמות חוץ, סטים לצילומי ניו בורן ואביזרי פרימיום לצילום מקצועי.";
  const canonical = product ? `${baseUrl}?product=${encodeURIComponent(product.slug)}` : baseUrl;

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, (_match, before, after) => `${before}${escapeHtml(description)}${after}`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, (_match, before, after) => `${before}${escapeHtml(title)}${after}`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, (_match, before, after) => `${before}${escapeHtml(description)}${after}`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, (_match, before, after) => `${before}${escapeHtml(canonical)}${after}`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (_match, before, after) => `${before}${escapeHtml(canonical)}${after}`);
  html = html.replace(/https:\/\/wonderwoodprops\.github\.io\/WanderWood\//g, baseUrl);

  if (product) {
    const image = product.images[0] || "";
    html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, (_match, before, after) => `${before}${escapeHtml(image)}${after}`);
    html = html.replace(/(<meta name="twitter:image" content=")[^"]*(")/, (_match, before, after) => `${before}${escapeHtml(image)}${after}`);
    html = html.replace('<h3 id="modal-title" class="modal-product-title"></h3>', `<h3 id="modal-title" class="modal-product-title">${escapeHtml(product.name)}</h3>`);
    html = html.replace('<span id="modal-price" class="modal-price-pill text-xl"></span>', `<span id="modal-price" class="modal-price-pill text-xl">₪${product.price}</span>`);
    html = html.replace('<p id="modal-description" class="modal-description text-gray-600 mb-2"></p>', `<p id="modal-description" class="modal-description text-gray-600 mb-2">${escapeHtml(product.description)}</p>`);
    html = html.replace('<img id="modal-main-image" class="modal-image cursor-zoom-in" src="" alt="תצוגת מוצר">', `<img id="modal-main-image" class="modal-image cursor-zoom-in" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">`);
    const schema = {
      "@context": "https://schema.org/",
      "@type": "Product",
      name: product.name,
      image: product.images,
      description: product.description,
      sku: product.id,
      offers: {
        "@type": "Offer",
        url: canonical,
        priceCurrency: "ILS",
        price: product.price,
        itemCondition: "https://schema.org/NewCondition",
        availability: "https://schema.org/InStock"
      }
    };
    html = html.replace("</head>", `<script id="server-product-schema" type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script></head>`);
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/products") {
        return json(await getProducts(env), 200, { "cache-control": "public, max-age=60, stale-while-revalidate=300" });
      }
      if (request.method === "GET" && url.pathname === "/api/testimonials") {
        return json(await getTestimonials(env), 200, { "cache-control": "public, max-age=60, stale-while-revalidate=300" });
      }
      if (request.method === "POST" && url.pathname === "/api/uploads") return await handleUpload(request, env, url);
      if (request.method === "GET" && url.pathname.startsWith("/media/")) return await handleMedia(request, env, url);
      if (request.method === "POST" && url.pathname === "/api/orders") return await handleOrder(request, env);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return await renderPage(request, env);
      if (request.method === "GET" && url.pathname === "/robots.txt") {
        return new Response(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`, {
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      if (request.method === "GET" && url.pathname === "/sitemap.xml") {
        const products = await getProducts(env);
        const urls = [`${url.origin}/`, ...products.map((p) => `${url.origin}/?product=${encodeURIComponent(p.slug)}`)];
        const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((loc) => `<url><loc>${escapeHtml(loc)}</loc></url>`).join("")}</urlset>`;
        return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ message: "request failed", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "אירעה שגיאה בשרת." }, 500);
      return new Response("אירעה שגיאה בטעינת האתר.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
};
