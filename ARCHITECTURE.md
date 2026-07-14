# RIFATECH — Arquitectura Completa del Sistema SaaS

## Stack Tecnológico Recomendado

```
Frontend          →  Vanilla JS/HTML/CSS (PWA) ó Next.js 14 App Router
Backend API       →  Node.js 20 + Fastify  ó  Python + FastAPI
Base de datos     →  PostgreSQL 15  (schema.sql incluido)
Cache / PubSub    →  Redis 7 (reserva atómica + pub/sub para WebSocket)
WebSocket Server  →  Socket.io ó uWebSockets.js
Job Queue         →  BullMQ sobre Redis
CDN / Static      →  Cloudflare Pages
Object Storage    →  Cloudflare R2 ó AWS S3  (imágenes tickets)
Auth              →  JWT RS256 + Refresh Tokens
Pagos             →  Wompi (Colombia) ó integración manual
```

---

## Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────┐
│                     INTERNET / CDN                      │
│              (Cloudflare Pages + Workers)               │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS / WSS
            ┌────────────▼────────────────┐
            │     API GATEWAY / LB        │
            │  (Nginx / Cloudflare Tunnel)│
            └─────┬───────────────┬───────┘
                  │ REST           │ WebSocket
       ┌──────────▼──────┐  ┌─────▼────────────┐
       │   REST API       │  │  WS SERVER        │
       │  Fastify/Node   │  │  Socket.io        │
       └──────────┬──────┘  └─────┬────────────┘
                  │               │ pub/sub
       ┌──────────▼───────────────▼────────┐
       │           REDIS 7                  │
       │  ● Session cache                  │
       │  ● Reservation locks (SETNX)      │
       │  ● PubSub channels por raffle_id  │
       │  ● BullMQ job queues              │
       └──────────────────┬────────────────┘
                          │
       ┌──────────────────▼────────────────┐
       │         POSTGRESQL 15             │
       │  ● Source of truth                │
       │  ● Atomic row-level locks         │
       │  ● Stored procedures de reserva   │
       │  ● pg_cron para expiración        │
       └───────────────────────────────────┘
```

---

## Flujo de Reserva — Diagrama de Secuencia

```
Usuario A              API Server             Redis              PostgreSQL
   │                       │                    │                     │
   │  POST /reserve        │                    │                     │
   │  {numbers:[7,22]}     │                    │                     │
   │──────────────────────►│                    │                     │
   │                       │  SETNX lock:7      │                     │
   │                       │  SETNX lock:22     │                     │
   │                       │  TTL=30s (safety)  │                     │
   │                       │───────────────────►│                     │
   │                       │  OK / LOCKED       │                     │
   │                       │◄───────────────────│                     │
   │                       │                    │                     │
   │                       │  BEGIN TX          │                     │
   │                       │  CALL reserve_     │                     │
   │                       │  tickets(...)      │                     │
   │                       │  FOR UPDATE        │                     │
   │                       │  SKIP LOCKED       │                     │
   │                       │───────────────────────────────────────►  │
   │                       │                    │  UPDATE tickets     │
   │                       │                    │  status=reserved    │
   │                       │◄───────────────────────────────────────  │
   │                       │  COMMIT            │                     │
   │                       │                    │                     │
   │                       │  PUBLISH           │                     │
   │                       │  raffle:RIFA-X     │                     │
   │                       │  {type:reserved,   │                     │
   │                       │   number:7}        │                     │
   │                       │───────────────────►│                     │
   │                       │                    │                     │
   │  201 {serial, ttl}    │                    │                     │
   │◄──────────────────────│                    │                     │
   │                       │                    │                     │
   │                    Usuario B (mismo raffle, viendo grid en vivo) │
   │                       │  SUBSCRIBE         │                     │
   │                       │  raffle:RIFA-X     │                     │
   │◄──────────── WS event {type:"ticket_reserved", number:7} ───────►│
   │  [número 7 cambia a   │                    │                     │
   │   naranja en su grid] │                    │                     │
```

---

## API REST — Endpoints Clave

### Rifas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/raffles/:id` | Info completa de la rifa |
| GET  | `/api/raffles/:id/tickets` | Estado de todos los números |
| POST | `/api/raffles` | Crear rifa (organizador) |
| PATCH| `/api/raffles/:id` | Actualizar rifa |

### Reservas (Núcleo de Concurrencia)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/raffles/:id/reserve` | Reservar números (atómico) |
| POST | `/api/tickets/:serial/pay` | Confirmar pago |
| GET  | `/api/tickets/validate/:qrToken` | Validar autenticidad QR |

### Request — `POST /reserve`
```json
{
  "numbers":    [7, 22, 45],
  "buyerName":  "Juan Pérez",
  "buyerPhone": "+573001234567",
  "buyerEmail": "juan@email.com"
}
```

### Response 201
```json
{
  "reserved": [
    { "number": 7,  "serialRef": "#REF-2026-X99B", "expiresAt": "2026-07-01T15:30:00Z" },
    { "number": 22, "serialRef": "#REF-2026-M44C", "expiresAt": "2026-07-01T15:30:00Z" }
  ],
  "ttlSeconds": 900,
  "paymentInstructions": "Nequi: 300 123 4567"
}
```

### Response 409 — Conflicto de Concurrencia
```json
{
  "error": "NUMBERS_TAKEN",
  "conflicted": [7],
  "message": "El número 7 fue tomado por otro usuario"
}
```

---

## Estrategia Anti-Duplicados — Capas de Defensa

```
Capa 1 — Frontend:
  ● Botón deshabilitado en status reserved/sold
  ● Actualización optimista + WebSocket sync

Capa 2 — Redis (guardián rápido, ~1ms):
  ● SETNX lock:raffle:{id}:num:{n}  EX 30
  ● Si retorna 0 → otro proceso tiene el lock → 409 inmediato
  ● Evita llegar siquiera a PostgreSQL en concurrencia alta

Capa 3 — PostgreSQL (fuente de verdad):
  ● SELECT ... FOR UPDATE SKIP LOCKED
  ● UNIQUE(raffle_id, number) constraint
  ● Stored procedure reserve_tickets() atómica
  ● Si Capa 2 falla: DB constraint captura el duplicado

Capa 4 — Aplicación:
  ● Retry con backoff exponencial (máx. 2 intentos)
  ● Idempotency key por request
```

---

## Expiración de Reservas — Estrategia Dual

### Mecanismo 1 — BullMQ (preciso, event-driven)
```javascript
// Al crear reserva:
await reservationQueue.add(
  'expire',
  { ticketIds, raffleId },
  { delay: 15 * 60 * 1000, jobId: `expire:${serialRef}` }
);

// Worker:
reservationQueue.process('expire', async (job) => {
  await db.query('SELECT expire_stale_reservations()');
  await redis.publish(`raffle:${raffleId}`, JSON.stringify({
    type: 'ticket_expired',
    numbers: job.data.numbers
  }));
});
```

### Mecanismo 2 — pg_cron (fallback robusto, cada 30s)
```sql
SELECT cron.schedule('expire-reservations', '*/30 * * * * *',
  'SELECT expire_stale_reservations()');
```

---

## WebSocket — Protocolo de Mensajes

### Server → Client
```jsonc
// Alguien reservó un número
{ "type": "ticket_reserved", "number": 7,  "expiresAt": 1751500000000 }

// Pago confirmado
{ "type": "ticket_sold",     "number": 7  }

// Reserva expiró, número libre de nuevo
{ "type": "ticket_expired",  "number": 7  }

// Estado inicial o reconexión (batch sync)
{ "type": "ticket_batch", "tickets": [
    { "number": 1,  "status": "available" },
    { "number": 7,  "status": "reserved", "expiresAt": 1751500000000 },
    { "number": 22, "status": "paid" }
  ]
}
```

---

## Generación de Comprobante Digital

```
html2canvas (v1.4.1)
  └── Renderiza el DOM del componente .ticket
  └── Scale 3x para alta resolución (print quality)
  └── canvas.toDataURL('image/png')
  └── <a download> → guarda en dispositivo

Alternativa server-side (más control):
  Puppeteer / Playwright → screenshot del template HTML
  → Retorna PNG desde /api/tickets/:serial/image
  → Garantiza renderizado idéntico cross-platform
```

---

## Variables de Entorno Requeridas

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/rifatech

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-rs256-private-key
JWT_EXPIRY=15m
REFRESH_EXPIRY=7d

# App
BASE_URL=https://rifatech.co
WS_PORT=3001
API_PORT=3000

# Payments (Wompi Colombia)
WOMPI_PUBLIC_KEY=pub_...
WOMPI_PRIVATE_KEY=prv_...
WOMPI_EVENTS_SECRET=...
```

---

## Checklist de Lanzamiento

- [ ] SSL/TLS en todos los endpoints
- [ ] Rate limiting: 10 req/min por IP en `/reserve`
- [ ] CORS configurado para dominios propios
- [ ] Índice PostgreSQL en `tickets(raffle_id, status)`
- [ ] Redis persistent (AOF habilitado)
- [ ] BullMQ con Redis Sentinel para alta disponibilidad
- [ ] Monitoring: Sentry (errores) + Grafana (métricas WS)
- [ ] Backup automático PostgreSQL (pg_dump diario)
- [ ] CDN headers para assets estáticos (Cache-Control: 1y)
- [ ] PWA manifest.json + Service Worker para offline UX
