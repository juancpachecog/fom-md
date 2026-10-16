# Equipo de agentes FOM

Claude (la conversación principal) es el **coordinador**. Debajo trabajan tres
agentes, definidos en `.claude/agents/`:

| Agente | Qué hace | Puede escribir | Herramientas |
|---|---|---|---|
| `fom-desarrollador` | Implementa una tarea | Solo los archivos que se le reservan | Read, Edit, Write, Glob, Grep, Bash |
| `fom-pruebas` | Escribe y corre pruebas, saca capturas | Solo archivos de prueba reservados | Read, Glob, Grep, Bash, Edit, Write |
| `fom-revisor` | Revisa el código cambiado | Nada (solo lectura) | Read, Glob, Grep |

## Flujo de una tarea

1. **El coordinador divide** el pedido en tareas pequeñas, cada una con:
   objetivo, criterio de «hecho», repositorio y **archivos reservados**.
2. **Reserva de archivos**: un archivo pertenece a UNA sola tarea en curso a
   la vez. Antes de lanzar un agente, el coordinador comprueba en el panel que
   ninguno de sus archivos esté reservado por otra tarea abierta. Si dos tareas
   necesitan el mismo archivo, van una detrás de otra, nunca en paralelo.
3. **Desarrollador** implementa → devuelve su informe.
4. **Pruebas** verifica (en paralelo con otras tareas que no compartan
   archivos) → pasa / falla.
5. **Revisor** lee los cambios → aprobada / cambios necesarios.
6. Si falla o hay cambios necesarios, vuelve al desarrollador con los
   hallazgos. Si todo pasa, **solo el coordinador** hace el commit (por ruta,
   nunca `git add -A`) y libera los archivos.

Las tareas que no comparten archivos corren en paralelo (varios
desarrolladores a la vez si hace falta). El revisor puede correr siempre en
paralelo: no escribe.

## Lo que nadie hace (ni el coordinador sin permiso de Marco)

- Desplegar o tocar producción: `fom-prod`, `fom-test`, `ssh` a servidores,
  `gh pr merge`, migraciones, datos reales.
- Publicar la app: `eas submit`, `eas update`, App Store / Play Store.
- Escribir o mostrar contraseñas, tokens o claves.

Compilar una APK de prueba (`eas build --profile preview`) solo cuando Marco lo
pide explícitamente; no es producción, pero sube código a Expo.

## El panel

Cada paso queda en el panel «Equipo FOM» (artifact con base de datos): qué
agente está en qué tarea, qué archivos tiene reservados, y la actividad. Lo
actualiza el coordinador al lanzar, recibir y cerrar cada tarea.
