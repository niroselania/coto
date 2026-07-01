# Lista del Super

App simple para armar una lista de compras del super, guardar listas con fecha en el navegador y compartirlas por WhatsApp.

## Ejecutar con Docker

```bash
docker compose up -d --build
```

La app queda disponible en:

```text
http://localhost:8088
```

## Deploy en Portainer

1. Subir este repo a GitHub.
2. En Portainer, ir a **Stacks** y crear un stack nuevo.
3. Elegir **Repository**.
4. Pegar la URL del repo.
5. Usar `docker-compose.yml` como compose path.
6. Deploy.

El puerto publicado por defecto es `8088`.
