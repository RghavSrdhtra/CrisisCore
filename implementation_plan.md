# CrisisCore — Minor Project Implementation Plan

## Current State Assessment

**What exists now** (the "hackathon prototype"):

| Asset | Status | Reusable? |
|---|---|---|
| [index.html](file:///d:/projects/NexCommand/index.html) | Vite SPA, static HTML dashboard | Partial — layout/structure is a good base for the coordinator dashboard (Week 3) |
| [src/main.js](file:///d:/projects/NexCommand/src/main.js) | Hardcoded incident simulation, Leaflet map, mock resources | Limited — simulation logic gets replaced by real backend data |
| [src/style.css](file:///d:/projects/NexCommand/src/style.css) | De-slopped dark theme, decent component styles | Reusable — extend, don't rewrite |
| [api/gemini.js](file:///d:/projects/NexCommand/api/gemini.js) | Vercel Edge serverless function for Gemini | Keep — used for AI brief feature, could power ML classification fallback |
| [package.json](file:///d:/projects/NexCommand/package.json) | Vite only, no backend deps | Needs overhaul — add Express, Socket.IO, DB driver, etc. |

**What needs to be built** (the actual system per the project document):
- Backend server with REST API + WebSocket
- Database (incidents, responders, resources)
- SOS submission interface (civilian-facing)
- Coordinator dashboard (evolution of current UI)
- ML classification pipeline (Python)
- Hungarian Algorithm / ILP allocation module (Python)
- Multi-agent re-routing logic
- Privacy/security layer

---

## User Privilege Levels & Role-Based Access Control (RBAC)

Per Sections 4.1, 4.7, 4.8, and 4.11 of the project specification ([project_1788935466.pdf](file:///d:/projects/NexCommand/project_1788935466.pdf)), the system requires a multi-tier privilege model with privacy-aware access boundaries:

| Role | Primary Interface | Allowed Actions & Capabilities | Access & Privacy Restrictions |
|---|---|---|---|
| **Civilian** (`CIVILIAN`) | SOS Interface (`client/sos.html`) | • Submit SOS requests (type, casualties, description, contact)<br>• Voluntary GPS location sharing (device GPS or manual pin drop)<br>• View own active incident status & response progress<br>• Voluntary location toggle (can stop sharing or cancel SOS) | • Strictly isolated to own incident data<br>• Cannot see other civilians' requests or locations<br>• Cannot view tactical coordinator map or responder movements<br>• Location sharing auto-terminates upon incident resolution |
| **Field Responder** (`RESPONDER`) | Responder Interface (`client/responder.html`) | • Receive assignment notifications (type, coordinates, priority, notes)<br>• Update operational lifecycle: `Available` → `Assigned` → `En Route` → `On Scene` → `Operation Completed` → `Available`<br>• Transmit responder GPS telemetry while on duty<br>• Request additional backup / resources if capacity is insufficient | • Can only view incidents assigned to their unit<br>• Cannot view non-assigned civilian private details<br>• Cannot modify global dispatch allocations or other units |
| **Emergency Coordinator** (`COORDINATOR`) | Central Coordinator Dashboard (`client/index.html`) | • Full tactical situational awareness: real-time incident map & feed<br>• Review ML-predicted priority (Low/Med/High/Critical + confidence)<br>• Review optimization-recommended assignments (Hungarian/ILP)<br>• Human-in-the-loop dispatch authority (approve/override/manual dispatch)<br>• Dynamic re-routing supervision on responder disruptions<br>• Monitor rescue progression & mark incidents resolved | • Full operational view within jurisdiction<br>• Cannot bypass audit logging on dispatch overrides<br>• Subject to role-based token verification on all mutation endpoints |
| **System Administrator** (`ADMIN`) | Admin / Settings Console | • Manage user accounts, responder fleet registration, agency types<br>• Enforce data retention & privacy policies (48h location log purge)<br>• Export anonymized datasets for ML retraining (Section 4.11)<br>• Monitor system health, WebSocket connections, and audit trails | • Full administrative oversight; operational actions strictly logged |

### Privacy & Data Minimization Rules (Section 4.11)
1. **Voluntary Location Sharing:** Location data is shared only with explicit user permission or manual pin selection.
2. **Lifecycle-Bound Tracking:** Location streaming terminates immediately once an incident reaches `RESOLVED` or `CANCELLED`.
3. **Data Retention Policy:** Precise location breadcrumbs in `LocationLog` are purged or coarsened after 48 hours.
4. **Anonymized ML Datasets:** Training pipelines consume stripped incident attributes without reporter PII or precise coordinates.

---

## Architecture Decision: Monorepo Structure

```
NexCommand/
├── client/                    # Vite frontend (migrated from current root)
│   ├── index.html             # Coordinator dashboard
│   ├── sos.html               # Civilian SOS interface
│   ├── responder.html         # Field responder interface
│   ├── src/
│   │   ├── style.css          # Shared design system
│   │   ├── dashboard.js       # Coordinator dashboard logic
│   │   ├── sos.js             # Civilian SOS logic
│   │   └── responder.js       # Field responder logic
│   └── package.json
├── server/                    # Node.js + Express + Socket.IO + Prisma
│   ├── prisma/
│   │   ├── schema.prisma      # RBAC-enabled data models
│   │   └── seed.js            # Seed users (all roles), responders, mock incidents
│   ├── src/
│   │   ├── index.js           # Express + HTTP + Socket.IO server
│   │   ├── routes/            # REST endpoints (auth, incidents, responders, assignments)
│   │   ├── ws/                # WebSocket namespaces & RBAC rooms
│   │   ├── middleware/        # JWT auth & RBAC permission checks
│   │   └── config/            # DB client & environment configuration
│   └── package.json
├── ml/                        # Python ML + optimization service
│   ├── data/                  # Anonymized training data
│   ├── models/                # Trained artifacts
│   ├── train.py               # Priority prediction training pipeline
│   ├── predict.py             # FastAPI/Flask inference server
│   ├── allocate.py            # Hungarian algorithm + ILP allocation
│   └── requirements.txt
├── api/                       # Existing Vercel serverless functions
├── graphify-out/              # Knowledge graph
└── package.json               # Monorepo root workspace
```

---

## Week-by-Week Plan

### Week 1 — System Architecture, RBAC & Database Schema

> [!IMPORTANT]
> This is the most critical week. Bad schema decisions cascade into every later week.

**Goal:** Finalize the technical architecture, establish the monorepo structure, define full RBAC models and database schema, and have a working database with seed data for all privilege levels.

**Tasks:**

1. **Database & ORM Selection:**
   - PostgreSQL (production) with SQLite support for frictionless local development via Prisma ORM.
   - Prisma provides type safety, automatic migrations, and declarative relation modeling.

2. **Define RBAC Schema (`server/prisma/schema.prisma`):**
   - **Enums:**
     - `Role`: `CIVILIAN`, `COORDINATOR`, `RESPONDER`, `ADMIN`
     - `IncidentType`: `MEDICAL`, `FIRE`, `SECURITY`, `NATURAL_DISASTER`, `INDUSTRIAL`, `OTHER`
     - `PriorityLevel`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
     - `IncidentStatus`: `REPORTED`, `TRIAGED`, `DISPATCHED`, `ON_SCENE`, `RESOLVED`, `CANCELLED`
     - `ResponderType`: `FIRE_RESCUE`, `MEDICAL_AMBULANCE`, `POLICE_SECURITY`, `DISASTER_PERSONNEL`, `SPECIALIZED_EQUIPMENT`
     - `ResponderStatus`: `AVAILABLE`, `ASSIGNED`, `EN_ROUTE`, `ON_SCENE`, `UNAVAILABLE`
     - `AssignmentStatus`: `RECOMMENDED`, `DISPATCHED`, `ACKNOWLEDGED`, `EN_ROUTE`, `ON_SCENE`, `COMPLETED`, `CANCELLED`
   - **Models:**
     - `User`: id, email, passwordHash, role, name, phone, agency, createdAt, updatedAt
     - `Incident`: id, type, description, affectedCount, severity, predictedPriority, manualPriority, priorityConfidence, status, lat, lng, address, reporterContact, reporterUserId, locationSharingActive, reportedAt, resolvedAt
     - `Responder`: id, userId (optional link to User), name, type, capability, status, lat, lng, currentIncidentId, lastStatusUpdate
     - `Resource`: id, name, type, assignedResponderId, status
     - `Assignment`: id, incidentId, responderId, status, assignedByCoordinatorId, assignedAt, acknowledgedAt, completedAt, notes
     - `LocationLog`: id, incidentId, responderId, lat, lng, accuracy, source (`GPS`|`MANUAL`), timestamp, isActive
     - `AuditLog`: id, userId, action, resourceType, resourceId, details, timestamp

3. **Design WebSocket Protocol with RBAC Rooms:**
   - Document and implement room segmentation:
     - `coordinators` room: receives all `incident:new`, `incident:triaged`, `assignment:status`, `responder:location`
     - `responders:{id}` room: receives private assignment alerts and mission updates
     - `civilians:{incidentId}` room: receives status updates for their specific incident only

4. **Monorepo Setup & Seed Script:**
   - Initialize `server/` with Express, Socket.IO, `@prisma/client`, `prisma`, `cors`, `dotenv`, `bcryptjs`, `jsonwebtoken`.
   - Create comprehensive `seed.js` creating demo users for each privilege level (`civilian@test.com`, `coordinator@test.com`, `responder@test.com`, `admin@test.com`), active fleet of responders, sample resources, and initial incidents.
   - Run migrations/db push and verify seed execution.

5. **Graphify:** Run `graphify update .` to index the new architecture.

**Deliverable:** Working Prisma schema, successfully executed seed script with all RBAC roles, server directory initialized with Express + Socket.IO and RBAC middleware stubs.

---

### Week 2 — SOS Request Interface & Location Services

**Goal:** A civilian user can open a page, fill in an emergency form, grant location permission, and submit. The backend receives it and persists it.

**Tasks:**

1. **Build SOS page** (`client/src/sos.js` + `client/sos.html`):
   - Emergency type dropdown (Medical, Fire, Security, Natural Disaster, Industrial)
   - "How many people affected?" number input
   - Description textarea
   - Location section: auto-detect via `navigator.geolocation.getCurrentPosition()`, with manual pin-drop fallback on Leaflet map
   - Submit button → POST to backend

2. **Backend API** (`server/src/routes/incidents.js`):
   - `POST /api/incidents` — Validate, create incident record, assign initial status `pending`, broadcast `incident:new` via WebSocket
   - `GET /api/incidents` — List active incidents (for dashboard, Week 3)
   - `GET /api/incidents/:id` — Single incident detail

3. **Location transmission** — HTTPS only (Vite dev proxy or nginx in prod). No custom encryption needed at prototype stage; TLS handles transit encryption. Store raw coords in DB with timestamp.

4. **Access control stub** — Add role field to requests. Don't build full auth yet, but structure the middleware so it's pluggable.

**Deliverable:** Working SOS form → backend → database pipeline. Verify by checking DB after submission.  
**Status:** ✅ **COMPLETED** — Standalone SOS portal (`sos.html` + `src/sos.js`) built with Leaflet pin drop & GPS auto-detect, connected to backend `POST /api/incidents`, real-time Socket.IO incident room updates, voluntary privacy toggle, location stream (`POST /api/incidents/:id/location`), and cancellation (`POST /api/incidents/:id/cancel`). Verified with live DB persistence & WebSocket broadcast.

**Graphify:** Updated (`graphify update .`) with 177 nodes, 271 edges, 14 communities.

---

### Week 3 — Centralized Coordination Dashboard

**Goal:** Transform the existing dashboard prototype into a real-time coordinator interface connected to live backend data.

**Tasks:**

1. **Refactor [main.js](file:///d:/projects/NexCommand/src/main.js)** → `dashboard.js`:
   - Remove `generateIncident()` simulation loop
   - Remove hardcoded `state.resources` array
   - Connect to `GET /api/incidents` on load
   - Connect to `GET /api/responders` on load
   - Establish WebSocket connection, listen for `incident:new`, `incident:updated`, `responder:updated`
   - Keep existing `renderIncidents()`, `renderResources()`, `updateMetrics()`, `addMapMarker()` — just change their data source

2. **Add dispatch controls**:
   - Replace current `dispatchResource()` (which picks randomly) with:
     - Dropdown to select a specific responder
     - "Assign" button → `POST /api/assignments`
   - Show assignment status on incident cards

3. **Real-time updates**:
   - When `incident:new` fires via WebSocket → prepend to feed, add map marker
   - When `responder:updated` fires → update resource list status badges

4. **Backend WebSocket server** (`server/src/ws/`):
   - Socket.IO server integrated with Express
   - Room-based: `coordinators` room, `responders` room
   - Broadcast incident events to coordinators
   - Broadcast assignment events to relevant responders

**Deliverable:** Dashboard shows real incidents from DB, updates in real-time when SOS form is submitted from another tab.

---

### Week 4 — Incident Classification ML Pipeline

**Goal:** A Python service that accepts incident attributes and returns a priority classification (Low / Medium / High / Critical).

**Tasks:**

1. **Dataset preparation** (`ml/data/`):
   - Option A: Find a public emergency dataset (e.g., NFIRS fire incident data, 311 service requests)
   - Option B: Generate synthetic training data based on rules (incident type × affected count × time → priority). This is faster and fine for a prototype.
   - Clean and structure into CSV: `type, affected_count, description_length, hour_of_day, day_of_week, is_weekend → priority`

2. **Training pipeline** (`ml/train.py`):
   - Logistic Regression baseline
   - Random Forest
   - Gradient Boosting (XGBoost or sklearn)
   - Evaluate: accuracy, precision, recall, F1 per class, confusion matrix
   - Save best model as pickle/joblib artifact

3. **Inference API** (`ml/predict.py`):
   - FastAPI or Flask endpoint: `POST /predict` → accepts incident attributes → returns `{ priority: "critical", confidence: 0.87 }`
   - Load saved model on startup
   - Add a `/health` endpoint

4. **Integration point** — Document how the Node.js backend will call this Python service (HTTP request from `server/` to `ml/` service).

**Deliverable:** Running Python API that classifies incidents. Evaluation metrics documented.

---

### Week 5 — Optimization Module for Resource Allocation

**Goal:** Given active incidents and available responders, produce optimal assignment recommendations.

**Tasks:**

1. **Hungarian Algorithm** (`ml/allocate.py`):
   - Build cost matrix: rows = incidents, columns = responders
   - Cost = weighted sum of:
     - Distance (haversine between incident and responder coords)
     - Priority penalty (critical incidents get negative cost = strong pull)
     - Capability match (ambulance ↔ medical, fire truck ↔ fire, etc.)
   - Use `scipy.optimize.linear_sum_assignment`

2. **ILP extension** — For constrained scenarios:
   - "This responder can only handle 1 incident at a time"
   - "This incident needs 2 responders"
   - Use PuLP or OR-Tools

3. **Allocation API endpoint**:
   - `POST /allocate` → accepts list of active incidents + available responders → returns recommended assignments
   - Node.js backend calls this when new incidents arrive or responder status changes

4. **Integration with Node.js backend**:
   - When coordinator clicks "Get Recommendations" → backend calls Python `/allocate` → returns suggested assignments → dashboard shows them as "Suggested" badges the coordinator can approve

**Deliverable:** Allocation endpoint that produces reasonable assignments. Manual test with 5 incidents and 5 responders.

---

### Week 6 — Multi-Agent Dynamic Re-routing

**Goal:** When a responder becomes unavailable after assignment, the system detects it and proposes a re-route.

**Tasks:**

1. **Agent logic** (implemented as event handlers in `server/src/agents/`):
   - `IncidentAgent` — watches for priority changes, escalates if needed
   - `ResponderAgent` — watches for status changes, fires `responder:unavailable` event
   - `AllocationAgent` — on `responder:unavailable`, triggers re-allocation for affected incidents
   - `CoordinationAgent` — detects conflicts (two incidents assigned same responder), unserved critical incidents

2. **Re-routing flow**:
   - Responder status changes to `unavailable` → `ResponderAgent` fires event
   - `AllocationAgent` identifies affected assignments → calls Python `/allocate` with remaining responders
   - New suggestion pushed to coordinator dashboard → coordinator approves

3. **Integration** — Wire agents into WebSocket event flow. These are just event listener functions, not separate processes.

**Deliverable:** Simulate: assign responder → mark them unavailable → see re-route suggestion appear on dashboard.

---

### Week 7 — Edge Cases & Robustness

**Tasks:**

1. **Deduplication** — Before creating incident: check for existing incidents within 100m radius and 5-minute window. If match found, merge or flag as duplicate.

2. **Resource shortage alerts** — If no responders available for a critical incident, push an alert to coordinator dashboard with escalation options.

3. **Low-confidence predictions** — If ML model returns confidence < 0.6, flag the incident for manual triage (show a "Low confidence" badge).

4. **Cleanup scripts** — Scheduled job (or manual trigger) to:
   - Mark incidents older than 24h as `stale`
   - Delete location logs older than 48h
   - Reset stuck assignments (assigned > 30 min with no acknowledgment)

**Deliverable:** Each edge case demonstrated with a test scenario.

---

### Week 8 — System Integration & E2E Workflow

**Goal:** Everything works end-to-end.

**Tasks:**

1. **Wire ML output → optimization input**:
   - Incident created → Node.js calls Python `/predict` → priority stored → triggers `/allocate` → recommendations shown on dashboard

2. **Full lifecycle test**:
   - SOS submission → incident created → ML classifies → optimization recommends → coordinator approves → responder notified → responder acknowledges → goes en route → on scene → resolved → incident closed → location data cleaned up

3. **Real-time sync verification** — Open 3 browser tabs (SOS page, dashboard, responder view). Walk through the full flow.

4. **Fix integration bugs** — This week is mostly debugging and polish.

**Deliverable:** Screen recording of full lifecycle working.

---

### Week 9 — Performance Evaluation

**Tasks:**

1. **ML metrics** — Run evaluation suite:
   - Precision, recall, F1 per class
   - Confusion matrix
   - Compare Logistic Regression vs Random Forest vs Gradient Boosting
   - Document in `ml/EVALUATION.md`

2. **Allocation benchmarks** — Compare:
   - Nearest-available-responder baseline vs Hungarian Algorithm
   - Metrics: avg response distance, utilization rate, % incidents assigned, unserved count
   - Run with 20, 50, 100 simultaneous incidents

3. **Load testing** — Simulate burst of 50 SOS requests. Measure:
   - Incident processing latency
   - WebSocket update latency
   - Assignment generation time

**Deliverable:** Evaluation report with tables and charts.

---

### Week 10 — Security & Privacy Audit

**Tasks:**

1. **HTTPS verification** — Ensure all API calls use TLS in production config.

2. **Access control** — Implement proper JWT auth:
   - Civilians can only submit SOS and view their own incidents
   - Coordinators can view all incidents and manage assignments
   - Responders can view their assignments and update status

3. **Location data lifecycle** — Verify:
   - Location sharing stops when incident is resolved
   - Location logs are deleted/anonymized after configurable retention period
   - No location data leaks to unauthorized roles

4. **Input validation** — SQL injection, XSS prevention, rate limiting on SOS endpoint.

**Deliverable:** Security checklist with pass/fail for each item.

---

## Graphify Integration

Throughout the project, maintain the knowledge graph:

```bash
# After any code changes (free, no API cost):
graphify update .

# Before navigating unfamiliar parts of the codebase:
graphify query "How does the allocation module connect to the dashboard?"
graphify path "AllocationAgent" "renderIncidents"
graphify explain "WebSocket protocol"

# After major restructuring (e.g., Week 1 monorepo migration):
graphify . --force   # Full rebuild
```

> [!TIP]
> When starting work each week, run `graphify query "<this week's topic>"` first to see what's already connected and avoid duplicating effort.

---

## Tech Stack Summary

| Layer | Technology | Why |
|---|---|---|
| Frontend | Vite + vanilla JS | Already set up, fast, no framework overhead for a prototype |
| Backend | Node.js + Express + Socket.IO | Standard, good WebSocket support, same language as frontend |
| Database | PostgreSQL + Prisma | Relational data, type-safe ORM, easy migrations |
| ML/Optimization | Python + FastAPI + scikit-learn + scipy + PuLP | Standard ML stack, scipy has Hungarian algo built in |
| Maps | Leaflet.js + OpenStreetMap | Already integrated, free |
| Auth | JWT (jsonwebtoken) | Simple, stateless, standard |
| Deployment | Vercel (frontend) + Railway/Render (backend + DB) + Railway (Python ML) | Free tiers available |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| ML model accuracy too low on synthetic data | Acceptable for prototype — document as limitation, focus on the pipeline being correct |
| WebSocket reliability | Socket.IO handles reconnection automatically. Add offline queue for missed events |
| Python-to-Node.js latency | Both services run locally in dev. In prod, co-locate on same platform |
| Scope creep | This plan only covers the **minor project**. Mobile app, external data, advanced MAS → major project |
| Team coordination | Each week's tasks map to ~3 parallel work streams (frontend, backend, ML) |
