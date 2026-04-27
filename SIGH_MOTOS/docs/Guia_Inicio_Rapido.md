# Guía de Inicio Rápido — SIGC-Motos v2.0
**Clavijos Motos S.A.S. | Software de Gestión Integral**
*Desarrollado por Quanta Cloud*

---

## 1. Conexión de Hardware

### 1.1 Escáner de Código de Barras (USB HID)

El escáner USB funciona en modo **teclado HID** (Human Interface Device). No requiere ningún controlador ni software adicional.

**Pasos para conectar:**
1. Conecta el escáner al puerto USB del computador.
2. El sistema operativo lo reconocerá automáticamente en 5-10 segundos.
3. Abre el módulo **Punto de Venta** en el sistema.
4. Haz clic en el campo de búsqueda o presiona **F1** para activarlo.
5. Escanea cualquier producto — el código debe aparecer automáticamente.

**Solución si el escáner no escribe:**
- Verifica que el cursor esté posicionado dentro del campo de búsqueda.
- Prueba en otro puerto USB del computador.
- Si el escáner emite "bips" pero no escribe, puede estar en modo RS-232 en lugar de HID. Consulta el manual del escáner para cambiar a modo "USB HID" escaneando el código de configuración correspondiente.

---

### 1.2 Impresora Térmica de 80mm (Chrome / Edge)

La impresión del ticket se realiza directamente desde el navegador. Sigue estos pasos para configurarla correctamente:

**Configuración en Chrome (recomendado):**
1. Con el ticket en pantalla, presiona **Ctrl + P** o haz clic en "Imprimir Ticket".
2. En el cuadro de diálogo de impresión:
   - **Destino:** Selecciona tu impresora térmica (generalmente aparece como "POS-58", "POS-80", "Epson TM-T20" o similar).
   - **Más configuraciones → Márgenes:** Selecciona **Ninguno**.
   - **Más configuraciones → Escala:** Selecciona **Personalizada** y escribe **72** (para 80mm exacto).
   - **Más configuraciones → Cabeceras y pies de página:** **Desactivar**.
3. Haz clic en **Imprimir**.

**Tip:** La primera vez que configures la impresora, guarda la configuración como predeterminada en Chrome para no tener que repetirla.

---

## 2. Primeros Pasos en el Sistema

### 2.1 Configuración Inicial del Negocio

Antes de operar, configura los datos de la empresa:

1. Ve a **Ajustes** en el menú lateral.
2. Completa todos los campos:
   - Nombre del Negocio
   - NIT
   - Dirección y Teléfono
   - Mensaje del pie del ticket
3. Haz clic en **Guardar Cambios**.

Estos datos aparecerán en todos los tickets y reportes.

---

### 2.2 Crear Marcas y Categorías

Antes de agregar productos, debes tener marcas y categorías creadas:

1. Ve a **Clasificaciones** en el menú lateral.
2. En la pestaña **Marcas**, crea las marcas que manejas: Honda, Yamaha, AKT, Bajaj, etc.
3. En la pestaña **Categorías**, crea las categorías: Motor, Frenos, Eléctrico, Transmisión, etc.
   - **Prefijo de SKU:** Es un código corto (ej: "FREN" para Frenos) que se usa para generar SKUs automáticos.
   - **Margen %:** El porcentaje de ganancia por defecto para esa categoría.

---

### 2.3 Crear el Primer Producto

1. Ve a **Inventario** → Haz clic en **Nuevo Producto**.
2. Completa el formulario:
   - **Nombre Comercial:** Nombre como lo buscaría el cliente (ej: "Pastilla de Freno Delantera Honda CB125")
   - **Marca / Categoría:** Selecciona las que creaste en el paso anterior.
   - **SKU:** Se genera automáticamente, o puedes escribir uno personalizado.
   - **Código de Barras:** Escanea el código del producto para registrarlo.
   - **Precio de Costo y Precio de Venta:** En pesos colombianos (COP).
   - **Stock Inicial:** Cantidad disponible en bodega.
   - **Stock Mínimo:** Cuándo el sistema te debe alertar para reordenar.
3. Haz clic en **Crear Producto**.

---

### 2.4 Realizar la Primera Venta

1. Ve a **Punto de Venta**.
2. Escanea el código de barras del producto con el escáner (o escríbelo en el campo de búsqueda).
3. El producto aparece en el carrito. Puedes ajustar la cantidad manualmente.
4. Si el cliente paga con un método específico, selecciónalo en **Forma de Pago**.
5. Presiona **F2** o haz clic en **Finalizar Venta**.
6. Aparecerá la pantalla de éxito con el número de ticket.
7. Haz clic en **Ticket Térmico** → **Imprimir Ticket** para imprimir.

---

### 2.5 Cierre de Caja Diario

Al final de cada turno:

1. Ve a **Tesorería**.
2. Verifica el saldo de la caja (el sistema calcula cuánto debería haber en efectivo).
3. Cuenta el efectivo físico e ingresa el valor.
4. Haz clic en **Cerrar Caja**.
5. El sistema registra la diferencia (sobrante o faltante) para control interno.

---

## 3. Solución de Problemas Comunes

### El escáner emite bip pero el código no aparece en pantalla
- Verifica que el cursor esté dentro del campo de búsqueda del POS.
- Presiona **F1** para enfocar el campo automáticamente.
- El escáner debe enviar "Enter" después del código. Si no lo hace, configúralo con el código de "Suffix Enter" del manual del fabricante.

---

### El ticket sale cortado o con texto ilegible
- Abre la configuración de impresión (Ctrl+P) y verifica que la escala sea correcta (72% para 80mm).
- Asegúrate de que los márgenes estén en **Ninguno**.
- Si usas Edge en lugar de Chrome, el proceso es idéntico.

---

### El sistema muestra "Sin stock disponible"
- El producto que estás intentando vender tiene 0 unidades en inventario.
- Ve a **Inventario** → busca el producto → haz clic en **Ajustar Stock** para ingresar más unidades.

---

### Olvidé mi contraseña
- Contacta al **Administrador** del sistema.
- El administrador puede resetear la contraseña desde **Seguridad** → pestaña **Usuarios** → icono de llave junto al usuario.

---

### El sistema no carga (pantalla en blanco)
- Verifica que el servidor esté encendido y conectado a la red local.
- Intenta recargar la página con **Ctrl + F5**.
- Si el problema persiste, contacta al equipo de soporte de Quanta Cloud.

---

## 4. Contacto y Soporte

**Desarrollado y mantenido por:**
**Quanta Cloud** — Soluciones Tecnológicas Empresariales

- Email: soporte@quantacloud.co
- Sistema: SIGC-Motos v2.0
- Documentación técnica disponible en el repositorio del proyecto.

---

*© 2026 Quanta Cloud. La propiedad intelectual de este software pertenece al proveedor según contrato. Uso autorizado exclusivamente para Clavijos Motos S.A.S.*
