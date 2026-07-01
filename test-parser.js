const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreName, parseCotoProducts } = require("./server");

test("prefiere productos equivalentes", () => {
  assert.ok(scoreName("Leche entera larga vida 1L", "Leche") > 0);
  assert.equal(scoreName("Yogur dulce de leche", "Leche"), -100);
});

test("parsea precio de Coto", () => {
  const data = {
    response: {
      results: [{
        value: "Leche larga vida",
        data: {
          "product.displayName": ["Leche entera larga vida 1L"],
          price: [{ store: "200", listPrice: 1999 }]
        }
      }]
    }
  };
  const offers = parseCotoProducts(data, "Leche");
  assert.equal(offers[0].price, 1999);
});
