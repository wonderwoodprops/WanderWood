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
    "SELECT id, slug, name, price, description, images_json, is_available_now FROM products WHERE is_active = 1 ORDER BY sort_order ASC, name ASC"
  ).all();
  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: Number(row.price) || 0,
    description: row.description || "",
    images: safeImages(row.images_json),
    is_available_now: Boolean(row.is_available_now)
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
        <div class="flex flex-col items-start gap-1">
          <span class="text-xl font-bold text-[#3d2b1f]">₪${product.price}</span>
          ${product.is_available_now ? '<span class="rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-800">זמין במלאי</span>' : ''}
        </div>
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
  const assetUrl = new URL("/", url.origin);
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
        ...(product.is_available_now ? { availability: "https://schema.org/InStock" } : {})
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


// --- Admin authentication and catalog management ---
function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function adminSessionSignature(payload, password) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

function readCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const entry = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  return entry ? entry.slice(name.length + 1) : "";
}

async function verifyAdminRequest(request, env) {
  const password = String(env.ADMIN_PASSWORD || "");
  if (password.length !== 8) return { error: json({ ok: false, error: "סיסמת המנהל לא הוגדרה כראוי בשרת." }, 503) };
  const token = readCookie(request, "ww_admin_session");
  if (!token) return { error: json({ ok: false, error: "נדרשת התחברות." }, 401) };
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("invalid session");
    const [expires, nonce, signature] = parts;
    const expiry = Number(expires);
    if (!Number.isSafeInteger(expiry) || expiry < Math.floor(Date.now() / 1000) || !/^[A-Za-z0-9_-]{20,}$/.test(nonce)) throw new Error("expired session");
    const expected = await adminSessionSignature(expires + "." + nonce, password);
    const a = new TextEncoder().encode(signature);
    const b = new TextEncoder().encode(expected);
    if (a.length !== b.length) throw new Error("invalid signature");
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
    if (mismatch !== 0) throw new Error("invalid signature");
    return { email: "מנהל" };
  } catch {
    return { error: json({ ok: false, error: "ההתחברות פגה או אינה תקפה. יש להתחבר מחדש." }, 401, { "Set-Cookie": "ww_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" }) };
  }
}

async function createAdminSession(env) {
  const expires = String(Math.floor(Date.now() / 1000) + 12 * 60 * 60);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = toBase64Url(nonceBytes);
  const payload = expires + "." + nonce;
  const signature = await adminSessionSignature(payload, env.ADMIN_PASSWORD);
  return payload + "." + signature;
}

function adminSlug(name, id) {
  const slug = String(name || "").normalize("NFKC").toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 90);
  return (slug || "item") + "-" + id.slice(0, 8);
}

function parseImageList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter((item) => {
    try { const u = new URL(item); return (u.protocol === "https:" || u.protocol === "http:") && item.length <= 2048; }
    catch { return false; }
  }).slice(0, 20);
}

async function adminListProducts(env) {
  const { results = [] } = await env.DB.prepare("SELECT id, slug, name, price, description, images_json, sort_order, is_active, is_available_now FROM products ORDER BY sort_order ASC, name ASC").all();
  return results.map((row) => ({ ...row, price: Number(row.price) || 0, images: safeImages(row.images_json), is_active: Boolean(row.is_active), is_available_now: Boolean(row.is_available_now) }));
}

async function adminSaveProduct(request, env, id = null) {
  const data = await request.json();
  const name = String(data.name || "").trim();
  const price = Number(data.price);
  if (!name || name.length > 180 || !Number.isFinite(price) || price < 0 || price > 10000000) return json({ ok: false, error: "יש להזין שם מוצר ומחיר תקין." }, 400);
  const images = parseImageList(data.images);
  const description = String(data.description || "").trim().slice(0, 5000);
  const active = data.is_active === false || data.is_active === 0 ? 0 : 1;
  const availableNow = data.is_available_now === true || data.is_available_now === 1 ? 1 : 0;
  if (id) {
    const existing = await env.DB.prepare("SELECT id, name, slug FROM products WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "המוצר לא נמצא." }, 404);
    const slug = existing.name === name ? existing.slug : adminSlug(name, id);
    await env.DB.prepare("UPDATE products SET name=?, slug=?, price=?, description=?, images_json=?, is_active=?, is_available_now=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(name, slug, Math.round(price), description, JSON.stringify(images), active, availableNow, id).run();
  } else {
    const newId = crypto.randomUUID();
    const orderRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM products").first();
    await env.DB.prepare("INSERT INTO products (id, slug, name, price, description, images_json, sort_order, is_active, is_available_now) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId, adminSlug(name, newId), name, Math.round(price), description, JSON.stringify(images), Number(orderRow?.next_order || 1), active, availableNow).run();
    id = newId;
  }
  return json({ ok: true, id });
}

async function adminListTestimonials(env) {
  const { results = [] } = await env.DB.prepare("SELECT id, name, contact, content, images_json, sort_order, is_active FROM testimonials ORDER BY sort_order ASC").all();
  return results.map((row) => ({ ...row, images: safeImages(row.images_json), is_active: Boolean(row.is_active) }));
}

async function adminSaveTestimonial(request, env, id = null) {
  const data = await request.json();
  const name = String(data.name || "").trim();
  const content = String(data.content || "").trim();
  const contact = String(data.contact || "").trim().slice(0, 180);
  if (!name || name.length > 180 || !content || content.length > 5000) return json({ ok: false, error: "יש להזין שם ותוכן המלצה." }, 400);
  const images = parseImageList(data.images);
  const active = data.is_active === false || data.is_active === 0 ? 0 : 1;
  if (id) {
    const existing = await env.DB.prepare("SELECT id FROM testimonials WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "ההמלצה לא נמצאה." }, 404);
    await env.DB.prepare("UPDATE testimonials SET name=?, contact=?, content=?, images_json=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(name, contact, content, JSON.stringify(images), active, id).run();
  } else {
    const newId = crypto.randomUUID();
    const orderRow = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM testimonials").first();
    await env.DB.prepare("INSERT INTO testimonials (id, name, contact, content, images_json, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(newId, name, contact, content, JSON.stringify(images), Number(orderRow?.next_order || 1), active).run();
    id = newId;
  }
  return json({ ok: true, id });
}

async function adminUpload(request, env, url) {
  if (!env.UPLOADS || !env.UPLOAD_SIGNING_SECRET) return json({ ok: false, error: "אחסון התמונות לא הוגדר במלואו." }, 503);
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) return json({ ok: false, error: "לא נבחר קובץ תמונה." }, 400);
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type) || file.size > 15 * 1024 * 1024) return json({ ok: false, error: "אפשר להעלות תמונת JPG, PNG או WEBP עד 15MB." }, 415);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const validJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const validPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const validWebp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(validJpeg || validPng || validWebp)) return json({ ok: false, error: "הקובץ אינו תמונה תקינה." }, 415);
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = "catalog/" + crypto.randomUUID() + "." + ext;
  await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" } });
  const expires = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3650);
  const signature = await signMedia(key, expires, env.UPLOAD_SIGNING_SECRET);
  return json({ ok: true, url: url.origin + "/media/" + encodeURIComponent(key) + "?expires=" + expires + "&signature=" + signature });
}

async function adminListImages(env, url) {
  if (!env.UPLOADS || !env.UPLOAD_SIGNING_SECRET) return json({ ok: false, error: "אחסון התמונות לא הוגדר." }, 503);
  const images = [];
  let cursor;
  do {
    const page = await env.UPLOADS.list({ prefix: "catalog/", cursor, limit: 1000 });
    for (const object of page.objects || []) {
      const expires = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3650);
      const signature = await signMedia(object.key, expires, env.UPLOAD_SIGNING_SECRET);
      images.push({ key: object.key, size: object.size, uploaded: object.uploaded?.toISOString?.() || null, url: url.origin + "/media/" + object.key.split("/").map(encodeURIComponent).join("/") + "?expires=" + expires + "&signature=" + signature });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const [productRows, testimonialRows] = await Promise.all([
    env.DB.prepare("SELECT images_json FROM products").all(),
    env.DB.prepare("SELECT images_json FROM testimonials").all()
  ]);
  const storedKeys = new Set(images.map(item => item.key));
  const external = new Set();
  for (const row of [...(productRows.results||[]), ...(testimonialRows.results||[])]) {
    for (const imageUrl of safeImages(row.images_json)) {
      const key = mediaKeyFromUrl(imageUrl);
      if (!key && !external.has(imageUrl)) {
        external.add(imageUrl);
        images.push({ key: "external:" + imageUrl, size: 0, uploaded: null, external: true, url: imageUrl });
      } else if (key && !storedKeys.has(key)) {
        // Keep broken or legacy media references visible so they can be cleaned up.
        external.add(imageUrl);
        images.push({ key: "external:" + imageUrl, size: 0, uploaded: null, external: true, missing: true, url: imageUrl });
      }
    }
  }
  images.sort((a,b)=>(b.uploaded||"").localeCompare(a.uploaded||""));
  return json(images);
}
function mediaKeyFromUrl(value) {
  try {
    const u = new URL(value);
    // Legacy signed media URLs may encode the whole key as one path segment:
    // /media/catalog%2F<uuid>.jpg. Decode before checking the prefix.
    const pathname = decodeURIComponent(u.pathname);
    if (!pathname.startsWith("/media/catalog/")) return null;
    return pathname.slice("/media/".length);
  } catch { return null; }
}
async function adminDeleteImage(env, key) {
  const externalUrl = key.startsWith("external:") ? key.slice("external:".length) : null;
  if (externalUrl) {
    try { const parsed = new URL(externalUrl); if (!["http:","https:"].includes(parsed.protocol)) throw new Error(); }
    catch { return json({ok:false,error:"קישור תמונה לא תקין."},400); }
  } else {
    if (!env.UPLOADS || !key || !key.startsWith("catalog/") || key.includes("..")) return json({ok:false,error:"תמונה לא תקינה."},400);
    const object = await env.UPLOADS.head(key);
    if (!object) return json({ok:false,error:"התמונה לא נמצאה באחסון."},404);
  }
  const [products, testimonials] = await Promise.all([
    env.DB.prepare("SELECT id, images_json FROM products").all(),
    env.DB.prepare("SELECT id, images_json FROM testimonials").all()
  ]);
  const clean = rows => (rows.results||[]).map(row => ({id:row.id,images:safeImages(row.images_json).filter(url=>externalUrl ? url!==externalUrl : mediaKeyFromUrl(url)!==key)}));
  const p = clean(products), t = clean(testimonials);
  const updates = [
    ...p.filter(x=>x.images.length!==safeImages((products.results||[]).find(r=>r.id===x.id)?.images_json).length).map(x=>env.DB.prepare("UPDATE products SET images_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(x.images),x.id)),
    ...t.filter(x=>x.images.length!==safeImages((testimonials.results||[]).find(r=>r.id===x.id)?.images_json).length).map(x=>env.DB.prepare("UPDATE testimonials SET images_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(x.images),x.id))
  ];
  if (updates.length) await env.DB.batch(updates);
  if (!externalUrl) await env.UPLOADS.delete(key);
  return json({ok:true});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/admin") return Response.redirect(new URL("/admin/", url), 302);
      if (url.pathname === "/admin/") return env.ASSETS.fetch(new Request(new URL("/admin/", url.origin), request));
      if (url.pathname.startsWith("/api/admin/")) {
        if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json({ ok: false, error: "הבקשה נדחתה." }, 403);
        if (url.pathname === "/api/admin/login" && request.method === "POST") {
          const configured = String(env.ADMIN_PASSWORD || "");
          if (configured.length !== 8) return json({ ok: false, error: "סיסמת המנהל לא הוגדרה כראוי בשרת." }, 503);
          const data = await request.json().catch(() => ({}));
          const supplied = String(data.password || "");
          if (supplied.length !== 8 || supplied !== configured) return json({ ok: false, error: "הסיסמה שגויה." }, 401);
          const session = await createAdminSession(env);
          return json({ ok: true }, 200, { "Set-Cookie": "ww_admin_session=" + session + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200" });
        }
        if (url.pathname === "/api/admin/logout" && request.method === "POST") {
          return json({ ok: true }, 200, { "Set-Cookie": "ww_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
        }
        const auth = await verifyAdminRequest(request, env);
        if (auth.error) return auth.error;
        if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json({ ok: false, error: "הבקשה נדחתה." }, 403);
        if (request.method === "GET" && url.pathname === "/api/admin/session") return json({ ok: true, email: auth.email });
        if (url.pathname === "/api/admin/products" && request.method === "GET") return json(await adminListProducts(env));
        if (url.pathname === "/api/admin/products" && request.method === "POST") return await adminSaveProduct(request, env);
        if (url.pathname.startsWith("/api/admin/products/")) {
          const id = decodeURIComponent(url.pathname.slice("/api/admin/products/".length));
          if (request.method === "PUT") return await adminSaveProduct(request, env, id);
          if (request.method === "DELETE") return json({ ok: false, error: "מחיקה קבועה אינה זמינה; אפשר להסתיר מוצר." }, 405);
        }
        if (url.pathname === "/api/admin/testimonials" && request.method === "GET") return json(await adminListTestimonials(env));
        if (url.pathname === "/api/admin/testimonials" && request.method === "POST") return await adminSaveTestimonial(request, env);
        if (url.pathname.startsWith("/api/admin/testimonials/")) {
          const id = decodeURIComponent(url.pathname.slice("/api/admin/testimonials/".length));
          if (request.method === "PUT") return await adminSaveTestimonial(request, env, id);
          if (request.method === "DELETE") return json({ ok: false, error: "מחיקה קבועה אינה זמינה; אפשר להסתיר המלצה." }, 405);
        }
        if (url.pathname === "/api/admin/uploads" && request.method === "POST") return await adminUpload(request, env, url);
        if (url.pathname === "/api/admin/images" && request.method === "GET") return await adminListImages(env, url);
        if (url.pathname === "/api/admin/images" && request.method === "DELETE") {
          const imageUrl = url.searchParams.get("url") || "";
          return await adminDeleteImage(env, "external:" + imageUrl);
        }
        if (url.pathname.startsWith("/api/admin/images/") && request.method === "DELETE") {
          const key = decodeURIComponent(url.pathname.slice("/api/admin/images/".length));
          return await adminDeleteImage(env, key);
        }
        return json({ ok: false, error: "הנתיב לא נמצא." }, 404);
      }
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
