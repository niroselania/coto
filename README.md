# Lista del Super

App simple para armar una lista de compras del super, guardar listas con fecha en el navegador, compartirlas por WhatsApp y comparar precios publicados entre Coto y Carrefour.

Configuracion inicial:

- Zona: Beccar 1643
- Modalidad: compra en sucursal
- Promo considerada: Comunidad Coto
- Criterio: elegir el producto mas barato cuando haya varias opciones equivalentes

## Ejecutar con Docker

```bash
docker compose up -d --build
```

La app queda disponible en:

```text
http://localhost:6066
```

## Comparador de precios

El boton **Comparar** envia los productos seleccionados al backend incluido en el contenedor. El backend busca precios publicados en:

- Coto Digital
- Carrefour Argentina

Cuando puede leer un precio confiable, calcula subtotales por supermercado y marca el producto mas barato. Cuando el sitio cambia, bloquea la lectura o no devuelve precio claro, la app muestra **Revisar** y deja el link de busqueda para abrirlo manualmente.

No guarda usuarios ni claves. Las promos personales que requieran login no se automatizan; solo se intentan detectar promos publicas visibles, como Comunidad Coto.

## Deploy en Portainer

1. Subir este repo a GitHub.
2. En Portainer, ir a **Stacks** y crear un stack nuevo.
3. Elegir **Repository**.
4. Pegar la URL del repo.
5. Usar `docker-compose.yml` como compose path.
6. Deploy.

El puerto publicado por defecto es `6066`.
