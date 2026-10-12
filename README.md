<div align="center">
  <img src="https://img.icons8.com/color/96/000000/shield.png" alt="CrisisCore" width="80" />
  <h1>CrisisCore</h1>
  <p><strong>Crisis Response and Resource Allocation Dashboard</strong></p>

  [![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-000000?style=for-the-badge&logo=vercel)](https://nex-command-git-main-rsardhotra-3687s-projects.vercel.app/)
  [![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)
  [![Node](https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)
  [![Gemini](https://img.shields.io/badge/AI-Gemini_Flash-8E75B2?style=for-the-badge&logo=google)](https://aistudio.google.com/)
  [![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
</div>

<br/>

CrisisCore is a real-time crisis management dashboard for emergency coordinators. It aggregates live incident feeds, matches crises to the nearest available resources, and gives responders AI-generated situation briefs on demand.

It is built as a college minor project but is structured like a production system: role-based access control, JWT auth, a real Express/Socket.IO backend, a Prisma ORM layer, and a Python ML service stub for predictive prioritization.

---

## Screenshots

| Tactical Map | Live Incidents | Resource Allocation |
|---|---|---|
| ![Map](./screenshots/map.png) | ![Incidents](./screenshots/live_incidents.png) | ![Resources](./screenshots/resource_allocation.png) |

---

## Features

- **Live Incident Feed** - incidents stream in over WebSocket in real time
- **Tactical Map** - Leaflet.js map with CartoDB Dark Matter tiles; markers update as incidents arrive
- **Smart Resource Dispatch** - auto-matches incidents to nearest available unit (ambulance, fire engine, drone)
- **Role-Based Access** - three roles: Admin, Coordinator, Responder, each with scoped permissions
- **Audit Log** - every assignment and status change is recorded
- **Glassmorphism UI** - dark theme, neon severity accents, designed for low-light control rooms

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Vite 8 |
| Backend | Node.js, Express, Socket.IO |
| Database | SQLite (dev) / PostgreSQL (prod), via Prisma ORM |
| Auth | JWT (RS-style secret, RBAC middleware) |
| AI | Google Gemini Flash API (via Vercel Serverless + local proxy) |
| Maps | Leaflet.js, CartoDB basemaps |
| ML stub | Python (FastAPI), scikit-learn |

---

## Project Structure

```
CrisisCore/
├── index.html          # Single-page frontend app
├── src/
│   ├── main.js         # All frontend logic
│   └── style.css       # Dark theme, glassmorphism
├── api/
│   └── gemini.js       # Vercel serverless function (AI proxy)
├── server/             # Full Express backend
│   ├── src/
│   │   ├── index.js    # App entry, Socket.IO setup
│   │   ├── routes/     # REST endpoints (incidents, responders, assignments, auth)
│   │   ├── middleware/ # JWT auth, RBAC
│   │   ├── constants/  # Roles, permissions, statuses
│   │   └── ws/         # WebSocket broadcaster
│   └── prisma/
│       ├── schema.prisma
│       └── seed.js
├── ml/                 # Python ML service (priority prediction)
│   ├── requirements.txt
│   └── README.md
├── screenshots/
├── start.bat           # Windows one-click start
└── start.sh            # Mac/Linux one-click start
```

---

## Local Setup

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/) (free)

### Option A: Frontend only (quickest)

This runs the Vite dev server with mocked data. No backend or database needed.

```bash
git clone https://github.com/YOUR_USERNAME/CrisisCore.git
cd CrisisCore
npm install
```

Create `.env.local` in the root:

```env
GEMINI_API_KEY="your_key_here"
```

Then start:

```bash
# Windows
start.bat

# Mac / Linux
chmod +x start.sh && ./start.sh

# Manual
npm run dev
```

Open `http://localhost:5173`.

---

### Option B: Full stack (backend + WebSocket + DB)

**1. Set up the server**

```bash
cd server
npm install
```

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

`.env` fields:

```env
PORT=3001
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-own-secret-here"
CLIENT_ORIGIN="http://localhost:5173"
```

**2. Init the database and seed it**

```bash
npm run prisma:push    # creates the SQLite schema
npm run prisma:seed    # loads demo users + incidents
```

**3. Start both servers**

From the root:

```bash
npm run dev            # starts Vite frontend on :5173
npm run server:dev     # starts Express backend on :3001
```

Or use two terminals if you prefer.

**Default demo credentials after seeding:**

| Role | Email | Password |
|---|---|---|
| Admin | admin@crisiscore.dev | admin123 |
| Coordinator | coord@crisiscore.dev | coord123 |
| Responder | responder@crisiscore.dev | resp123 |

---

## Deployment

The frontend deploys to Vercel with zero config. The `api/gemini.js` serverless function handles the AI proxy so the API key stays server-side.

Set `GEMINI_API_KEY` in your Vercel project environment variables.

For the backend, deploy `server/` to any Node host (Railway, Render, fly.io). Set the env vars from `.env.example`.

---

## License

MIT
