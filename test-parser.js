const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgentinePrice, parseJsonLdOffers, parseHtmlPriceHints, parseVtexProducts, chooseBestOffer } = require("./server");

test("parsea precios argentinos", () => {
  assert.equal(parseArgentinePrice("$ 1.234,56"), 1234.56);
  assert.equal(parseArgentinePrice("999,00"), 999);
});

test("lee ofertas JSON-LD", () => {
  const html = '<script type="application/ld+json">{"@type":"Product","name":"Leche Entera 1L","offers":{"price":"1250.50","url":"/leche"}}<\/script>';
  const offers = parseJsonLdOffers(html, "https://example.test/buscar", "leche", { membership: null });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 1250.5);
  assert.equal(offers[0].url, "https://example.test/leche");
});

test("elige la oferta mas barata entre resultados equivalentes", () => {
  const best = chooseBestOffer([
    { name: "Leche A", price: 1500, score: 1 },
    { name: "Leche B", price: 1200, score: 1 }
  ]);
  assert.equal(best.name, "Leche B");
});

test("lee precio visible en HTML simple", () => {
  const html = "<html><head><title>Arroz largo fino</title></head><body><h1>Arroz</h1><span>$ 2.345,00</span></body></html>";
  const offers = parseHtmlPriceHints(html, "https://example.test/arroz", "arroz", { membership: null });
  assert.equal(offers[0].price, 2345);
});

test("ignora descuentos cuando lee precios visibles", () => {
  const html = "<html><head><title>Leche</title></head><body>Te regalamos $5.000 de descuento en tu compra</body></html>";
  const offers = parseHtmlPriceHints(html, "https://example.test/leche", "leche", { membership: null });
  assert.equal(offers.length, 0);
});

test("lee precios desde productos VTEX", () => {
  const offers = parseVtexProducts([
    {
      productName: "Leche Protein La Serenisima 1L",
      link: "https://example.test/leche/p",
      productClusters: { "1": "3x2 en productos seleccionados" },
      items: [
        {
          sellers: [
            { sellerName: "CARREFOUR", commertialOffer: { Price: 1500, AvailableQuantity: 10 } },
            { sellerName: "Marketplace", commertialOffer: { Price: 10, AvailableQuantity: 10 } }
          ]
        }
      ]
    }
  ], "leche", { id: "carrefour", searchUrl: () => "https://example.test" });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 1500);
  assert.deepEqual(offers[0].promotions, ["3x2 en productos seleccionados"]);
});
