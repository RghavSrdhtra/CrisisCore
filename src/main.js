import './style.css';

// --- State Management ---
const baseLat = 28.6139; // Delhi center
const baseLng = 77.2090;

const state = {
  incidents: [],
  resources: [
    { id: 'R1', name: 'Medic Unit 01', type: 'ambulance', status: 'available' },
    { id: 'R2', name: 'Medic Unit 02', type: 'ambulance', status: 'available' },
    { id: 'R3', name: 'Fire Engine 14', type: 'fire', status: 'available' },
    { id: 'R4', name: 'Rescue Drone Alpha', type: 'drone', status: 'available' },
    { id: 'R5', name: 'Police Cruiser 09', type: 'police', status: 'available' },
  ],
  metrics: {
    activeCrises: 0,
    unitsDeployed: 0,
    avgResponse: '4m 12s'
  }
};

const incidentTypes = [
  { type: 'Medical', icon: 'ph-ambulance', color: 'blue', severities: ['high', 'medium'] },
  { type: 'Fire', icon: 'ph-fire', color: 'red', severities: ['critical', 'high'] },
  { type: 'Security', icon: 'ph-shield-warning', color: 'orange', severities: ['critical', 'medium'] }
];

const locations = [
  'Connaught Place', 'Vasant Kunj', 'Karol Bagh', 'Lajpat Nagar', 'Rohini', 'Dwarka'
];

let incidentCounter = 1000;
let map;
let markersLayer;
let mapMarkers = {};

// --- DOM Elements ---
const incidentFeedEl = document.getElementById('incidentFeed');
const incidentCountEl = document.getElementById('incidentCount');
const resourceListEl = document.getElementById('resourceList');
const metricsContainerEl = document.getElementById('metricsContainer');

// --- Helper Functions ---
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const getIconForType = (type) => {
  if (type === 'ambulance') return 'ph-ambulance';
  if (type === 'fire') return 'ph-fire-truck';
  if (type === 'drone') return 'ph-airplane-tilt';
  if (type === 'police') return 'ph-car-profile';
  return 'ph-truck';
};

// --- Core Logic ---
function initMap() {
  // Initialize Leaflet Map
  map = L.map('tacticalMap', {
    center: [baseLat, baseLng],
    zoom: 12,
    zoomControl: false,
    attributionControl: false
  });

  // OpenStreetMap with tactical dark styling (completely free, watermark-free, no API key needed)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'tactical-dark-tiles',
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

function generateIncident() {
  const typeDef = getRandom(incidentTypes);
  const severity = getRandom(typeDef.severities);
  
  const incident = {
    id: `INC-${++incidentCounter}`,
    type: typeDef.type,
    icon: typeDef.icon,
    severity: severity,
    location: getRandom(locations),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    coords: { 
      lat: baseLat + (Math.random() - 0.5) * 0.15, 
      lng: baseLng + (Math.random() - 0.5) * 0.15 
    },
    status: 'active'
  };

  state.incidents.unshift(incident);
  if (state.incidents.length > 8) {
    const removed = state.incidents.pop();
    // Remove marker for popped incident
    if (mapMarkers[removed.id]) {
      markersLayer.removeLayer(mapMarkers[removed.id]);
      delete mapMarkers[removed.id];
    }
  }
  
  updateMetrics();
  renderIncidents();
  addMapMarker(incident);
}

// --- Gemini AI Integration ---
// Pinging our secure Vercel Serverless Backend
async function generateGeminiBrief(incident) {
  const prompt = `As an emergency response AI, generate a concise 2-sentence tactical brief for a ${incident.severity} severity ${incident.type} incident located at ${incident.location}. Provide immediate tactical advice for first responders.`;

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error("Backend API Error:", data.error);
      return `API Error: ${data.error}`;
    }
    
    return data.brief;
  } catch (error) {
    console.error("Failed to contact secure backend:", error);
    return "Error communicating with secure backend. Check network.";
  }
}

window.getAIBrief = async (incidentId, buttonEl) => {
  const incident = state.incidents.find(i => i.id === incidentId);
  if (!incident) return;
  
  buttonEl.disabled = true;
  buttonEl.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Analyzing...';
  
  const brief = await generateGeminiBrief(incident);
  
  // Inject the brief into the card
  const card = buttonEl.closest('.incident-card');
  let briefEl = card.querySelector('.ai-brief');
  if (!briefEl) {
    briefEl = document.createElement('div');
    briefEl.className = 'ai-brief';
    briefEl.style.marginTop = '10px';
    briefEl.style.padding = '10px';
    briefEl.style.background = 'var(--cyan-muted)';
    briefEl.style.borderLeft = '2px solid var(--cyan)';
    briefEl.style.fontSize = '12px';
    briefEl.style.color = 'var(--text-secondary)';
    briefEl.style.borderRadius = '0 6px 6px 0';
    card.insertBefore(briefEl, card.querySelector('.incident-actions'));
  }
  
  briefEl.innerHTML = `<strong>Analysis:</strong><br/>${brief}`;
  
  buttonEl.innerHTML = '<i class="ph ph-check"></i> Done';
};

window.dispatchResource = (incidentId) => {
  if (currentUser.role !== 'COORDINATOR' && currentUser.role !== 'ADMIN') {
    alert('Access Denied: Dispatch authority requires Coordinator or Administrator privileges.');
    return;
  }

  const incident = state.incidents.find(i => i.id === incidentId);
  if (!incident || incident.status === 'dispatched') return;

  // Find an available resource
  const availableResource = state.resources.find(r => r.status === 'available');
  if (availableResource) {
    incident.status = 'dispatched';
    availableResource.status = 'busy';
    
    // Update marker
    updateMapMarker(incident);
    
    // Simulate resolution after some time
    setTimeout(() => {
      availableResource.status = 'available';
      state.incidents = state.incidents.filter(i => i.id !== incidentId);
      
      // Remove marker
      if (mapMarkers[incidentId]) {
        markersLayer.removeLayer(mapMarkers[incidentId]);
        delete mapMarkers[incidentId];
      }
      
      updateMetrics();
      renderAll();
    }, 15000); // 15 seconds simulate task completion
    
    updateMetrics();
    renderAll();
  } else {
    alert('No available resources to dispatch!');
  }
}

window.toggleResourceStatus = (resId) => {
  if (currentUser.role !== 'ADMIN') {
    alert('Access Denied: Fleet status modification requires Administrator privileges.');
    return;
  }
  const res = state.resources.find(r => r.id === resId);
  if (!res) return;
  res.status = res.status === 'available' ? 'busy' : 'available';
  updateMetrics();
  renderResources();
};

// --- Render Functions ---
function updateMetrics() {
  state.metrics.activeCrises = state.incidents.filter(i => i.status === 'active').length;
  state.metrics.unitsDeployed = state.resources.filter(r => r.status === 'busy').length;
  
  metricsContainerEl.innerHTML = `
    <div class="metric-card metric-red">
      <div class="metric-icon"><i class="ph-fill ph-warning-circle"></i></div>
      <div class="metric-info">
        <h4>Active Crises</h4>
        <div class="value">${state.metrics.activeCrises}</div>
      </div>
    </div>
    <div class="metric-card metric-blue">
      <div class="metric-icon"><i class="ph-fill ph-truck"></i></div>
      <div class="metric-info">
        <h4>Units Deployed</h4>
        <div class="value">${state.metrics.unitsDeployed}</div>
      </div>
    </div>
    <div class="metric-card metric-green">
      <div class="metric-icon"><i class="ph-fill ph-clock-countdown"></i></div>
      <div class="metric-info">
        <h4>Avg Response</h4>
        <div class="value">${state.metrics.avgResponse}</div>
      </div>
    </div>
  `;
}

function renderIncidents() {
  incidentCountEl.textContent = state.incidents.length;
  incidentFeedEl.innerHTML = state.incidents.map(inc => `
    <div class="incident-card severity-${inc.severity}">
      <div class="incident-header">
        <div class="incident-type">
          <i class="ph ${inc.icon}"></i> ${inc.type} Incident
        </div>
        <div class="incident-time">${inc.time}</div>
      </div>
      <div class="incident-title">${inc.id} reported at ${inc.location}</div>
      <div class="incident-actions" style="display: flex; gap: 8px;">
        <button class="btn-dispatch btn-brief" onclick="getAIBrief('${inc.id}', this)">
          <i class="ph ph-chat-text"></i> Brief
        </button>
        ${inc.status === 'active' 
          ? (currentUser.role === 'COORDINATOR' || currentUser.role === 'ADMIN'
              ? `<button class="btn-dispatch" onclick="dispatchResource('${inc.id}')">Dispatch</button>`
              : `<button class="btn-dispatch" style="opacity: 0.5; cursor: not-allowed;" title="Dispatcher authorization required" disabled>Locked</button>`
            )
          : `<button class="btn-dispatch dispatched" disabled>En Route</button>`
        }
      </div>
    </div>
  `).join('');
}

function renderResources() {
  resourceListEl.innerHTML = state.resources.map(res => `
    <div class="resource-item">
      <div class="resource-info">
        <div class="resource-icon">
          <i class="ph ${getIconForType(res.type)}"></i>
        </div>
        <div class="resource-details">
          <h5>${res.name}</h5>
          <p>${res.id}</p>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <div class="resource-status status-${res.status}">
          ${res.status === 'available' ? 'Available' : 'Deployed'}
        </div>
        ${currentUser.role === 'ADMIN' ? `
          <button class="admin-fleet-btn" onclick="toggleResourceStatus('${res.id}')" title="Admin Fleet Override">
            ${res.status === 'available' ? 'Deploy' : 'Reset'}
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function getMarkerColor(incident) {
  if (incident.status === 'dispatched') return '#9ca3af'; // muted
  if (incident.severity === 'critical') return '#ef4444'; // red
  if (incident.severity === 'high') return '#f59e0b'; // orange
  return '#06b6d4'; // cyan
}

function addMapMarker(incident) {
  const color = getMarkerColor(incident);
  const html = `
    <div class="map-blip" style="position: relative;">
      <div class="blip-pulse" style="background: ${color}; opacity: 0.3;"></div>
      <div class="blip-core" style="background: ${color}; box-shadow: 0 0 10px ${color};"></div>
      <div class="blip-label" style="opacity: 1; top: -20px; color: white;">${incident.id}</div>
    </div>
  `;
  
  const icon = L.divIcon({
    html: html,
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });

  const marker = L.marker([incident.coords.lat, incident.coords.lng], { icon }).addTo(markersLayer);
  mapMarkers[incident.id] = marker;
}

function updateMapMarker(incident) {
  if (mapMarkers[incident.id]) {
    const color = getMarkerColor(incident);
    const html = `
      <div class="map-blip" style="position: relative;">
        <div class="blip-core" style="background: ${color}; box-shadow: 0 0 5px ${color};"></div>
        <div class="blip-label" style="opacity: 1; top: -20px; color: white;">${incident.id} (En Route)</div>
      </div>
    `;
    const icon = L.divIcon({
      html: html,
      className: '',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
    mapMarkers[incident.id].setIcon(icon);
  }
}

function renderAll() {
  renderIncidents();
  renderResources();
}

// --- Navigation Mock ---
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const dashboardView = document.getElementById('dashboardView');
  const comingSoonView = document.getElementById('comingSoonView');
  const comingSoonTitle = document.getElementById('comingSoonTitle');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const text = e.target.closest('.nav-item').textContent.trim();
      
      navItems.forEach(n => n.classList.remove('active'));
      e.target.closest('.nav-item').classList.add('active');

      if (text !== 'Command Center') {
        dashboardView.style.display = 'none';
        comingSoonView.style.display = 'flex';
        comingSoonTitle.textContent = `${text} is in Development`;
      } else {
        dashboardView.style.display = 'grid';
        comingSoonView.style.display = 'none';
      }
    });
  });
}

// --- RBAC Profiles & Authentication Management ---
const DEMO_PROFILES = {
  COORDINATOR: {
    id: 'user-coord-01',
    email: 'coordinator@test.com',
    name: 'Sarah Connor',
    role: 'COORDINATOR',
    agency: 'Central Disaster Coordination Directorate',
    badge: 'COORD-8801',
    badgeClass: 'badge-coordinator',
    bannerClass: 'banner-coordinator',
    roleDesc: 'COORDINATOR (Full Tactical Dispatch Authority)',
    icon: 'ph-crosshair',
    bg: '06b6d4',
    color: '0f172a'
  },
  RESPONDER: {
    id: 'user-resp-01',
    email: 'responder@test.com',
    name: 'Capt. Carlos Vance',
    role: 'RESPONDER',
    agency: 'Metro Fire & Rescue Dept',
    badge: 'RESP-4102',
    badgeClass: 'badge-responder',
    bannerClass: 'banner-responder',
    roleDesc: 'RESPONDER (Field Unit MEDIC-01 • Telemetry Active)',
    icon: 'ph-ambulance',
    bg: 'f59e0b',
    color: '0f172a'
  },
  CIVILIAN: {
    id: 'user-civ-01',
    email: 'civilian@test.com',
    name: 'Jane Doe',
    role: 'CIVILIAN',
    agency: 'Public Citizen',
    badge: 'CIV-0101',
    badgeClass: 'badge-civilian',
    bannerClass: 'banner-civilian',
    roleDesc: 'CIVILIAN (Citizen Emergency SOS • Privacy Protection Enabled)',
    icon: 'ph-user',
    bg: '10b981',
    color: '0f172a'
  },
  ADMIN: {
    id: 'user-adm-01',
    email: 'admin@test.com',
    name: 'Marcus Wright',
    role: 'ADMIN',
    agency: 'National Emergency Operations Authority',
    badge: 'ADM-001',
    badgeClass: 'badge-admin',
    bannerClass: 'banner-admin',
    roleDesc: 'ADMIN (System Governance & Security Administration)',
    icon: 'ph-shield-star',
    bg: 'a855f7',
    color: '0f172a'
  }
};

let currentUser = JSON.parse(localStorage.getItem('crisiscore_user')) || DEMO_PROFILES.ADMIN;

function updateUserUI(user) {
  currentUser = user;
  localStorage.setItem('crisiscore_user', JSON.stringify(user));

  const profile = DEMO_PROFILES[user.role] || DEMO_PROFILES.ADMIN;
  const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=${profile.bg}&color=${profile.color}&bold=true&size=32`;

  // Topbar Profile
  const topbarAvatar = document.getElementById('topbarAvatar');
  const topbarUserName = document.getElementById('topbarUserName');
  const topbarUserRole = document.getElementById('topbarUserRole');
  if (topbarAvatar) topbarAvatar.src = avatarUrl;
  if (topbarUserName) topbarUserName.textContent = user.name;
  if (topbarUserRole) {
    topbarUserRole.textContent = user.role;
    topbarUserRole.className = `user-role-badge ${profile.badgeClass}`;
  }

  // Profile Dropdown
  const dropdownName = document.getElementById('dropdownName');
  const dropdownEmail = document.getElementById('dropdownEmail');
  const dropdownRolePill = document.getElementById('dropdownRolePill');
  const dropdownAgency = document.getElementById('dropdownAgency');
  const dropdownBadge = document.getElementById('dropdownBadge');

  if (dropdownName) dropdownName.textContent = user.name;
  if (dropdownEmail) dropdownEmail.textContent = user.email;
  if (dropdownRolePill) {
    dropdownRolePill.textContent = user.role;
    dropdownRolePill.className = `role-pill ${profile.badgeClass}`;
  }
  if (dropdownAgency) dropdownAgency.textContent = user.agency || profile.agency;
  if (dropdownBadge) dropdownBadge.textContent = user.badgeNumber || user.badge || profile.badge;

  // Operational Role Banner
  const roleBanner = document.getElementById('roleBanner');
  const roleBannerText = document.getElementById('roleBannerText');
  const roleBannerIcon = document.getElementById('roleBannerIcon');

  if (roleBanner) {
    roleBanner.className = `role-banner ${profile.bannerClass}`;
  }
  if (roleBannerText) {
    roleBannerText.innerHTML = `Operational Mode: <strong>${user.role}</strong> &nbsp;•&nbsp; ${user.agency || profile.agency} &nbsp;•&nbsp; ${profile.roleDesc}`;
  }
  if (roleBannerIcon) {
    roleBannerIcon.className = `ph-fill ${profile.icon}`;
  }

  // Switch Interface according to Role Privileges
  applyRolePrivileges(user);
}

function applyRolePrivileges(user) {
  const dashboardView = document.getElementById('dashboardView');
  const responderView = document.getElementById('responderView');
  const civilianView = document.getElementById('civilianView');
  const openAuditBtn = document.getElementById('openAuditBtn');
  const comingSoonView = document.getElementById('comingSoonView');

  if (comingSoonView) comingSoonView.style.display = 'none';

  if (user.role === 'ADMIN') {
    if (dashboardView) dashboardView.style.display = 'grid';
    if (responderView) responderView.style.display = 'none';
    if (civilianView) civilianView.style.display = 'none';
    if (openAuditBtn) openAuditBtn.style.display = 'inline-flex';
    renderAll();
  } else if (user.role === 'COORDINATOR') {
    if (dashboardView) dashboardView.style.display = 'grid';
    if (responderView) responderView.style.display = 'none';
    if (civilianView) civilianView.style.display = 'none';
    if (openAuditBtn) openAuditBtn.style.display = 'none';
    renderAll();
  } else if (user.role === 'RESPONDER') {
    if (dashboardView) dashboardView.style.display = 'none';
    if (responderView) responderView.style.display = 'grid';
    if (civilianView) civilianView.style.display = 'none';
    if (openAuditBtn) openAuditBtn.style.display = 'none';
    setupResponderView();
  } else if (user.role === 'CIVILIAN') {
    if (dashboardView) dashboardView.style.display = 'none';
    if (responderView) responderView.style.display = 'none';
    if (civilianView) civilianView.style.display = 'grid';
    if (openAuditBtn) openAuditBtn.style.display = 'none';
    setupCivilianView();
  }
}

function setupResponderView() {
  const assignedMissionContent = document.getElementById('assignedMissionContent');
  const responderStatusBtnGroup = document.getElementById('responderStatusBtnGroup');
  
  const activeInc = state.incidents.find(i => i.status === 'dispatched') || state.incidents[0] || {
    id: 'INC-1002',
    type: 'Medical',
    location: 'Connaught Place Sector 4',
    severity: 'critical',
    time: 'Just now'
  };

  if (assignedMissionContent) {
    assignedMissionContent.innerHTML = `
      <div class="mission-headline">
        <i class="ph-fill ph-ambulance" style="color: #f59e0b;"></i>
        ${activeInc.type} Emergency: ${activeInc.id}
      </div>
      <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">
        Target Location: <strong>${activeInc.location || 'Connaught Place'}</strong>. High severity trauma situation requiring rapid ALS triage and transport.
      </p>
      <div class="mission-details-grid">
        <div><strong>Incident ID</strong> ${activeInc.id}</div>
        <div><strong>Priority Level</strong> <span class="text-red">Critical (P1)</span></div>
        <div><strong>Est. Casualties</strong> 4 individuals</div>
        <div><strong>ETA to Scene</strong> ~3.2 minutes</div>
      </div>
      <div class="mission-actions">
        <button class="btn-mission-step primary" onclick="updateResponderMissionState('en_route')">
          <i class="ph-fill ph-navigation-arrow"></i> En Route
        </button>
        <button class="btn-mission-step" onclick="updateResponderMissionState('on_scene')">
          <i class="ph-fill ph-check-circle"></i> On Scene
        </button>
        <button class="btn-mission-step" onclick="updateResponderMissionState('completed')">
          <i class="ph-fill ph-flag-checkered"></i> Completed
        </button>
      </div>
    `;
  }

  // Bind responder status buttons
  if (responderStatusBtnGroup) {
    const buttons = responderStatusBtnGroup.querySelectorAll('.status-btn');
    buttons.forEach(btn => {
      btn.onclick = () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const st = btn.getAttribute('data-unit-status');
        if (state.resources[0]) {
          state.resources[0].status = (st === 'available') ? 'available' : 'busy';
          updateMetrics();
        }
      };
    });
  }

  // Backup buttons (Section 4.8)
  const reqFire = document.getElementById('requestFireBackupBtn');
  const reqPolice = document.getElementById('requestPoliceBackupBtn');
  const backupAlert = document.getElementById('backupAlert');

  if (reqFire) {
    reqFire.onclick = () => {
      const fireRes = state.resources.find(r => r.type === 'fire');
      if (fireRes) fireRes.status = 'busy';
      updateMetrics();
      if (backupAlert) {
        backupAlert.style.display = 'block';
        backupAlert.innerHTML = '<i class="ph-fill ph-check-circle"></i> Fire & Rescue Reinforcement dispatched to scene (Fire Engine 14).';
        setTimeout(() => { backupAlert.style.display = 'none'; }, 5000);
      }
    };
  }

  if (reqPolice) {
    reqPolice.onclick = () => {
      const polRes = state.resources.find(r => r.type === 'police');
      if (polRes) polRes.status = 'busy';
      updateMetrics();
      if (backupAlert) {
        backupAlert.style.display = 'block';
        backupAlert.innerHTML = '<i class="ph-fill ph-check-circle"></i> Police Perimeter unit deployed to scene (Cruiser 09).';
        setTimeout(() => { backupAlert.style.display = 'none'; }, 5000);
      }
    };
  }
}

window.updateResponderMissionState = (stateName) => {
  const badge = document.getElementById('assignedPriorityBadge');
  if (badge) {
    if (stateName === 'en_route') {
      badge.textContent = 'UNIT EN ROUTE';
      badge.style.background = 'rgba(245, 158, 11, 0.2)';
      badge.style.color = '#f59e0b';
    } else if (stateName === 'on_scene') {
      badge.textContent = 'UNIT ON SCENE';
      badge.style.background = 'rgba(6, 182, 212, 0.2)';
      badge.style.color = '#06b6d4';
    } else if (stateName === 'completed') {
      badge.textContent = 'MISSION RESOLVED';
      badge.style.background = 'rgba(16, 185, 129, 0.2)';
      badge.style.color = '#10b981';
      if (state.resources[0]) state.resources[0].status = 'available';
      updateMetrics();
    }
  }
};

let activeCivilianIncident = null;

function setupCivilianView() {
  const civilianTrackerContent = document.getElementById('civilianTrackerContent');
  const civilianStatusBadge = document.getElementById('civilianStatusBadge');
  const civilianSOSForm = document.getElementById('civilianSOSForm');
  const sosTypeSelector = document.getElementById('sosTypeSelector');

  // Bind category pills
  if (sosTypeSelector) {
    const pills = sosTypeSelector.querySelectorAll('.type-pill');
    pills.forEach(pill => {
      pill.onclick = (e) => {
        e.preventDefault();
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      };
    });
  }

  const renderTracker = () => {
    if (!civilianTrackerContent) return;
    if (!activeCivilianIncident) {
      if (civilianStatusBadge) civilianStatusBadge.textContent = 'STANDBY';
      civilianTrackerContent.innerHTML = `
        <div style="text-align: center; padding: 24px 10px; color: var(--text-dim);">
          <i class="ph-fill ph-shield-check" style="font-size: 38px; color: #10b981; margin-bottom: 8px;"></i>
          <h4 style="color: var(--text-main); margin-bottom: 4px;">No Active Emergency</h4>
          <p style="font-size: 12px;">Submit the SOS form on the left if you require immediate emergency assistance.</p>
        </div>
      `;
    } else {
      if (civilianStatusBadge) civilianStatusBadge.textContent = activeCivilianIncident.status.toUpperCase();
      civilianTrackerContent.innerHTML = `
        <div class="tracker-timeline">
          <div class="tracker-step completed">
            <strong>1. SOS Received & Validated</strong>
            <span>Reported at ${activeCivilianIncident.time} • ${activeCivilianIncident.type}</span>
          </div>
          <div class="tracker-step completed">
            <strong>2. Responders Dispatched</strong>
            <span>Paramedic Unit Alpha (MEDIC-01) assigned to your location</span>
          </div>
          <div class="tracker-step ${activeCivilianIncident.status === 'on_scene' ? 'completed' : 'active'}">
            <strong>3. En Route to Your Position</strong>
            <span>Estimated arrival: ~2 minutes. Keep your line open.</span>
          </div>
          <div class="tracker-step ${activeCivilianIncident.status === 'resolved' ? 'completed' : ''}">
            <strong>4. Scene Secured & Rescue Complete</strong>
            <span>Voluntary location sharing terminates automatically upon completion.</span>
          </div>
        </div>
        <button class="btn-cancel-sos" onclick="cancelCivilianSOS()">
          <i class="ph-fill ph-x-circle"></i> Cancel SOS / Mark I Am Safe
        </button>
      `;
    }
  };

  renderTracker();

  // Form submission
  if (civilianSOSForm) {
    civilianSOSForm.onsubmit = (e) => {
      e.preventDefault();
      const activePill = sosTypeSelector?.querySelector('.type-pill.active');
      const type = activePill ? activePill.getAttribute('data-type') : 'Medical';
      const affected = document.getElementById('sosAffectedCount')?.value || 1;
      const desc = document.getElementById('sosDescription')?.value || 'Emergency request submitted';
      const consent = document.getElementById('sosLocationConsent')?.checked;

      const inc = {
        id: `SOS-${++incidentCounter}`,
        type: type,
        icon: type === 'Medical' ? 'ph-ambulance' : (type === 'Fire' ? 'ph-fire' : 'ph-shield-warning'),
        severity: 'critical',
        location: 'Connaught Place (Voluntary GPS Pin)',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        coords: { lat: baseLat + 0.005, lng: baseLng - 0.004 },
        status: 'dispatched',
        affected: affected,
        voluntaryGPS: consent
      };

      state.incidents.unshift(inc);
      activeCivilianIncident = inc;
      const res = state.resources.find(r => r.status === 'available');
      if (res) res.status = 'busy';
      
      updateMetrics();
      renderAll();
      renderTracker();
      addMapMarker(inc);
    };
  }
}

window.cancelCivilianSOS = () => {
  if (activeCivilianIncident) {
    state.incidents = state.incidents.filter(i => i.id !== activeCivilianIncident.id);
    activeCivilianIncident = null;
    updateMetrics();
    renderAll();
    setupCivilianView();
  }
};

function setupAuditModal() {
  const openAuditBtn = document.getElementById('openAuditBtn');
  const closeAuditModalBtn = document.getElementById('closeAuditModalBtn');
  const auditModal = document.getElementById('auditModal');
  const auditTableBody = document.getElementById('auditTableBody');
  const purgeLogsBtn = document.getElementById('purgeLogsBtn');

  const logs = [
    { time: '19:42:01', actor: 'COORDINATOR (Sarah Connor)', action: 'DISPATCH_COMMITTED', details: 'Unit MEDIC-01 assigned to INC-1002 (Trauma Crash)' },
    { time: '19:40:15', actor: 'CIVILIAN (Jane Doe)', action: 'VOLUNTARY_LOCATION_STREAM', details: 'GPS pin transmitted: 28.6145 N, 77.2081 E (Sec. 4.11)' },
    { time: '19:35:50', actor: 'ADMIN (Marcus Wright)', action: 'FLEET_STATUS_MODIFIED', details: 'Unit RESCUE-ALPHA status set to AVAILABLE' },
    { time: '19:30:12', actor: 'SYSTEM_DAEMON', action: 'PRIVACY_AUTO_TERMINATION', details: 'INC-1000 resolved; location stream severed' },
    { time: '19:15:00', actor: 'ADMIN (Marcus Wright)', action: 'RETENTION_CHECK', details: 'Scanned 14 location breadcrumbs (48h lifecycle)' }
  ];

  if (auditTableBody) {
    auditTableBody.innerHTML = logs.map(l => `
      <tr>
        <td style="color: var(--text-dim);">${l.time}</td>
        <td><strong style="color: var(--text-main);">${l.actor}</strong></td>
        <td><span class="user-role-badge badge-coordinator">${l.action}</span></td>
        <td style="color: var(--text-secondary);">${l.details}</td>
      </tr>
    `).join('');
  }

  if (openAuditBtn) {
    openAuditBtn.onclick = () => {
      if (auditModal) auditModal.style.display = 'flex';
    };
  }

  if (closeAuditModalBtn) {
    closeAuditModalBtn.onclick = () => {
      if (auditModal) auditModal.style.display = 'none';
    };
  }

  if (purgeLogsBtn) {
    purgeLogsBtn.onclick = () => {
      alert('Section 4.11 Data Retention Policy Executed: All GPS location breadcrumbs older than 48 hours have been purged from the ledger.');
      if (auditTableBody) {
        auditTableBody.innerHTML = `
          <tr>
            <td style="color: var(--text-dim);">${new Date().toLocaleTimeString()}</td>
            <td><strong style="color: #a855f7;">ADMIN (Marcus Wright)</strong></td>
            <td><span class="user-role-badge badge-admin">PRIVACY_PURGE_EXECUTED</span></td>
            <td style="color: #10b981;">Purged stale breadcrumbs older than 48h (Compliant with Section 4.11)</td>
          </tr>
        `;
      }
    };
  }
}

function setupAuthUI() {
  const profileContainer = document.querySelector('.profile-container');
  const userProfileBtn = document.getElementById('userProfileBtn');
  const profileDropdown = document.getElementById('profileDropdown');
  const authModal = document.getElementById('authModal');
  const openAuthModalBtn = document.getElementById('openAuthModalBtn');
  const quickAuthBtn = document.getElementById('quickAuthBtn');
  const bannerSwitchBtn = document.getElementById('bannerSwitchBtn');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const authLoginForm = document.getElementById('authLoginForm');
  const authAlert = document.getElementById('authAlert');

  setupAuditModal();

  // Toggle Dropdown
  if (userProfileBtn && profileDropdown) {
    userProfileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = profileDropdown.style.display === 'block';
      profileDropdown.style.display = isVisible ? 'none' : 'block';
    });

    document.addEventListener('click', (e) => {
      if (profileContainer && !profileContainer.contains(e.target)) {
        profileDropdown.style.display = 'none';
      }
    });
  }

  // Open/Close Modal
  const openModal = () => {
    if (profileDropdown) profileDropdown.style.display = 'none';
    if (authModal) authModal.style.display = 'flex';
    if (authAlert) authAlert.style.display = 'none';
  };

  const closeModal = () => {
    if (authModal) authModal.style.display = 'none';
  };

  if (openAuthModalBtn) openAuthModalBtn.addEventListener('click', openModal);
  if (quickAuthBtn) quickAuthBtn.addEventListener('click', openModal);
  if (bannerSwitchBtn) bannerSwitchBtn.addEventListener('click', openModal);
  if (closeAuthModalBtn) closeAuthModalBtn.addEventListener('click', closeModal);

  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeModal();
    });
  }

  // Quick Demo Account Cards
  const roleCards = document.querySelectorAll('.role-card');
  roleCards.forEach(card => {
    card.addEventListener('click', () => {
      const role = card.getAttribute('data-role');
      const profile = DEMO_PROFILES[role];
      if (profile) {
        updateUserUI(profile);
        closeModal();
      }
    });
  });

  // Login Form Submission
  if (authLoginForm) {
    authLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value.trim();

      try {
        const res = await fetch('http://localhost:3001/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json();
        if (res.ok && data.user) {
          localStorage.setItem('crisiscore_token', data.token);
          updateUserUI(data.user);
          closeModal();
        } else {
          const matchedKey = Object.keys(DEMO_PROFILES).find(k => DEMO_PROFILES[k].email.toLowerCase() === email.toLowerCase());
          if (matchedKey) {
            updateUserUI(DEMO_PROFILES[matchedKey]);
            closeModal();
          } else {
            if (authAlert) {
              authAlert.style.display = 'block';
              authAlert.textContent = data.error || 'Invalid credentials.';
            }
          }
        }
      } catch (_) {
        const matchedKey = Object.keys(DEMO_PROFILES).find(k => DEMO_PROFILES[k].email.toLowerCase() === email.toLowerCase());
        if (matchedKey) {
          updateUserUI(DEMO_PROFILES[matchedKey]);
          closeModal();
        } else {
          if (authAlert) {
            authAlert.style.display = 'block';
            authAlert.textContent = 'Backend offline. Select one of the Demo Accounts below.';
          }
        }
      }
    });
  }

  // Reset to Admin
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      updateUserUI(DEMO_PROFILES.ADMIN);
      if (profileDropdown) profileDropdown.style.display = 'none';
    });
  }

  // Initialize UI with current user
  updateUserUI(currentUser);
}

// --- Initialization & Simulation Loop ---
function init() {
  initMap();
  setupNavigation();
  setupAuthUI();
  updateMetrics();
  renderAll();
  
  // Initial seed
  generateIncident();
  generateIncident();

  // Simulation Loop
  setInterval(() => {
    if (Math.random() > 0.7) {
      generateIncident();
    }
  }, 5000);
}

document.addEventListener('DOMContentLoaded', init);


