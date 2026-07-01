# Lista del Super

App para armar una lista de compras, guardar listas con fecha, compartir por WhatsApp y comparar precios publicados entre Coto y Carrefour.

Configuracion:

- Zona: Beccar 1643
- Modalidad: compra en sucursal
- Coto: API publica nueva de Coto Digital, sucursal web `200`
- Carrefour: API publica de catalogo
- Puerto Portainer: `6066`

## Portainer

1. Subir todos estos archivos a un repo de GitHub.
2. En Portainer ir a **Stacks**.
3. Crear stack desde **Repository**.
4. Pegar la URL del repo.
5. Compose path: `docker-compose.yml`.
6. Deploy.

La app queda en:

```text
http://IP_DE_TU_SERVIDOR:6066
```

## Local

```bash
docker compose up -d --build
```
