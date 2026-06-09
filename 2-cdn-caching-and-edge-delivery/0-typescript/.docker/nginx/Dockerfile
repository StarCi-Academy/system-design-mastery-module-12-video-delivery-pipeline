# syntax=docker/dockerfile:1

# Build NGINX with the ngx_cache_purge module compiled in, so the PURGE
# verb can evict cache entries on demand. The official nginx image does
# not bundle this third-party module, so we compile it from source.
ARG NGINX_VERSION=1.27.4
FROM nginx:${NGINX_VERSION}-alpine AS build
ARG NGINX_VERSION
ARG CACHE_PURGE_VERSION=2.5.3

RUN apk add --no-cache \
        gcc libc-dev make openssl-dev pcre2-dev zlib-dev linux-headers \
        curl gnupg libxslt-dev gd-dev geoip-dev

RUN curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" -o /tmp/nginx.tar.gz \
    && curl -fsSL "https://github.com/nginx-modules/ngx_cache_purge/archive/refs/tags/${CACHE_PURGE_VERSION}.tar.gz" -o /tmp/purge.tar.gz \
    && mkdir -p /tmp/nginx /tmp/purge \
    && tar -xzf /tmp/nginx.tar.gz -C /tmp/nginx --strip-components=1 \
    && tar -xzf /tmp/purge.tar.gz -C /tmp/purge --strip-components=1

WORKDIR /tmp/nginx
RUN ./configure \
        --with-compat \
        --add-dynamic-module=/tmp/purge \
    && make modules \
    && mkdir -p /modules \
    && cp objs/ngx_http_cache_purge_module.so /modules/

# ---- Runtime ----
FROM nginx:${NGINX_VERSION}-alpine
COPY --from=build /modules/ngx_http_cache_purge_module.so /etc/nginx/modules/ngx_http_cache_purge_module.so
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080
