const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, "outputs");
const COTO_API = "https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1";
const COTO_KEY = "key_r6xzz4IAoTWcipni";
const COTO_STORE = "200";

const PRODUCT_SEARCH_ALIASES = {
  "leche": "leche larga vida 1l",
  "pan lactal": "pan lactal"
};

const PRODUCT_EXCLUSIONS = {
  "leche": ["yogur", "dulce de leche", "capsulas", "cápsulas", "espumador"],
  "pan lactal": ["hamburguesa", "pancho", "panchos"]
};

const STORES = [
  { id: "coto", name: "Coto" },
  { id: "carrefour", name: "Carrefour" }
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productSearchQuery(product) {
  return PRODUCT_SEARCH_ALIASES[normalize(product)] || product;
}

function scoreName(name, query) {
  const nameNorm = normalize(name);
  const queryNorm = normalize(query);
  const queryTokens = queryNorm.split(" ").filter(Boolean);
  if (!queryTokens.length) return 0;
  const exclusions = PRODUCT_EXCLUSIONS[queryNorm] || [];
  if (exclusions.some(exclusion => nameNorm.includes(normalize(exclusion)))) return -100;
  let score = queryTokens.reduce((sum, token) => sum + (nameNorm.includes(token) ? 1 : 0), 0);
  if (nameNorm.includes(queryNorm)) score += 10;
  if (nameNorm.startsWith(queryTokens[0])) score += 4;
  if (queryNorm === "leche" && /\bleche\b/.test(nameNorm)) score += 5;
  if (queryNorm === "pan lactal" && /\bpan\b/.test(nameNorm) && /\blactal\b/.test(nameNorm)) score += 5;
  return score;
}

function chooseBestOffer(offers) {
  return offers
    .filter(offer => Number.isFinite(offer.price) && offer.price > 0 && offer.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.price - b.price))[0] || null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "accept-language": "es-AR,es;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        origin: "https://www.cotodigital.com.ar",
        referer: "https://www.cotodigital.com.ar/sitios/cdigi/nuevositio"
      }
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, data: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timeout);
  }
}

function cotoSearchUrl(query) {
  return `https://www.cotodigital.com.ar/sitios/cdigi/nuevositio/productos/${encodeURIComponent(query)}`;
}

function carrefourSearchUrl(query) {
  return `https://www.carrefour.com.ar/${encodeURIComponent(query)}?_q=${encodeURIComponent(query)}&map=ft`;
}

function parseCotoProducts(data, product) {
  const results = data?.response?.results || [];
  return results.map(result => {
    const attrs = result.data || {};
    const name = attrs["product.displayName"]?.[0] || attrs["sku.displayName"]?.[0] || result.value || product;
    const prices = attrs.price || [];
    const storePrice = prices.find(price => String(price.store).padStart(3, "0") === COTO_STORE) || prices[0];
    const price = Number(storePrice?.listPrice || storePrice?.formatPrice || attrs["sku.activePrice"]?.[0] || 0);
    const promos = [
      ...(attrs["product.dtoDescuentos"] || []),
      ...(attrs["product.tipoOferta"] || [])
    ].map(String).filter(Boolean).slice(0, 3);
    return {
      name,
      price,
      url: cotoSearchUrl(productSearchQuery(product)),
      promotions: promos,
      source: "coto-api",
      score: scoreName(name, product)
    };
  });
}

function parseCarrefourProducts(products, product) {
  if (!Array.isArray(products)) return [];
  return products.flatMap(item => {
    const name = item.productName || product;
    const promotions = Object.values(item.productClusters || {})
      .filter(label => /promo|dto|off|2x1|3x2|4x3|descuento|unidad/i.test(label))
      .slice(0, 3);
    return (item.items || []).flatMap(sku => (sku.sellers || []).map(seller => {
      const offer = seller.commertialOffer || {};
      const sellerName = String(seller.sellerName || "");
      const price = Number(offer.Price || offer.spotPrice || 0);
      const available = Number(offer.AvailableQuantity || 0);
      if (!/carrefour/i.test(sellerName) || price <= 0 || available <= 0) return null;
      return {
        name,
        price,
        url: item.link || carrefourSearchUrl(productSearchQuery(product)),
        promotions,
        source: "carrefour-api",
        score: scoreName(name, product)
      };
    }).filter(Boolean));
  });
}

async function findCotoOffer(product) {
  const query = productSearchQuery(product);
  const params = new URLSearchParams({
    key: COTO_KEY,
    num_results_per_page: "12",
    pre_filter_expression: JSON.stringify({ name: "store_availability", value: COTO_STORE }),
    c: "cio-fe-web-coto-super-lista"
  });
  const apiUrl = `${COTO_API}/products/search/${encodeURIComponent(query)}?${params}`;
  const searchUrl = cotoSearchUrl(query);
  try {
    const { ok, status, data } = await fetchJson(apiUrl);
    const best = ok ? chooseBestOffer(parseCotoProducts(data, product)) : null;
    if (best) return { store: "coto", storeName: "Coto", product, found: true, status: "ok", searchUrl, ...best };
    return { store: "coto", storeName: "Coto", product, found: false, status: "needs-review", message: `Coto no devolvió precio confiable (${status}).`, searchUrl };
  } catch (error) {
    return { store: "coto", storeName: "Coto", product, found: false, status: "error", message: "No se pudo consultar Coto.", searchUrl };
  }
}

async function findCarrefourOffer(product) {
  const query = productSearchQuery(product);
  const apiUrl = `https://www.carrefour.com.ar/api/catalog_system/pub/products/search/${encodeURIComponent(query)}?_from=0&_to=9`;
  const searchUrl = carrefourSearchUrl(query);
  try {
    const { ok, status, data } = await fetchJson(apiUrl);
    const best = ok ? chooseBestOffer(parseCarrefourProducts(data, product)) : null;
    if (best) return { store: "carrefour", storeName: "Carrefour", product, found: true, status: "ok", searchUrl, ...best };
    return { store: "carrefour", storeName: "Carrefour", product, found: false, status: "needs-review", message: `Carrefour no devolvió precio confiable (${status}).`, searchUrl };
  } catch (error) {
    return { store: "carrefour", storeName: "Carrefour", product, found: false, status: "error", message: "No se pudo consultar Carrefour.", searchUrl };
  }
}

async function compareProducts(products) {
  const unique = [...new Set(products.map(item => String(item).trim()).filter(Boolean))].slice(0, 50);
  const rows = [];
  for (const product of unique) {
    const [coto, carrefour] = await Promise.all([findCotoOffer(product), findCarrefourOffer(product)]);
    const found = [coto, carrefour].filter(offer => offer.found).sort((a, b) => a.price - b.price);
    rows.push({ product, offers: { coto, carrefour }, cheapestStore: found[0]?.store || null });
  }
  const totals = STORES.map(store => {
    const offers = rows.map(row => row.offers[store.id]);
    const found = offers.filter(offer => offer?.found);
    return {
      store: store.id,
      name: store.name,
      total: found.reduce((sum, offer) => sum + offer.price, 0),
      found: found.length,
      missing: offers.length - found.length,
      complete: found.length === offers.length
    };
  });
  const complete = totals.filter(total => total.complete).sort((a, b) => a.total - b.total);
  return {
    generatedAt: new Date().toISOString(),
    stores: STORES,
    rows,
    totals,
    cheapestTotalStore: complete[0]?.store || null
  };
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "super-lista.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const file = await fs.readFile(filePath);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(file);
}

async function router(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === "POST" && url.pathname === "/api/compare") {
      const body = await readJsonBody(request);
      const result = await compareProducts(Array.isArray(body.products) ? body.products : []);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      return;
    }
    if (request.method === "GET") {
      await serveStatic(response, url.pathname);
      return;
    }
    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Error interno", detail: error.message }));
  }
}

if (require.main === module) {
  http.createServer(router).listen(PORT, "0.0.0.0", () => {
    console.log(`Super lista escuchando en puerto ${PORT}`);
  });
}

module.exports = { compareProducts, scoreName, parseCotoProducts, parseCarrefourProducts };
