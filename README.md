<div align="center">
  <img src="https://img.icons8.com/color/96/000000/shield.png" alt="CrisisCore" width="80" />
  <h1>CrisisCore</h1>
  <p><strong>Next-Gen Crisis Response, Resource Allocation & Real-Time Emergency Command System</strong></p>

  [![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-000000?style=for-the-badge&logo=vercel)](https://nex-command-git-main-rsardhotra-3687s-projects.vercel.app/)
  [![Android](https://img.shields.io/badge/Android-Capacitor-3DDC84?style=for-the-badge&logo=android)](android/)
  [![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)
  [![Node](https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)
  [![Socket.IO](https://img.shields.io/badge/Socket.IO-Real--Time-010101?style=for-the-badge&logo=socket.io)](https://socket.io/)
  [![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
</div>

<br/>

**CrisisCore** is an intelligent, real-time emergency response platform that bridges the gap between civilian emergency reporting, centralized command dispatch, and field responder deployment. Available as both a responsive web application and a native Android application, CrisisCore features live multi-role coordination, dual-channel tactical communications, and automated triage.

---

## Key Features

### 1. Four Dedicated Stakeholder Portals
- **Coordinator Central Dashboard**: Real-time incident triage, dynamic unit dispatch, tactical status feeds, and audit monitoring.
- **Field Responder Terminal**: Mission dispatch acceptance/declination with explicit reasons, lifecycle updates (`EN_ROUTE`, `ON_SCENE`, `RESOLVED`), and GPS telemetry transmission.
- **Civilian SOS Emergency Portal (`sos.html` & in-app)**: High-visibility 1-tap SOS submission, voluntary GPS broadcasting, Leaflet manual map pin-drop fallback, and real-time 4-stage rescue tracker.
- **Admin Console**: User verification, fleet management, and immutable system audit logs.

### 2. Dual-Channel Real-Time Communications
- **OPS Channel (`chat:OPS:${id}`)**: Secure tactical loop between Central Dispatch and Field Responders for operational orders and situational briefings. Civilians are strictly barred.
- **CIVILIAN Channel (`chat:CIVILIAN:${id}`)**: Direct channel between Field Responders and Civilian requesters for arrival guidance, gate access, and hazard advisories.
- **Real-Time Dispatcher Prompts**: When a responder updates their status or declines a call, the central dashboard receives immediate audible and visual alert toasts with action details.

### 3. Native Android Application (`android/`)
- Packaged with **Capacitor** for 100% native WebView performance and zero UI fragmentation.
- Full Android Studio Gradle project in `android/` with hardware GPS location permissions (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`).
- **Cross-Platform Synchronization**: Automatically detects Android container and routes network traffic to the host backend via `http://10.0.2.2:3001` (emulator) or LAN IP (physical device).

### 4. Voluntary Duty-of-Care Framework
- Mandatory legal Terms of Service agreement on volunteer responder registration.
- Explicit notification of legal abandonment deterrents and administrative fine warnings (₹25,000 / $500 penalty).
- Cryptographic timestamped `AuditLog` records for compliance.

### 5. Machine Learning Incident Triage (WIP)
- Preprocessing pipeline for emergency incidents (type, headcount, temporal harmonics, description TF-IDF).
- Logistic Regression baseline, Random Forest, and Gradient Boosting models.
- Sub-5ms real-time inference API via Python FastAPI microservice.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Vanilla JavaScript, HTML5, Vanilla CSS Design System, Vite 8 |
| **Mobile (Android)** | Capacitor Native Android wrapper (`org.crisiscore.app`), Android Studio Gradle |
| **Backend** | Node.js, Express, Socket.IO (room isolation & event gateway) |
| **Database & ORM** | SQLite (dev) / PostgreSQL (prod), Prisma ORM |
| **Authentication** | JWT (JSON Web Tokens), RBAC Middleware, bcryptjs |
| **Location & Maps** | Leaflet.js, OpenStreetMap, HTML5 Geolocation API, Android Native GPS |
| **ML Microservice** | Python 3.12, FastAPI, scikit-learn, pandas, numpy |
| **AI Advisor** | Google Gemini Flash API (situation briefs on demand) |

---

## Project Structure

```
CrisisCore/
├── index.html              # Core Command Application (Coordinator, Responder, Admin, Civilian)
├── sos.html                # Dedicated Standalone Civilian SOS Emergency Portal
├── src/
│   ├── main.js             # Client application logic & UI controllers
│   ├── sos.js              # Civilian SOS portal controller & live GPS streaming
│   ├── apiConfig.js        # Dynamic cross-platform network & emulator routing
│   └── style.css           # Glassmorphism design tokens & responsive styles
├── android/                # Native Android Studio Gradle Project (Capacitor)
│   ├── app/src/main/       # AndroidManifest.xml (GPS permissions, cleartext HTTP)
│   └── build.gradle        # Android build configuration
├── server/                 # Express + Socket.IO Backend Server
│   ├── src/
│   │   ├── index.js        # Server entry & Socket.IO room gateway
│   │   ├── routes/         # REST API endpoints (incidents, responders, chat, auth)
│   │   ├── middleware/     # JWT authentication & RBAC authorization
│   │   └── constants/      # Status enums, role definitions, permissions
│   └── prisma/
│       ├── schema.prisma   # Relational schema (Users, Incidents, Assignments, Chat, Audits)
│       └── seed.js         # Verified demo seed data
├── ml/                     # Machine Learning Triage Subsystem
│   ├── requirements.txt    # Python dependencies (scikit-learn, fastapi, pandas)
│   └── README.md           # ML architecture & training guide
├── capacitor.config.json   # Capacitor mobile configuration
└── package.json            # Scripts: build, android:sync, android:open
```

---

## Quick Start Guide

### 1. Web Application & Backend

**Clone & Install Dependencies:**
```bash
git clone https://github.com/YOUR_USERNAME/CrisisCore.git
cd CrisisCore
npm install
cd server
npm install
```

**Initialize Database & Start Backend:**
```bash
# In server/ directory:
npm run prisma:push    # Generate SQLite database
npm run prisma:seed    # Seed initial coordinator, verified responder & incidents
npm run dev            # Starts backend on http://localhost:3001
```

**Start Frontend (New Terminal from Project Root):**
```bash
npm run dev            # Starts Vite dev server on http://localhost:5173
```

**Default Test Credentials:**
| Role | Email | Password |
|---|---|---|
| Admin | `admin@crisiscore.dev` | `admin123` |
| Coordinator | `coord@crisiscore.dev` | `coord123` |
| Responder | `responder@crisiscore.dev` | `resp123` |

---

### 2. Running the Android Application

**Launch in Android Studio:**
```bash
npm run android:open
```
*Or open the `android/` directory directly in Android Studio.*

**Build & Run:**
1. Wait for Gradle to index the project.
2. Select an Android Virtual Device (AVD Emulator) or connect a physical phone via USB.
3. Click the green **▶ Run ('app')** button.
4. The Android app connects directly to the Node.js backend running on your PC via `http://10.0.2.2:3001`.

**Syncing Frontend Updates to Android:**
```bash
npm run android:sync
```

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
