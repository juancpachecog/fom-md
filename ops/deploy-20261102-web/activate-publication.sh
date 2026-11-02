#!/usr/bin/env bash
# Sólo cambia la raíz del sitio. Conserva certificados, proxy y rutas de API.
# No supone cuál web está activa: lee la raíz actual de Nginx (cualquier release anterior),
# la guarda en raiz-anterior.txt del respaldo y vuelve a ella sola si algo falla.
set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
fail() { printf 'FOM_WEB=FAIL %s\n' "$1" >&2; exit 1; }
test "$(id -u)" = 0 || fail 'Ejecutar con sudo dentro de fom-app-01.'
test "$(hostname -s)" = fom-app-01 || fail 'Servidor incorrecto.'
stage=$(cd -- "$(dirname -- "$0")" && pwd)
config=/etc/nginx/sites-available/fom-mobile.conf
release=/var/www/fom-web/releases/20261102-web
backup=/var/backups/fom-web/20261102-web-$(date +%Y%m%dT%H%M%S)-$$
test ! -L "$config" || fail 'La configuración cambió de tipo.'
# Debe haber exactamente una raíz apuntando a una carpeta de releases.
test "$(grep -cE '^\s*root\s+/var/www/fom-web/releases/[A-Za-z0-9._-]+;\s*$' "$config")" = 1 || fail 'No encuentro una sola raíz de releases en Nginx; revisar antes de publicar.'
oldroot=$(sed -nE 's|^\s*root\s+(/var/www/fom-web/releases/[A-Za-z0-9._-]+);\s*$|\1|p' "$config")
test "$oldroot" != "$release" || fail 'Esta publicación ya está activa.'
cd "$stage"
sha256sum --quiet -c SHA256SUMS || fail "El paquete subido está incompleto o dañado (no coincide con SHA256SUMS). No se cambió nada: volver a subirlo."
nginx -t
test ! -e "$release" || fail 'La carpeta de esta publicación ya existe; revisar el intento anterior.'
install -d -m 0755 "$release"
cp -a dist/. "$release/"
chown -R root:root "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +
(cd "$release"; sed -nE 's@^([0-9a-f]{64}) [ *]dist/@\1  @p' "$stage/SHA256SUMS" | sha256sum --quiet -c -) || fail 'La copia instalada no coincide con SHA256SUMS.'
install -d -m 0700 "$backup"
cp -a "$config" "$backup/fom-mobile.conf"
printf '%s\n' "$oldroot" > "$backup/raiz-anterior.txt"
phase='preparar configuración'
rollback() {
  trap - ERR
  printf 'FOM_WEB=FAIL fase=%s; restaurando la web anterior.\n' "$phase" >&2
  cp -a "$backup/fom-mobile.conf" "$config"
  nginx -t && systemctl reload nginx
  printf 'Respaldo de configuración: %s\n' "$backup" >&2
  exit 1
}
trap rollback ERR
python3 - "$config" "$backup/fom-mobile.after.conf" "$oldroot" "$release" <<'PY'
import pathlib, re, sys
config, destination, oldroot, newroot = sys.argv[1:]
text = pathlib.Path(config).read_text()
pattern = r'(?m)^(\s*root\s+)' + re.escape(oldroot) + r'(;\s*)$'
result, count = re.subn(pattern, lambda m: m[1] + newroot + m[2], text)
if count != 1:
    raise SystemExit('La raíz esperada no aparece exactamente una vez.')
pathlib.Path(destination).write_text(result)
PY
phase='activar configuración'
install -o root -g root -m 0644 "$backup/fom-mobile.after.conf" "$config"
nginx -t
systemctl reload nginx
origin=https://15.204.105.201
probe=(curl --noproxy '*' --silent --show-error --max-time 15 --resolve 15.204.105.201:443:10.20.30.10)
phase='comprobar el índice publicado'
ready=false
for attempt in $(seq 1 20); do
  if "${probe[@]}" --fail --max-time 3 -o "$backup/probe.html" "$origin/" && cmp -s "$backup/probe.html" "$release/index.html"; then ready=true; break; fi
  sleep 0.5
done
test "$ready" = true
phase='comprobar pantallas y recursos públicos'
for route in /panel/mi-perfil /panel/mantenimiento /panel/mapa /plataforma /funciones /contacto; do
  "${probe[@]}" --fail "$origin$route" | cmp - "$release/index.html"
done
# Cada entrada JS/CSS del índice debe existir en el sitio y coincidir byte a byte.
while IFS= read -r resource; do
  "${probe[@]}" --fail "$origin$resource" | cmp - "$release$resource"
done < <(grep -oE '/assets/[^" ]+\.(js|css)' "$release/index.html" | sort -u)
# Quitador de fondo del navegador (modelo y motor): la web funciona sin él, así que si algo
# no coincide solo se avisa y NO se deshace la publicación.
for resource in /modelos/isnet-fp16.onnx /ort/ort-wasm-simd-threaded.asyncify.wasm /ort/ort-wasm-simd-threaded.asyncify.mjs; do
  esperado=$(stat -c %s "$release$resource")
  recibido=$("${probe[@]}" -o /dev/null -w '%{size_download}' "$origin$resource" || true)
  test "$esperado" = "$recibido" || printf 'FOM_WEB=AVISO %s no se sirve completo (esperado %s bytes, llegó %s); el quitador de fondo no funcionará hasta revisar Nginx.\n' "$resource" "$esperado" "$recibido" >&2
done
tipo=$("${probe[@]}" -o /dev/null -w '%{content_type}' "$origin/ort/ort-wasm-simd-threaded.asyncify.mjs" || true)
case "$tipo" in *javascript*) ;; *) printf 'FOM_WEB=AVISO /ort/*.mjs se sirve como «%s», no como JavaScript; el quitador de fondo no cargará hasta revisar Nginx.\n' "$tipo" >&2 ;; esac
phase='comprobar sesión y rutas internas'
test "$("${probe[@]}" -o /dev/null -w '%{http_code}' "$origin/fom-api/api/v1/console/auth/session")" = 401
test "$("${probe[@]}" -o /dev/null -w '%{http_code}' "$origin/fom-api/gps-console-internal/api/devices")" = 404
"${probe[@]}" --fail "$origin/health" > /dev/null
trap - ERR
printf 'FOM_WEB_PUBLISHED url=%s release=%s anterior=%s backup=%s\n' "$origin" "$release" "$oldroot" "$backup"
