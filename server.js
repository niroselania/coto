const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, "outputs");
const DEFAULT_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const APP_CONFIG = {
  zone: "Beccar",
  postalCode: "1643",
  shoppingMode: "sucursal",
  memberships: ["Comunidad Coto"],
  autoPickCheapest: true
};

const STORES = [
  {
    id: "coto",
    name: "Coto",
    membership: "Comunidad Coto",
    searchUrl(query) {
      return `https://www.cotodigital.com.ar/sitios/cdigi/browse?Ntt=${encodeURIComponent(query)}`;
    }
  },
  {
    id: "carrefour",
    name: "Carrefour",
    membership: null,
    apiUrl(query) {
      return `https://www.carrefour.com.ar/api/catalog_system/pub/products/search/${encodeURIComponent(query)}?_from=0&_to=9`;
    },
    searchUrl(query) {
      return `https://www.carrefour.com.ar/${encodeURIComponent(query)}?_q=${encodeURIComponent(query)}&map=ft`;
    }
  }
];

const PRODUCT_SEARCH_ALIASES = {
  "leche": "leche larga vida 1l",
  "pan lactal": "pan lactal",
  "pan de hamburguesa": "pan hamburguesa",
  "pan de pancho": "pan pancho"
};

const PRODUCT_EXCLUSIONS = {
  "leche": ["yogur", "dulce de leche", "capsulas", "cápsulas", "espumador", "chocolate"],
  "pan lactal": ["hamburguesa", "pancho", "panchos"],
  "pan de hamburguesa": ["lactal blanco", "salvado"],
  "pan de pancho": ["hamburguesa", "lactal blanco", "salvado"]
};

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArgentinePrice(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/[^\d,.]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPromotions(text, store) {
  const promoWords = ["oferta", "promo", "promocion", "promoción", "descuento", "2x1", "3x2", "segunda unidad", "comunidad coto"];
  const cleanText = stripTags(text);
  const chunks = cleanText.split(/(?<=[.!?])\s+|\s{2,}/).filter(Boolean);
  return chunks
    .filter(chunk => promoWords.some(word => normalize(chunk).includes(normalize(word))))
    .filter(chunk => !store.membership || normalize(chunk).includes("comunidad coto") || normalize(chunk).includes("promo") || normalize(chunk).includes("oferta"))
    .slice(0, 3);
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

function productSearchQuery(product) {
  const normalized = normalize(product);
  return PRODUCT_SEARCH_ALIASES[normalized] || product;
}

function isEquivalentProduct(name, product) {
  return scoreName(name, product) > 0;
}

function parseJsonLdOffers(html, baseUrl, query, store) {
  const offers = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graph = Array.isArray(node["@graph"]) ? node["@graph"] : [node];
        for (const item of graph) {
          const price = parseArgentinePrice(item?.offers?.price || item?.price);
          const name = item?.name || query;
          if (price) {
            offers.push({
              name,
              price,
              url: absoluteUrl(baseUrl, item?.url || item?.offers?.url || baseUrl),
              source: "json-ld",
              promotions: extractPromotions(JSON.stringify(item), store),
              score: scoreName(name, query)
            });
          }
        }
      }
    } catch {
      // Ignore malformed embedded JSON.
    }
  }
  return offers;
}

function parseHtmlPriceHints(html, baseUrl, query, store) {
  const offers = [];
  const text = stripTags(html);
  const priceMatches = [...text.matchAll(/\$\s?([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:,[0-9]{2})?)/g)].slice(0, 12);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : query;
  const productName = title.split("|")[0].split("-")[0].trim() || query;

  for (const match of priceMatches) {
    const context = text.slice(Math.max(0, match.index - 90), match.index + 120);
    if (/descuento|mínimo|minimo|regalamos|ahorra|tope|bonific/i.test(context)) continue;
    const price = parseArgentinePrice(match[1]);
    if (!price || price < 100) continue;
    offers.push({
      name: productName,
      price,
      url: baseUrl,
      source: "html",
      promotions: extractPromotions(text.slice(Math.max(0, match.index - 220), match.index + 260), store),
      score: scoreName(productName, query)
    });
  }
  return offers;
}

function parseVtexProducts(products, query, store) {
  if (!Array.isArray(products)) return [];
  const offers = [];

  for (const product of products) {
    const name = product.productName || product.productTitle || query;
    const productScore = scoreName(name, query);
    if (!isEquivalentProduct(name, query)) continue;
    const promotions = Object.values(product.productClusters || {})
      .filter(label => /promo|dto|off|2x1|3x2|4x3|descuento|unidad/i.test(label))
      .slice(0, 4);

    for (const sku of product.items || []) {
      for (const seller of sku.sellers || []) {
        const commercial = seller.commertialOffer || {};
        const price = Number(commercial.Price || commercial.spotPrice || 0);
        const available = Number(commercial.AvailableQuantity || 0);
        const sellerName = String(seller.sellerName || "");
        if (!Number.isFinite(price) || price <= 0 || available <= 0) continue;
        if (store.id === "carrefour" && sellerName && !/carrefour/i.test(sellerName)) continue;
        offers.push({
          name,
          price,
          url: product.link || store.searchUrl(query),
          source: "vtex-api",
          promotions,
          score: productScore
        });
      }
    }
  }

  return offers;
}

function chooseBestOffer(offers) {
  const valid = offers
    .filter(offer => Number.isFinite(offer.price))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.price - b.price;
    });
  return valid[0] || null;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "es-AR,es;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
      }
    });
    const html = await response.text();
    return { ok: response.ok, status: response.status, html };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "accept-language": "es-AR,es;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
      }
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function findStoreOffer(store, product) {
  const lookupQuery = productSearchQuery(product);
  const searchUrl = store.searchUrl(lookupQuery);
  try {
    if (store.apiUrl) {
      const apiUrl = store.apiUrl(lookupQuery);
      const { ok, status, data } = await fetchJson(apiUrl);
      if (ok) {
        const best = chooseBestOffer(parseVtexProducts(data, product, store));
        if (best) {
          return {
            store: store.id,
            storeName: store.name,
            product,
            found: true,
            status: "ok",
            name: best.name,
            price: best.price,
            url: best.url,
            searchUrl,
            promotions: best.promotions,
            source: best.source
          };
        }
      } else {
        return {
          store: store.id,
          storeName: store.name,
          product,
          found: false,
          status: "needs-review",
          message: `La API respondió ${status}.`,
          searchUrl
        };
      }
    }

    const { ok, status, html } = await fetchHtml(searchUrl);
    if (!ok || !html) {
      return {
        store: store.id,
        storeName: store.name,
        product,
        found: false,
        status: "needs-review",
        message: `El sitio respondió ${status}.`,
        searchUrl
      };
    }

    const offers = [
      ...parseJsonLdOffers(html, searchUrl, product, store),
      ...parseHtmlPriceHints(html, searchUrl, product, store)
    ].filter(offer => isEquivalentProduct(offer.name, product));
    const best = chooseBestOffer(offers);

    if (!best) {
      return {
        store: store.id,
        storeName: store.name,
        product,
        found: false,
        status: "needs-review",
        message: "No pude leer un precio confiable; revisar el link.",
        searchUrl
      };
    }

    return {
      store: store.id,
      storeName: store.name,
      product,
      found: true,
      status: "ok",
      name: best.name,
      price: best.price,
      url: best.url,
      searchUrl,
      promotions: best.promotions,
      source: best.source
    };
  } catch (error) {
    return {
      store: store.id,
      storeName: store.name,
      product,
      found: false,
      status: "error",
      message: error.name === "AbortError" ? "La búsqueda tardó demasiado." : "No se pudo consultar el sitio.",
      searchUrl
    };
  }
}

function buildTotals(rows) {
  return STORES.map(store => {
    const storeRows = rows.map(row => row.offers[store.id]);
    const foundRows = storeRows.filter(offer => offer?.found);
    const missingRows = storeRows.filter(offer => !offer?.found);
    const total = foundRows.reduce((sum, offer) => sum + offer.price, 0);
    return {
      store: store.id,
      name: store.name,
      total,
      found: foundRows.length,
      missing: missingRows.length,
      complete: missingRows.length === 0
    };
  });
}

async function compareProducts(products) {
  const uniqueProducts = [...new Set(products.map(item => String(item).trim()).filter(Boolean))].slice(0, 60);
  const rows = [];

  for (const product of uniqueProducts) {
    const offersArray = await Promise.all(STORES.map(store => findStoreOffer(store, product)));
    const offers = Object.fromEntries(offersArray.map(offer => [offer.store, offer]));
    const foundOffers = offersArray.filter(offer => offer.found);
    const cheapest = foundOffers.sort((a, b) => a.price - b.price)[0] || null;
    rows.push({ product, offers, cheapestStore: cheapest?.store || null });
  }

  const totals = buildTotals(rows);
  const completeTotals = totals.filter(total => total.complete);
  const cheapestTotal = completeTotals.sort((a, b) => a.total - b.total)[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    config: APP_CONFIG,
    stores: STORES.map(({ id, name, membership }) => ({ id, name, membership })),
    rows,
    totals,
    cheapestTotalStore: cheapestTotal?.store || null
  };
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function serveStatic(response, requestedPath) {
  const safePath = requestedPath === "/" ? "/super-lista.html" : requestedPath;
  const filePath = path.join(PUBLIC_DIR, safePath.replace(/^\/+/, ""));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const file = await fs.readFile(resolved);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(file);
}

async function router(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/config") {
      response.writeHead(200, DEFAULT_HEADERS);
      response.end(JSON.stringify({ config: APP_CONFIG, stores: STORES.map(({ id, name, membership }) => ({ id, name, membership })) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/compare") {
      const body = await readJsonBody(request);
      const result = await compareProducts(Array.isArray(body.products) ? body.products : []);
      response.writeHead(200, DEFAULT_HEADERS);
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET") {
      await serveStatic(response, url.pathname);
      return;
    }

    response.writeHead(405, DEFAULT_HEADERS);
    response.end(JSON.stringify({ error: "Method not allowed" }));
  } catch (error) {
    response.writeHead(500, DEFAULT_HEADERS);
    response.end(JSON.stringify({ error: "Error interno", detail: error.message }));
  }
}

if (require.main === module) {
  http.createServer(router).listen(PORT, "0.0.0.0", () => {
    console.log(`Lista del Super escuchando en puerto ${PORT}`);
  });
}

module.exports = {
  normalize,
  parseArgentinePrice,
  parseJsonLdOffers,
  parseHtmlPriceHints,
  parseVtexProducts,
  chooseBestOffer,
  compareProducts
};
