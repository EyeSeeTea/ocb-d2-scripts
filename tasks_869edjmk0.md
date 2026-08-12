# [869edjmk0] [52] Align Option Code format

## Metadatos

- Tipo: feature
- ClickUp: https://app.clickup.com/t/869edjmk0
- Estado: requiere cambios

## Solicitud

Cuando el script cambia el `code` de un option, DHIS2 deja referencias al code anterior en otros
objetos de metadata. Hoy `D2RenameOptionCode` recodifica el option, los `dataValues` y los `events`,
pero no los `programIndicators` ni los `programRules`. El resultado es que un programIndicator con
`filter` `#{gqLxLWF3rFi.BFJO2Lwn64g} == '[F-HI]'` sigue apuntando a un code que ya no existe.

Se pide cerrar ese hueco replicando exactamente el patrón con el que ya se tratan `dataValues` y
`events`, incluido el backup a disco y el rollback.

Fuera de alcance de este documento: la regla de eliminación de corchetes en el code, pendiente de
confirmación de Adrián sobre dos puntos (si el code se deriva del prefijo entre corchetes del nombre
o solo pierde los corchetes, y si el formato destino admite `-`, hoy prohibido por
`OptionSetValidator.CODE_INVALID_CHAR`).

## Análisis

### Lo que ya existe

`D2RenameOptionCode` (`src/data/D2RenameOptionCode.ts`) implementa el renombrado completo. Su
docstring fija el orden obligatorio de acciones: obtener los datos, actualizar el metadata del
option, actualizar los datos y, si algo falla, hacer rollback. El backup a disco se escribe siempre,
antes de tocar nada, por si el rollback tampoco pudiera ejecutarse.

Cada colección de datos sigue el mismo patrón de cuatro piezas:

| pieza                | dataValues                   | events                  | responsabilidad                                    |
| -------------------- | ---------------------------- | ----------------------- | -------------------------------------------------- |
| lectura previa       | `getDataValues` (`:140`)     | `getEvents` (`:204`)    | filtra lo que referencia `option.code`              |
| estado inicial       | `initialDataValues`          | `initialEvents`         | campo de `OptionsWithMetadataValues` (`:307`)       |
| cálculo del recodeo  | `recodeDataValuesGet` (`:179`) | `recodeEventsGet` (`:243`) | devuelve la versión actualizada, sin postear      |
| escritura            | `postDataValues` (`:189`)    | `postEvents` (`:260`)   | corta en `dryRun` y en colección vacía              |

Las cuatro se coordinan en `execute` (`:33`) y `recodeOption` (`:64`): se lee todo primero, se
escribe el backup con `saveDataToDisk` (`:288`), se guarda el option y solo después se postean los
datos. `rollback` (`:276`) restaura el code original del option y vuelve a postear los `initial*`.

### Lo que falta

`metadataQuery` (`:320`) pide `options`, `dataElements`, `trackedEntityAttributes` y
`organisationUnits`. Ni `programIndicators`, ni `programRules`, ni `programRuleActions` aparecen en
el repositorio. Los TODO declarados en el docstring (`:26-27`) son otros: attribute values y tracked
entity attributes.

### Dónde vive el code dentro de esos objetos

En DHIS2 el code de un option se usa como literal entrecomillado dentro de expresiones. Campos
afectados, según el esquema de `@eyeseetea/d2-api` 2.40:

| modelo               | campos con expresiones      |
| -------------------- | --------------------------- |
| `programIndicators`  | `expression`, `filter`      |
| `programRules`       | `condition`                 |
| `programRuleActions` | `data`, `content`           |

`programRuleActions` referencia además un option por id (`option`, `optionGroup`, usados por
`HIDEOPTION` y `SHOWOPTIONGROUP`). Esas referencias son por uid y no se ven afectadas por un cambio
de code: no hay que tocarlas.

`content` es el texto que se muestra al usuario (`SHOWWARNING`, `DISPLAYTEXT`). No es una referencia
funcional, pero cita el code entre comillas, así que dejarlo sin recodear produce mensajes que
nombran un code inexistente. Se recodea igual que `data`.

### Fuente de datos y evidencia

Instancia local DHIS2 2.42.2 (`http://DESKTOP-I6DTCCV.local:8080`), consultada mediante
`/api/programIndicators`, `/api/programRules` y `/api/programRuleActions`. Ya contiene metadata de
prueba que reproduce la configuración de OCA. OptionSets implicados:

| optionSet       | uid           | options (code)                                    |
| --------------- | ------------- | -------------------------------------------------- |
| `Diagnosis list` | `gvtMgzCuqoP` | `O-MEN`, `TOP`, `10`                               |
| `Symptom list`   | `w7hAW6T2PIn` | `[F-HI]`, `[23]`, `CH` (control sin corchetes)     |

Referencias existentes a esos codes (salida real de la consulta):

```
programIndicators
  Ptb5WPyuhqB  ZZTEST PI meningitis       filter: #{gqLxLWF3rFi.BFJO2Lwn64g} == 'O-MEN'
  BPyBdPwynmy  ZZTEST PI multiple codes   filter: ... == 'O-MEN' || ... == '10' || ... == '_CS_CAESAREAN_SECTION_MAT'
  b1wIKCJxf2q  ZZTEST2 PI fever           filter: #{Aru6nsPyeII.kXTOZs35KB3} == '[F-HI]'
  EpRNdu03Lb2  ZZTEST2 PI multiple codes  filter: ... == '[F-HI]' || ... == '[23]' || ... == '[IN]'
programRules
  YYAn2dCBUOA  ZZTEST PR meningitis       condition: #{zztest_diag} == 'O-MEN'
  Nndf04uDsdc  ZZTEST2 PR fever           condition: #{zztest2_symptom} == '[F-HI]'
programRuleActions
  jdp9Js9Z9Eg  DISPLAYTEXT                data: 'O-MEN'   content: Diagnosis is 'O-MEN'
  EeAK4zSJ4WT  SHOWWARNING                content: Outbreak code 'O-MEN' detected
```

Hay además controles que no deben cambiar: `dWz9xYRB59b` (`== 'TOP'`), `qiuaZSVRXiW`
(`== 'SEVERE'`) y el propio `_CS_CAESAREAN_SECTION_MAT` dentro del PI de códigos múltiples.

### Riesgos

1. **Reemplazo por substring.** Hay codes de uno o dos caracteres (`CH`, `10`, `IN`) que aparecen
   dentro de otros tokens y de otros codes. El reemplazo debe limitarse al literal entrecomillado
   (`'CODE'` o `"CODE"`) y escapar los metacaracteres de regex, porque los codes traen `[`, `]` y `-`.
2. **Post parcial.** `api.metadata.post` reemplaza el objeto entero. Hay que leer con `$owner` y
   postear el objeto completo con el campo recodeado, no un payload con cuatro campos, o se borraría
   el resto del objeto. Aplica igual al json de backup: debe servir para re-postear a mano.
3. **Varias referencias en un mismo objeto.** `BPyBdPwynmy` y `EpRNdu03Lb2` citan tres codes cada uno.
   Como cada option se recodea en una invocación distinta de `D2RenameOptionCode`, y cada invocación
   vuelve a leer el objeto de la API, los cambios se acumulan correctamente. Es el mismo motivo por
   el que la lectura no se cachea entre options: una caché compartida sin refrescar haría que el
   último recodeo pisara a los anteriores.
4. **Coste de lectura.** `D2RenameOptionCode` se instancia una vez por option
   (`OptionD2Repository.save:36`), así que las tres colecciones se leen una vez por option renombrado.
   Es exactamente el mismo coste que ya asumen `getDataValues` y `getEvents`, y la contrapartida es
   la corrección del punto 3.
5. **Rollback parcial.** Si falla el post de programIndicators después de haber guardado el option,
   el rollback restaura code, dataValues, events y las tres colecciones a su versión original. Si el
   propio rollback falla, quedan los json en disco, que es el comportamiento preexistente.

## Decisión

Requiere cambios. El recodeo de `programIndicators`, `programRules` y `programRuleActions` no existe
ni está contemplado en `metadataQuery`. Se implementa entero en la capa de datos, dentro de
`D2RenameOptionCode`, como una colección más junto a `dataValues` y `events`: es un detalle de cómo
DHIS2 materializa el renombrado de un code, no una regla de negocio. Ni el dominio ni la capa de
presentación se enteran, así que no se define ningún repositorio ni se toca `analyze.ts`.

## Plan de tareas

### 1. Capa de datos: lógica pura de reemplazo

1. Crear `src/data/optionCodeReferences.ts` con las funciones puras:
   - `replaceCodeInExpression(expression, fromCode, toCode)`: reemplaza solo literales entrecomillados
     (`'CODE'` y `"CODE"`), escapando los metacaracteres de regex del code.
   - `recodeFields(object, fields, fromCode, toCode)`: devuelve una copia del objeto con esos campos
     de texto recodeados, dejando intactos el resto (necesario para postear el objeto `$owner`
     completo).
   - `getObjectsToRecode(objects, fields, fromCode, toCode)`: devuelve `{ original, updated }` con el
     subconjunto que realmente cambia.
2. Tests en `src/data/__tests__/optionCodeReferences.spec.ts`: code con corchetes (`[F-HI]`), code con
   guion (`O-MEN`), code de dos caracteres que aparece como substring de otro token (`CH` en
   `'CHOLERA'`), comillas dobles, code no presente, y objeto con campos ajenos que deben sobrevivir
   al recodeo.

### 2. Capa de datos: integración en D2RenameOptionCode

3. Añadir `programIndicators`, `programRules` y `programRuleActions` a `metadataQuery` con
   `fields: { $owner: true }`.
4. Añadir `getProgramMetadata`, que lee las tres colecciones y devuelve solo los objetos que
   referencian `option.code`, en paralelo a `getDataValues` y `getEvents`.
5. Añadir `initialProgramMetadata` a `OptionsWithMetadataValues` y poblarlo en
   `getOptionsWithMetadata`.
6. Añadir `recodeProgramMetadataGet`, que calcula la versión actualizada sin postear, en paralelo a
   `recodeDataValuesGet` y `recodeEventsGet`.
7. Añadir `postProgramMetadata`, con los mismos cortes que `postDataValues`: `dryRun` y colección
   vacía. Postea las tres colecciones en un único `api.metadata.post` y falla si el status no es `OK`.
8. Encadenar en `recodeOption`: leer antes de `saveOption`, postear después, respetando el orden del
   docstring.
9. Extender `saveDataToDisk` para escribir `programMetadata_${option.id}.json` con las tres
   colecciones completas en forma de payload de metadata re-posteable.
10. Extender `rollback` para volver a postear `initialProgramMetadata`.
11. Actualizar el docstring de la clase: añadir la línea de programIndicators / programRules /
    programRuleActions a la lista de tareas, junto a las de dataValues y events.

### 3. Verificación en la instancia local

12. Ejecutar el recodeo con `dryRun: true` contra `http://DESKTOP-I6DTCCV.local:8080` para el option
    `OcVXNBtpRiW` (`[F-HI]`) y comprobar en el log que detecta `b1wIKCJxf2q`, `EpRNdu03Lb2`,
    `Nndf04uDsdc` y sus programRuleActions, y que no toca los controles.
13. Ejecutar el recodeo real sobre ese mismo option y verificar contra la API: code del option
    actualizado, los tres campos de expresión recodeados, el PI de códigos múltiples con los otros dos
    codes intactos, los controles sin cambios y el json de backup en disco con los objetos completos.
14. Restaurar el estado inicial de la instancia al terminar la verificación.

### 4. Documentación

15. Actualizar el `README.md` indicando que el renombrado de un option code arrastra también las
    referencias en programIndicators, programRules y programRuleActions, y que se genera un backup en
    disco de esos objetos.

## Supuestos

- El alcance es solo el recodeo de referencias. La regla que decide el nuevo code queda pendiente de
  la respuesta de Adrián y no se implementa aquí.
- Se recodea `content` de `programRuleActions` además de `data`, porque cita el code en un mensaje
  visible para el usuario.
- Las referencias por uid (`programRuleActions.option`, `optionGroup`) no se tocan.
- Solo se reemplazan literales entrecomillados. Un code citado sin comillas dentro de una expresión no
  es sintaxis válida de DHIS2 y no se contempla.
- La verificación se hace en la instancia local desechable, nunca contra OCB ni OCA.
