# Publicación preparada — 2 de noviembre de 2026

Web y panel al día (commit `9478849`, rama `codex/rediseno-v6-fiel`; armado solo con lo guardado en
ese commit, sin cambios sueltos). Sustituye al paquete `20261029-web` (commit `7167152`), que es el
que está activo hoy. Aun así este paquete **no supone cuál web está activa**: lee la raíz actual de
Nginx, la guarda en `raiz-anterior.txt` del respaldo y vuelve a ella sola si algo falla.

Lo nuevo desde `7167152` (de lo más nuevo a lo más viejo):

- **Clave por defecto fuera del código:** ya no queda escrita en la web ninguna clave por defecto;
  el modo demo usa una clave de ejemplo que no es de ninguna cuenta (9478849).
- **T-210 Cambiar la clave de otras empresas:** el administrador global ya puede restablecer la
  clave de personas de otras empresas (antes daba «no existe»); los errores salen en español llano
  (99b5640).
- **T-209 GPS de todas las empresas:** el administrador FOM verá los GPS de todas las empresas
  (columna y filtro «Empresa», e instalar por la ruta de la empresa del equipo). Funciona en cuanto
  el servidor publique el parche `gps-admin-global`; mientras tanto la pantalla se ve como hoy
  (6a20f6a).
- **IP del receptor en los comandos SMS:** los comandos de configuración que se mandan por SMS al
  equipo GPS ya llevan la IP del receptor. El paquete anterior se armó sin ese dato; este sí lo trae.
- Sin cambio en la web: la auditoría de seguridad (53f8875, solo informe) y los respaldos de la app.

Solo cambia la carpeta de la web en Nginx. No toca la API, la base de datos, certificados ni red.
Si algo falla, restaura la configuración anterior sola y la web que estaba activa sigue igual.

Release nuevo: `/var/www/fom-web/releases/20261102-web` (no debe existir antes de activar).
Índice nuevo: `/assets/index-Dx5qanQ2.js` (el del paquete anterior era `index-CfcWzyiA.js`).
Pruebas: `npm test` 419 de 419 en verde antes de armar. Revisado en la carpeta `dist`: no aparece
la clave de demo antigua y sí aparece la IP del receptor.

Aviso sobre Nginx (sigue pendiente de Juan): este paquete incluye `/modelos/` y `/ort/` (el quitador
de fondo). Nginx debe servirlos como archivos normales (`.mjs` como JavaScript, `.wasm` como
`application/wasm`). Al activar, el script lo comprueba y, si algo no cuadra, **solo avisa**
(`FOM_WEB=AVISO`) y deja la web publicada; ese caso se lo pasamos a Juan.

## Subir (desde la carpeta de fom, en Windows, con la VPN encendida)

```
tar -cf ops/deploy-20261102-web.tar -C ops deploy-20261102-web
ssh -i infra\fom-app fomadmin@10.20.30.10 "mkdir /home/fomadmin/subida-20261102"
scp -i infra\fom-app ops/deploy-20261102-web.tar fomadmin@10.20.30.10:/home/fomadmin/subida-20261102/
ssh -i infra\fom-app fomadmin@10.20.30.10 "cd /home/fomadmin/subida-20261102 && sha256sum deploy-20261102-web.tar && tar -xf deploy-20261102-web.tar && cd deploy-20261102-web && sha256sum --quiet -c SHA256SUMS && echo PAQUETE_OK"
```

(El `.tar` ya está armado en `ops/deploy-20261102-web.tar`; si existe, sáltate la primera línea.)

## Activar (pide la clave de sudo)

```
ssh -t -i infra\fom-app fomadmin@10.20.30.10 "sudo bash /home/fomadmin/subida-20261102/deploy-20261102-web/activate-publication.sh"
```

Debe terminar con `FOM_WEB_PUBLISHED`. Si sale `FOM_WEB=FAIL`, la web anterior queda activa.
Después: https://15.204.105.201/ (puerto 443, el normal de HTTPS) y recargar con Ctrl+F5.

## Volver atrás

Respaldo en `/var/backups/fom-web/20261102-web-*` (incluye `raiz-anterior.txt`, con la carpeta de la
web que estaba activa antes). Copiar ese `fom-mobile.conf` sobre la configuración y recargar Nginx
(en PowerShell; pide la clave de sudo):

```
ssh -t -i infra\fom-app fomadmin@10.20.30.10 'b=$(sudo find /var/backups/fom-web -maxdepth 1 -name 20261102-web-\* | sort | tail -1) && sudo cat $b/raiz-anterior.txt && sudo cp -a $b/fom-mobile.conf /etc/nginx/sites-available/fom-mobile.conf && sudo nginx -t && sudo systemctl reload nginx && echo VUELTA_OK'
```

Debe mostrar la carpeta anterior y terminar con `VUELTA_OK`.
