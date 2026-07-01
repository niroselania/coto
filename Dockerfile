FROM nginx:1.27-alpine

COPY outputs/super-lista.html /usr/share/nginx/html/index.html

EXPOSE 80
