# RIFATECH — Plataforma de Rifas Digitales

## Estructura del repositorio

```
rifatech/
├── index.html              ← Vista del comprador (pública)
├── organizador.html        ← Panel del organizador (privado)
├── styles.css              ← Estilos del comprador
├── app.js                  ← Lógica del comprador
├── schema.sql              ← Schema PostgreSQL para Supabase
├── ARCHITECTURE.md         ← Documentación técnica completa
├── README.md               ← Este archivo
│
└── .github/
    └── workflows/
        ├── deploy.yml          ← Deploy automático a GitHub Pages
        ├── validate-pr.yml     ← Validación de Pull Requests
        ├── supabase-sync.yml   ← Sincronizar schema con Supabase
        └── backup.yml          ← Backup semanal automático
```

## Deploy en GitHub Pages

1. Fork o clona este repositorio
2. Ve a **Settings → Pages**
3. Source: **GitHub Actions**
4. Cada push a `main` despliega automáticamente

**URLs resultantes:**
- Comprador: `https://tuusuario.github.io/rifatech/`
- Organizador: `https://tuusuario.github.io/rifatech/organizador.html`

## Variables de entorno (Secrets)

Configura en **Settings → Secrets and variables → Actions**:

| Secret | Descripción | Requerido para |
|--------|-------------|----------------|
| `SUPABASE_URL` | URL del proyecto Supabase | Backend real |
| `SUPABASE_ANON_KEY` | Clave pública de Supabase | Backend real |
| `SUPABASE_ACCESS_TOKEN` | Token de acceso Supabase CLI | Workflows de DB |
| `SUPABASE_PROJECT_ID` | ID del proyecto Supabase | Workflows de DB |
| `SUPABASE_DB_PASSWORD` | Contraseña de la DB | Backup |

> Sin estos secrets, el sitio funciona en **modo demo** con localStorage.

## Workflows

| Workflow | Cuándo corre | Qué hace |
|----------|-------------|----------|
| `deploy.yml` | Push a `main` | Publica en GitHub Pages |
| `validate-pr.yml` | Pull Request a `main` | Valida HTML y JS |
| `supabase-sync.yml` | Cambia `schema.sql` | Aplica migraciones a la DB |
| `backup.yml` | Domingos 2 AM | Exporta y guarda backup |

## Stack

- **Frontend**: HTML + CSS + JS vanilla (PWA-ready)
- **Base de datos**: PostgreSQL via Supabase
- **Hosting**: GitHub Pages (gratis)
- **CI/CD**: GitHub Actions

## Modo demo vs producción

El sistema funciona en dos modos:

**Demo (sin backend):**
- Datos guardados en `localStorage`
- WebSocket simulado
- No persiste entre sesiones
- Perfecto para mostrar a clientes

**Producción (con Supabase):**
- PostgreSQL con transacciones atómicas
- WebSocket real via Supabase Realtime
- Reservas con expiración automática
- Configura los secrets y conecta
