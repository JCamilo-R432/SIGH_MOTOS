# SIGC-Motos Frontend

Interfaz web del Sistema Integral de Gestión Comercial para **Clavijos Motos S.A.S.** (Aguachica, Cesar).

## Stack Tecnológico

| Tecnología | Versión | Uso |
|---|---|---|
| React | 18 | UI Framework |
| TypeScript | 5.6 | Tipado |
| Vite | 5.4 | Build tool |
| Tailwind CSS | 3.4 | Estilos |
| React Router | v6 | Enrutamiento |
| Zustand | 5 | Estado global |
| Axios | 1.7 | HTTP Client |
| React Hook Form | 7 | Formularios |
| Zod | 3 | Validación |
| Recharts | 2 | Gráficas |
| Sonner | 1.5 | Toast notifications |
| ExcelJS | 4.4 | Exportación Excel |
| jsPDF | 2.5 | Generación PDF |
| qrcode.react | 4 | Códigos QR |
| Lucide React | 0.454 | Íconos |

## Estructura del Proyecto

```
frontend/
├── src/
│   ├── assets/           # Logo, imágenes estáticas
│   ├── components/
│   │   ├── layout/       # Layout, Sidebar, Topbar
│   │   └── ui/           # Componentes reutilizables
│   ├── pages/            # Páginas principales
│   ├── services/         # Clientes Axios por módulo
│   ├── store/            # Zustand stores
│   ├── types/            # TypeScript interfaces
│   └── utils/            # Helpers, formateadores, PDF, Excel
├── .env.example
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── index.html
```

## Módulos Implementados

| Ruta | Módulo | Roles |
|---|---|---|
| `/login` | Autenticación JWT | Público |
| `/dashboard` | Dashboard con KPIs y gráficas | ADMIN |
| `/inventory` | CRUD productos, ajuste de stock | ADMIN, WAREHOUSE |
| `/pos` | Punto de venta con escáner | ADMIN, SELLER |
| `/invoices` | Facturas, QR, PDF, DIAN | ADMIN, SELLER |
| `/purchases` | Órdenes de compra, proveedores | ADMIN, WAREHOUSE |
| `/treasury` | Caja, gastos, arqueo, cierre | ADMIN |
| `/reports` | ABC, valorización, rotación, rentabilidad | ADMIN |
| `/security` | Usuarios, roles, auditoría | ADMIN |

## Instalación y Uso Local

### Prerequisitos
- Node.js 20+
- npm 10+

### Setup

```bash
# 1. Ir al directorio frontend
cd frontend

# 2. Instalar dependencias
npm install

# 3. Crear archivo de entorno
cp .env.example .env.local
# Editar VITE_API_URL con la URL del backend

# 4. Iniciar en desarrollo
npm run dev
# Abre http://localhost:5173
```

### Variables de Entorno

```env
VITE_API_URL=https://motos.quantacloud.com/api/v1
VITE_APP_NAME=SIGC-Motos
VITE_APP_VERSION=1.0.0
```

### Build para Producción

```bash
npm run build
# Los archivos estáticos quedan en dist/
```

## Despliegue con Nginx

### Opción 1: Mismo dominio con proxy_pass (recomendado)

Agregar al bloque server de Nginx:

```nginx
# Servir el frontend
location / {
    root /var/www/sigc-frontend/dist;
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
}

# Los archivos compilados son inmutables — caché agresiva
location /assets/ {
    root /var/www/sigc-frontend/dist;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

### Opción 2: Subdominio app.motos.quantacloud.com

```nginx
server {
    listen 443 ssl http2;
    server_name app.motos.quantacloud.com;

    ssl_certificate     /etc/letsencrypt/live/motos.quantacloud.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/motos.quantacloud.com/privkey.pem;

    root /var/www/sigc-frontend/dist;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Desplegar build

```bash
npm run build
scp -r dist/* user@servidor:/var/www/sigc-frontend/dist/
```

## Credenciales de Prueba

| Rol | Email | Contraseña |
|---|---|---|
| Admin | admin@clavijosmotos.com | Admin123! |

## Atajos de Teclado (POS)

| Tecla | Acción |
|---|---|
| F1 | Foco en búsqueda de producto |
| F2 | Finalizar venta |
| ESC | Limpiar búsqueda |

## Colores Corporativos

| Color | Hex | Uso |
|---|---|---|
| Azul Oscuro | `#1e3a8a` | Sidebar, header, botones secundarios |
| Naranja | `#f97316` | Botones primarios, accentos |
| Blanco | `#ffffff` | Fondos de tarjetas |

## Arquitectura

- **Estado global**: Zustand con persistencia en localStorage para autenticación
- **HTTP**: Axios con interceptores para JWT y manejo de errores 401/403/500
- **Rutas**: React Router v6 con lazy loading y rutas protegidas por rol
- **Formularios**: React Hook Form + Zod para validación tipada
- **Notificaciones**: Sonner (toast) con soporte para éxito/error/advertencia
- **PDF**: jsPDF + jspdf-autotable para facturas y reportes de caja
- **Excel**: ExcelJS para exportación con estilos corporativos
