import './style.css';
import { io } from 'socket.io-client';
import { getApiBase } from './apiConfig.js';

// --- State Management ---
let socket = null;
const baseLat = 28.6139; // Delhi center
const baseLng = 77.2090;

const state = {
  incidents: [],
  resources: [],
  metrics: {
    activeCrises: 0,
    unitsDeployed: 0,
    avgResponse: '3m 45s'
  }
};

let map;
let markersLayer;
let mapMarkers = {};

// Active Chat States
let activeOpsChatIncidentId = null;
let activeResponderChannel = 'OPS'; // 'OPS' or 'CIVILIAN'
let currentActiveResponderAssignment = null;

// --- DOM Elements ---
const incidentFeedEl = document.getElementById('incidentFeed');
const incidentCountEl = document.getElementById('incidentCount');
const resourceListEl = document.getElementById('resourceList');
const metricsContainerEl = document.getElementById('metricsContainer');

// --- Helper Functions ---
const getIconForType = (type) => {
  const t = (type || '').toLowerCase();
  if (t.includes('ambulance') || t.includes('medical')) return 'ph-ambulance';
  if (t.includes('fire')) return 'ph-fire-truck';
  if (t.includes('drone')) return 'ph-airplane-tilt';
  if (t.includes('police')) return 'ph-shield-warning';
  return 'ph-truck';
};

function formatIncident(dbInc) {
  const typeStr = dbInc.type ? dbInc.type.charAt(0) + dbInc.type.slice(1).toLowerCase().replace('_', ' ') : 'Medical';
  const assigned = dbInc.assignments && dbInc.assignments.length > 0 ? dbInc.assignments[0] : null;

  return {
    id: dbInc.incidentNumber || `INC-${dbInc.id.slice(0, 5)}`,
    dbId: dbInc.id,
    type: typeStr,
    icon: dbInc.type === 'MEDICAL' ? 'ph-ambulance' : (dbInc.type === 'FIRE' ? 'ph-fire' : 'ph-shield-warning'),
    severity: (dbInc.predictedPriority || dbInc.severity || 'HIGH').toLowerCase(),
    location: dbInc.address || `Sector Lat ${dbInc.lat.toFixed(3)}, Lng ${dbInc.lng.toFixed(3)}`,
    time: new Date(dbInc.reportedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    coords: { lat: dbInc.lat, lng: dbInc.lng },
    status: (dbInc.status || 'REPORTED').toLowerCase(),
    affected: dbInc.affectedCount || 1,
    description: dbInc.description || '',
    assignment: assigned,
    assignedResponder: assigned?.responder || null
  };
}

// --- Map Initialization ---
function initMap() {
  if (map || typeof L === 'undefined') return;

  map = L.map('tacticalMap', {
    center: [baseLat, baseLng],
    zoom: 12,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'tactical-dark-tiles',
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

// --- Backend Data Loading ---
async function loadBackendData() {
  try {
    // 1. Fetch Registered Responders from DB
    const respRes = await fetch('/api/responders');
    if (respRes.ok) {
      const respData = await respRes.json();
      state.resources = respData.responders.map(r => ({
        id: r.id,
        callsign: r.callsign,
        name: r.name,
        type: r.type || 'MEDICAL_AMBULANCE',
        status: (r.status || 'AVAILABLE').toLowerCase(),
        lat: r.lat,
        lng: r.lng,
        user: r.user
      }));
    }

    // 2. Fetch Active Incidents from DB
    const incRes = await fetch('/api/incidents');
    if (incRes.ok) {
      const incData = await incRes.json();
      state.incidents = incData.incidents.map(inc => formatIncident(inc));

      if (markersLayer) {
        markersLayer.clearLayers();
        mapMarkers = {};
        state.incidents.forEach(inc => addMapMarker(inc));
      }
    }

    // 3. Update Coordinator Comms Dock incident options
    const commsSelect = document.getElementById('commsIncidentSelect');
    if (commsSelect) {
      const activeIncs = state.incidents.filter(i => i.status !== 'resolved' && i.status !== 'cancelled');
      const currVal = commsSelect.value || activeOpsChatIncidentId;
      commsSelect.innerHTML = '<option value="">-- Select Active Dispatched Incident to Chat --</option>' +
        activeIncs.map(i => `<option value="${i.dbId || i.id}" ${currVal === (i.dbId || i.id) ? 'selected' : ''}>${i.id}: ${escapeHtml(i.description?.slice(0, 30) || 'Incident')} (${i.status.toUpperCase()})</option>`).join('');
      if (!activeOpsChatIncidentId && activeIncs.length > 0) {
        activeOpsChatIncidentId = activeIncs[0].dbId || activeIncs[0].id;
        commsSelect.value = activeOpsChatIncidentId;
        loadDirectCoordinatorChat(activeOpsChatIncidentId);
      }
    }

    updateMetrics();
    renderAll();
  } catch (err) {
    console.warn('Backend data load error:', err);
  }
}

// --- Gemini AI Tactical Brief ---
async function generateGeminiBrief(incident) {
  const prompt = `As an emergency response AI, generate a concise 2-sentence tactical brief for a ${incident.severity} severity ${incident.type} incident located at ${incident.location}. Provide immediate tactical advice for first responders.`;

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    
    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    return data.text;
  } catch (err) {
    console.warn('Gemini brief fallback engaged:', err);
    return `Priority ${incident.severity.toUpperCase()} incident in ${incident.location}. Dispatch nearest ${incident.type.toLowerCase()} units immediately and secure a 50m tactical cordon.`;
  }
}

window.getAIBrief = async (id, btnElement) => {
  const incident = state.incidents.find(i => i.id === id);
  if (!incident) return;

  const originalContent = btnElement.innerHTML;
  btnElement.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Generating...';
  btnElement.disabled = true;

  try {
    const briefText = await generateGeminiBrief(incident);
    const card = btnElement.closest('.incident-card');
    let briefContainer = card.querySelector('.ai-brief-container');
    
    if (!briefContainer) {
      briefContainer = document.createElement('div');
      briefContainer.className = 'ai-brief-container';
      card.appendChild(briefContainer);
    }

    briefContainer.innerHTML = `
      <div class="ai-brief-header">
        <i class="ph-fill ph-sparkle neon-sparkle"></i>
        <span>Gemini AI Tactical Advisory</span>
      </div>
      <p class="ai-brief-text">${briefText}</p>
    `;
    briefContainer.classList.add('visible');
  } catch (e) {
    console.error(e);
  } finally {
    btnElement.innerHTML = originalContent;
    btnElement.disabled = false;
  }
};

// --- Coordinator Dispatch Actions ---
window.dispatchUnitToIncident = async (incidentDbId, selectElId) => {
  const selectEl = document.getElementById(selectElId);
  const responderId = selectEl ? selectEl.value : null;

  if (!responderId) {
    alert('Please select an available registered responder unit from the dropdown.');
    return;
  }

  try {
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId: incidentDbId, responderId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to dispatch unit.');

    await loadBackendData();
  } catch (err) {
    alert(`Dispatch error: ${err.message}`);
  }
};

// --- Render Metrics & Panels ---
function updateMetrics() {
  state.metrics.activeCrises = state.incidents.filter(i => !['resolved', 'cancelled'].includes(i.status)).length;
  state.metrics.unitsDeployed = state.resources.filter(r => r.status !== 'available').length;
  
  if (metricsContainerEl) {
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
}

function renderIncidents() {
  if (!incidentCountEl || !incidentFeedEl) return;
  incidentCountEl.textContent = state.incidents.length;

  const availableResponders = state.resources.filter(r => r.status === 'available');

  incidentFeedEl.innerHTML = state.incidents.map(inc => {
    const isClosed = ['resolved', 'cancelled'].includes(inc.status);
    const isDispatched = ['dispatched', 'en_route', 'on_scene'].includes(inc.status);
    const assignedCallsign = inc.assignedResponder ? inc.assignedResponder.callsign : (inc.assignment ? 'MEDIC-01' : null);

    return `
      <div class="incident-card severity-${inc.severity}">
        <div class="incident-header">
          <div class="incident-type">
            <i class="ph ${inc.icon}"></i> ${inc.type} Incident
          </div>
          <div class="incident-time">${inc.time}</div>
        </div>
        <div class="incident-title">${inc.id} reported at ${inc.location}</div>
        <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">
          Status: <strong style="text-transform: uppercase; color: var(--cyan);">${inc.status}</strong> • Casualties: ${inc.affected}
        </div>
        
        <div class="incident-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn-dispatch btn-brief" onclick="getAIBrief('${inc.id}', this)">
            <i class="ph ph-chat-text"></i> Brief
          </button>
          
          ${isDispatched ? `
            <span class="user-role-badge badge-responder" style="padding: 4px 8px;">
              <i class="ph-fill ph-ambulance"></i> Assigned: ${assignedCallsign || 'Unit'}
            </span>
            <button class="btn-open-ops-chat" onclick="openTacticalOpsChat('${inc.dbId}', '${inc.id}', '${assignedCallsign || 'Unit'}')">
              <i class="ph-fill ph-chats-circle"></i> Ops Chat
            </button>
          ` : (isClosed ? `
            <span class="user-role-badge badge-civilian" style="padding: 4px 8px;">Closed / Secured</span>
          ` : '')}
        </div>

        ${!isDispatched && !isClosed && (!currentUser || currentUser?.role === 'COORDINATOR' || currentUser?.role === 'ADMIN') ? `
          <div class="incident-dispatch-box">
            <select class="select-responder" id="sel_resp_${inc.dbId}">
              <option value="">-- Assign Unit (${availableResponders.length} available) --</option>
              ${availableResponders.map(r => `
                <option value="${r.id}">${r.callsign} — ${r.name} (${r.type.replace('_', ' ')})</option>
              `).join('')}
            </select>
            <button class="btn-dispatch-unit" onclick="dispatchUnitToIncident('${inc.dbId}', 'sel_resp_${inc.dbId}')">
              <i class="ph-fill ph-paper-plane-tilt"></i> Dispatch
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function renderResources() {
  if (!resourceListEl) return;
  if (state.resources.length === 0) {
    resourceListEl.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--text-dim); font-size: 12px;">
        No registered units available. Click "+ Unit" above to register a respondent.
      </div>
    `;
    return;
  }

  resourceListEl.innerHTML = state.resources.map(res => `
    <div class="resource-item">
      <div class="resource-info">
        <div class="resource-icon">
          <i class="ph ${getIconForType(res.type)}"></i>
        </div>
        <div class="resource-details">
          <h5>${res.callsign} (${res.name})</h5>
          <p>${res.user ? res.user.name : 'Registered Unit'} • ${res.type.replace('_', ' ')}</p>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <div class="resource-status status-${res.status}">
          ${res.status === 'available' ? 'Available' : (res.status === 'assigned' ? 'Assigned' : res.status.toUpperCase())}
        </div>
      </div>
    </div>
  `).join('');
}

function getMarkerColor(incident) {
  if (['resolved', 'cancelled'].includes(incident.status)) return '#9ca3af';
  if (incident.severity === 'critical') return '#ef4444';
  if (incident.severity === 'high') return '#f59e0b';
  return '#06b6d4';
}

function addMapMarker(incident) {
  if (!incident.coords || !incident.coords.lat || !markersLayer) return;
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

function renderAll() {
  renderIncidents();
  renderResources();
}

// --- Dispatcher Real-Time Prompt Toasts ---
function showDispatcherPrompt(actionPayload) {
  const container = document.getElementById('dispatcherPromptsArea');
  if (!container) return;

  container.style.display = 'flex';
  const toast = document.createElement('div');
  const typeClass = (actionPayload.type || 'info').toLowerCase();
  toast.className = `dispatcher-prompt-toast toast-${typeClass}`;

  let icon = 'ph-fill ph-info';
  let headline = 'Field Responder Notification';
  if (actionPayload.type === 'ACCEPTED') {
    icon = 'ph-fill ph-check-circle text-green';
    headline = 'Assignment Accepted';
  } else if (actionPayload.type === 'DECLINED') {
    icon = 'ph-fill ph-x-circle text-red';
    headline = 'Assignment Declined';
  } else if (actionPayload.type === 'EN_ROUTE') {
    icon = 'ph-fill ph-navigation-arrow text-amber';
    headline = 'Unit En Route';
  } else if (actionPayload.type === 'ON_SCENE') {
    icon = 'ph-fill ph-map-pin text-cyan';
    headline = 'Unit Arrived On Scene';
  } else if (actionPayload.type === 'COMPLETED') {
    icon = 'ph-fill ph-flag-checkered text-green';
    headline = 'Mission Completed';
  }

  toast.innerHTML = `
    <div class="prompt-toast-content">
      <i class="${icon}"></i>
      <div>
        <strong>${headline}:</strong>
        <span><strong>${actionPayload.responderName || actionPayload.callsign || 'Unit'}</strong> ${actionPayload.notes || ''} (Incident: ${actionPayload.incidentNumber || ''})</span>
      </div>
    </div>
    <button class="prompt-toast-close" title="Dismiss">&times;</button>
  `;

  toast.querySelector('.prompt-toast-close').onclick = () => toast.remove();
  container.prepend(toast);

  // Auto dismiss after 14 seconds
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
    if (container.children.length === 0) container.style.display = 'none';
  }, 14000);
}

// --- Tactical Ops Chat Modal (Coordinator <-> Responder) ---
window.openTacticalOpsChat = async (incidentDbId, incidentNum, callsign) => {
  activeOpsChatIncidentId = incidentDbId;
  const modal = document.getElementById('tacticalChatModal');
  const title = document.getElementById('tacticalChatTitle');
  const sub = document.getElementById('tacticalChatSubtitle');
  const meta = document.getElementById('tacticalChatMetaBar');
  const stream = document.getElementById('coordinatorChatStream');

  if (title) title.textContent = `Tactical Ops: ${incidentNum}`;
  if (sub) sub.textContent = `Direct secure channel with Unit ${callsign || 'Assigned'}`;
  if (meta) meta.innerHTML = `<span><strong>Channel:</strong> Tactical Ops</span><span><strong>Target Unit:</strong> ${callsign || 'MEDIC-01'}</span>`;
  if (modal) modal.style.display = 'flex';

  if (socket) {
    socket.emit('chat:join', { incidentId: incidentDbId, channel: 'OPS' });
  }

  if (stream) {
    stream.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 20px;">Loading operations log...</div>';
    try {
      const res = await fetch(`/api/chat/${incidentDbId}?channel=OPS`);
      const data = await res.json();
      renderChatStream(stream, data.messages || [], currentUser ? currentUser.name : 'Coordinator');
    } catch (err) {
      stream.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 20px;">No message history.</div>';
    }
  }
};

window.loadDirectCoordinatorChat = async (incidentDbId) => {
  if (!incidentDbId) return;
  activeOpsChatIncidentId = incidentDbId;
  const badge = document.getElementById('commsActiveUnitBadge');
  const stream = document.getElementById('coordinatorDirectChatStream');
  const match = state.incidents.find(i => i.dbId === incidentDbId || i.id === incidentDbId);

  if (badge) {
    badge.textContent = match?.responderCallsign || (match?.id ? match.id : 'ACTIVE');
  }

  if (socket && socket.connected) {
    socket.emit('chat:join', { incidentId: incidentDbId, channel: 'OPS' });
  }

  if (stream) {
    stream.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 20px;">Connecting to tactical line...</div>';
    try {
      const res = await fetch(`/api/chat/${incidentDbId}?channel=OPS`);
      const data = await res.json();
      renderChatStream(stream, data.messages || [], currentUser ? currentUser.name : 'Coordinator');
    } catch (err) {
      stream.innerHTML = '<div class="chat-empty-hint">Direct tactical line open. Transmit orders below.</div>';
    }
  }
};

function renderChatStream(container, messages, currentUserName) {
  if (!container) return;
  if (messages.length === 0) {
    container.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 20px;">No messages sent yet. Direct channel open.</div>';
    return;
  }

  container.innerHTML = messages.map(m => {
    const isSelf = m.senderName === currentUserName || (currentUser && m.senderRole === currentUser.role);
    const time = new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="chat-msg ${isSelf ? 'self' : 'other'}">
        <div class="chat-sender">${m.senderName} (${m.senderRole})</div>
        <div class="chat-bubble">${escapeHtml(m.message)}</div>
        <div class="chat-time">${time}</div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// --- User Profiles & RBAC ---
const DEMO_PROFILES = {
  ADMIN: {
    id: 'usr-admin-01',
    name: 'Marcus Wright',
    email: 'admin@test.com',
    role: 'ADMIN',
    badge: 'ADM-001',
    agency: 'National Emergency Operations Authority',
    avatar: 'https://ui-avatars.com/api/?name=Marcus+Wright&background=a855f7&color=0f172a&bold=true&size=30'
  },
  COORDINATOR: {
    id: 'usr-coord-01',
    name: 'Sarah Connor',
    email: 'coordinator@test.com',
    role: 'COORDINATOR',
    badge: 'COORD-8801',
    agency: 'Central Disaster Coordination Directorate',
    avatar: 'https://ui-avatars.com/api/?name=Sarah+Connor&background=06b6d4&color=0f172a&bold=true&size=30'
  },
  RESPONDER: {
    id: 'usr-resp-01',
    name: 'Capt. Carlos Vance',
    email: 'responder@test.com',
    role: 'RESPONDER',
    badge: 'RESP-4102',
    agency: 'Metro Fire & Rescue Dept (MEDIC-01)',
    avatar: 'https://ui-avatars.com/api/?name=Carlos+Vance&background=f59e0b&color=0f172a&bold=true&size=30'
  },
  CIVILIAN: {
    id: 'usr-civ-01',
    name: 'Jane Doe',
    email: 'civilian@test.com',
    role: 'CIVILIAN',
    badge: 'CITIZEN',
    agency: 'Public Citizen Portal',
    avatar: 'https://ui-avatars.com/api/?name=Jane+Doe&background=10b981&color=0f172a&bold=true&size=30'
  }
};

let currentUser = null;
try {
  const savedUser = localStorage.getItem('crisiscore_user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
  }
} catch (e) {
  currentUser = null;
}

function updateUserUI(user) {
  if (!user) {
    showAuthGate();
    return;
  }
  currentUser = user;
  try {
    localStorage.setItem('crisiscore_user', JSON.stringify(user));
  } catch (e) {}
  hideAuthGate();
  
  const avatarUrl = user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=06b6d4&color=080a11&bold=true&size=30`;
  const topbarUserName = document.getElementById('topbarUserName');
  const topbarUserRole = document.getElementById('topbarUserRole');
  const topbarAvatar = document.getElementById('topbarAvatar');
  const dropdownName = document.getElementById('dropdownName');
  const dropdownEmail = document.getElementById('dropdownEmail');
  const dropdownRolePill = document.getElementById('dropdownRolePill');
  const dropdownAgency = document.getElementById('dropdownAgency');
  const dropdownBadge = document.getElementById('dropdownBadge');

  if (topbarUserName) topbarUserName.textContent = user.name;
  if (topbarUserRole) {
    topbarUserRole.textContent = user.role;
    topbarUserRole.className = `user-role-badge badge-${user.role.toLowerCase()}`;
  }
  if (topbarAvatar) topbarAvatar.src = avatarUrl;
  if (dropdownName) dropdownName.textContent = user.name;
  if (dropdownEmail) dropdownEmail.textContent = user.email;
  if (dropdownRolePill) {
    dropdownRolePill.textContent = user.role;
    dropdownRolePill.className = `role-pill badge-${user.role.toLowerCase()}`;
  }
  if (dropdownAgency) dropdownAgency.textContent = user.agency || 'Emergency Directorate';
  if (dropdownBadge) dropdownBadge.textContent = user.badge || user.badgeNumber || 'AUTH';

  const roleBanner = document.getElementById('roleBanner');
  const roleBannerText = document.getElementById('roleBannerText');
  const roleBannerIcon = document.getElementById('roleBannerIcon');

  if (roleBanner && roleBannerText) {
    roleBanner.className = `role-banner banner-${user.role.toLowerCase()}`;
    if (user.role === 'ADMIN') {
      roleBannerText.innerHTML = `Operational Mode: <strong>ADMIN</strong> &nbsp;•&nbsp; ${user.agency} &nbsp;•&nbsp; Full Fleet Governance & Retention Purging`;
      if (roleBannerIcon) roleBannerIcon.className = 'ph-fill ph-shield-star';
    } else if (user.role === 'COORDINATOR') {
      roleBannerText.innerHTML = `Operational Mode: <strong>COORDINATOR</strong> &nbsp;•&nbsp; ${user.agency} &nbsp;•&nbsp; Tactical Incident & Dispatch Command`;
      if (roleBannerIcon) roleBannerIcon.className = 'ph-fill ph-crosshair';
    } else if (user.role === 'RESPONDER') {
      roleBannerText.innerHTML = `Operational Mode: <strong>FIELD RESPONDER</strong> &nbsp;•&nbsp; ${user.agency} &nbsp;•&nbsp; Unit Telemetry & Scene Action Terminal`;
      if (roleBannerIcon) roleBannerIcon.className = 'ph-fill ph-ambulance';
    } else if (user.role === 'CIVILIAN') {
      roleBannerText.innerHTML = `Operational Mode: <strong>CIVILIAN PORTAL</strong> &nbsp;•&nbsp; Distress Signal Reporting & Voluntary GPS Assistance (Sec. 4.11)`;
      if (roleBannerIcon) roleBannerIcon.className = 'ph-fill ph-user';
    }
  }

  applyRolePrivileges(user);

  if (socket && socket.connected) {
    if (user.role === 'COORDINATOR' || user.role === 'ADMIN') {
      socket.emit('join:coordinator');
    } else if (user.role === 'RESPONDER') {
      socket.emit('join:responder', { responderId: '3084912b-5bdc-4fd3-87bb-fb89a96d50fd' });
    }
  }
}

function openMobileSidebar() {
  const sidebarNav = document.getElementById('sidebarNav');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  if (sidebarNav) sidebarNav.classList.add('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
}

function closeMobileSidebar() {
  const sidebarNav = document.getElementById('sidebarNav');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  if (sidebarNav) sidebarNav.classList.remove('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
}

function switchView(viewName) {
  const dashboardView = document.getElementById('dashboardView');
  const responderView = document.getElementById('responderView');
  const civilianView = document.getElementById('civilianView');
  const comingSoonView = document.getElementById('comingSoonView');
  const navCommandCenter = document.getElementById('navCommandCenter');
  const navSOSPortal = document.getElementById('navSOSPortal');
  const navResponderTerminal = document.getElementById('navResponderTerminal');

  // Automatically close mobile drawer upon navigation
  closeMobileSidebar();

  if (comingSoonView) comingSoonView.style.display = 'none';

  // Deactivate all sidebar nav items & bottom nav items
  document.querySelectorAll('.side-nav .nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mobile-bottom-nav .bnav-item').forEach(el => el.classList.remove('active'));

  if (viewName === 'civilian') {
    if (dashboardView) dashboardView.style.display = 'none';
    if (responderView) responderView.style.display = 'none';
    if (civilianView) civilianView.style.display = 'grid';
    if (navSOSPortal) navSOSPortal.classList.add('active');
    const bnavSOS = document.getElementById('bnavSOS');
    if (bnavSOS) bnavSOS.classList.add('active');
    setupCivilianView();
  } else if (viewName === 'responder') {
    if (dashboardView) dashboardView.style.display = 'none';
    if (responderView) responderView.style.display = 'grid';
    if (civilianView) civilianView.style.display = 'none';
    if (navResponderTerminal) navResponderTerminal.classList.add('active');
    const bnavResponder = document.getElementById('bnavResponder');
    if (bnavResponder) bnavResponder.classList.add('active');
    setupResponderView();
  } else {
    // Default: Command Center dashboard
    if (dashboardView) dashboardView.style.display = 'grid';
    if (responderView) responderView.style.display = 'none';
    if (civilianView) civilianView.style.display = 'none';
    if (navCommandCenter) navCommandCenter.classList.add('active');
    const bnavCommand = document.getElementById('bnavCommand');
    if (bnavCommand) bnavCommand.classList.add('active');
    renderAll();
    if (map) {
      setTimeout(() => map.invalidateSize(), 150);
    }
  }
}

function applyRolePrivileges(user) {
  const openAuditBtn = document.getElementById('openAuditBtn');
  if (openAuditBtn) {
    openAuditBtn.style.display = user.role === 'ADMIN' ? 'inline-flex' : 'none';
  }

  if (user.role === 'RESPONDER') {
    switchView('responder');
  } else if (user.role === 'CIVILIAN') {
    switchView('civilian');
  } else {
    switchView('dashboard');
  }
}

// --- Responder View & Action Terminal ---
async function setupResponderView() {
  const assignedMissionContent = document.getElementById('assignedMissionContent');
  const assignedPriorityBadge = document.getElementById('assignedPriorityBadge');

  let activeAssignment = null;

  try {
    const res = await fetch('/api/assignments');
    if (res.ok) {
      const data = await res.json();
      activeAssignment = data.assignments.find(a => !['COMPLETED', 'CANCELLED', 'DECLINED'].includes(a.status));
      currentActiveResponderAssignment = activeAssignment;
    }
  } catch (e) {
    console.warn('Error fetching assignment for responder:', e);
  }

  if (assignedMissionContent) {
    if (!activeAssignment) {
      if (assignedPriorityBadge) {
        assignedPriorityBadge.textContent = 'STANDBY';
        assignedPriorityBadge.className = 'badge';
      }
      assignedMissionContent.innerHTML = `
        <div style="padding: 24px 12px; text-align: center; color: var(--text-dim);">
          <i class="ph-fill ph-shield-check" style="font-size: 36px; color: var(--green); margin-bottom: 8px;"></i>
          <h4 style="color: var(--text-main); margin-bottom: 4px;">No Active Assignments</h4>
          <p style="font-size: 12px;">Unit MEDIC-01 is currently available and patrolling Sector 4.</p>
        </div>
      `;
    } else {
      const inc = activeAssignment.incident;
      const st = activeAssignment.status;

      if (assignedPriorityBadge) {
        assignedPriorityBadge.textContent = `${inc.predictedPriority || inc.severity || 'HIGH'} PRIORITY`;
        assignedPriorityBadge.className = 'badge badge-critical';
      }

      assignedMissionContent.innerHTML = `
        <div class="mission-headline">
          <i class="ph-fill ph-ambulance" style="color: #f59e0b;"></i>
          ${inc.type} Emergency: ${inc.incidentNumber}
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.4; margin-top: 6px;">
          ${inc.description || 'Emergency assistance requested.'}
        </p>
        <div class="mission-details-grid" style="margin-top: 10px;">
          <div><strong>Incident Number</strong> ${inc.incidentNumber}</div>
          <div><strong>Status</strong> <span style="color: var(--cyan); text-transform: uppercase;">${st}</span></div>
          <div><strong>Casualties</strong> ${inc.affectedCount || 1} individuals</div>
          <div><strong>Contact</strong> ${inc.reporterContact || 'Not provided'}</div>
        </div>

        ${st === 'DISPATCHED' ? `
          <div class="assignment-decision-card">
            <div class="decision-headline">
              <i class="ph-fill ph-warning-octagon text-amber"></i> New Dispatch Order Received
            </div>
            <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px;">
              Accept order to mobilize immediately, or decline if capacity/equipment is constrained.
            </p>
            <div class="decision-buttons">
              <button class="btn-accept-dispatch" onclick="executeAssignmentAction('${activeAssignment.id}', 'ACKNOWLEDGED')">
                <i class="ph-fill ph-check"></i> Accept Assignment
              </button>
              <button class="btn-decline-dispatch" onclick="openDeclineModal('${activeAssignment.id}')">
                <i class="ph-fill ph-x"></i> Decline
              </button>
            </div>
          </div>
        ` : `
          <div class="mission-actions" style="margin-top: 14px;">
            <button class="btn-mission-step ${st === 'EN_ROUTE' ? 'primary' : ''}" onclick="executeAssignmentAction('${activeAssignment.id}', 'EN_ROUTE')">
              <i class="ph-fill ph-navigation-arrow"></i> En Route
            </button>
            <button class="btn-mission-step ${st === 'ON_SCENE' ? 'primary' : ''}" onclick="executeAssignmentAction('${activeAssignment.id}', 'ON_SCENE')">
              <i class="ph-fill ph-check-circle"></i> On Scene
            </button>
            <button class="btn-mission-step" onclick="executeAssignmentAction('${activeAssignment.id}', 'COMPLETED')">
              <i class="ph-fill ph-flag-checkered"></i> Mark Completed
            </button>
          </div>
        `}
      `;
    }
  }

  // Bind Dual-Channel Chat in Responder View
  setupResponderDualChat(activeAssignment?.incidentId);
}

// Assignment Action Execution (Accept, Decline, En Route, On Scene, Completed)
window.executeAssignmentAction = async (assignmentId, targetStatus, declineReason = null) => {
  try {
    const payload = { status: targetStatus };
    if (declineReason) payload.declineReason = declineReason;

    const res = await fetch(`/api/assignments/${assignmentId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update assignment.');

    await loadBackendData();
    setupResponderView();
  } catch (err) {
    alert(`Status update error: ${err.message}`);
  }
};

window.openDeclineModal = (assignmentId) => {
  const modal = document.getElementById('declineAssignmentModal');
  const form = document.getElementById('declineAssignmentForm');
  if (modal) modal.style.display = 'flex';

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const reason = document.getElementById('declineReasonInput')?.value || 'Unavailable';
      modal.style.display = 'none';
      await executeAssignmentAction(assignmentId, 'DECLINED', reason);
    };
  }
};

// Dual-Channel Chat Logic in Responder View
function setupResponderDualChat(incidentId) {
  const tabOps = document.getElementById('tabOpsChat');
  const tabCiv = document.getElementById('tabCivChat');
  const stream = document.getElementById('responderChatStream');
  const form = document.getElementById('responderChatForm');
  const input = document.getElementById('responderChatInput');

  if (!tabOps || !tabCiv || !stream) return;

  const loadChannelMessages = async (channel) => {
    activeResponderChannel = channel;
    tabOps.classList.toggle('active', channel === 'OPS');
    tabCiv.classList.toggle('active', channel === 'CIVILIAN');

    if (!incidentId) {
      stream.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 24px;">No active emergency assignment to chat with.</div>';
      return;
    }

    if (socket) {
      socket.emit('chat:join', { incidentId, channel });
    }

    try {
      const res = await fetch(`/api/chat/${incidentId}?channel=${channel}`);
      const data = await res.json();
      renderChatStream(stream, data.messages || [], currentUser?.name || 'Responder');
    } catch (e) {
      stream.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 24px;">Channel standby.</div>';
    }
  };

  tabOps.onclick = () => loadChannelMessages('OPS');
  tabCiv.onclick = () => {
    const dot = document.getElementById('civUnreadDot');
    if (dot) dot.style.display = 'none';
    loadChannelMessages('CIVILIAN');
  };

  loadChannelMessages(activeResponderChannel);

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input?.value.trim();
      if (!text || !incidentId) return;

      input.value = '';

      if (socket) {
        socket.emit('chat:send', {
          incidentId,
          channel: activeResponderChannel,
          message: text,
          senderName: currentUser?.name || 'Capt. Carlos Vance',
          senderRole: 'RESPONDER'
        });
      } else {
        await fetch(`/api/chat/${incidentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: activeResponderChannel,
            message: text,
            senderName: currentUser?.name || 'Capt. Carlos Vance',
            senderRole: 'RESPONDER'
          })
        });
      }
    };
  }
}

// --- Civilian View in SPA ---
let activeCivilianIncident = null;

function setupCivilianView() {
  const civilianTrackerContent = document.getElementById('civilianTrackerContent');
  const civilianStatusBadge = document.getElementById('civilianStatusBadge');
  const civilianSOSForm = document.getElementById('civilianSOSForm');
  const sosTypeSelector = document.getElementById('sosTypeSelector');

  if (socket && activeCivilianIncident?.dbId) {
    socket.emit('join:incident', { incidentId: activeCivilianIncident.dbId });
    socket.emit('chat:join', { incidentId: activeCivilianIncident.dbId, channel: 'CIVILIAN' });
  }

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
          <div style="margin-top: 14px;">
            <a href="/sos.html" style="color: var(--cyan); font-size: 12px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
              <i class="ph-fill ph-arrow-square-out"></i> Launch Fullscreen Standalone Kiosk Mode
            </a>
          </div>
        </div>
      `;
    } else {
      const st = (activeCivilianIncident.status || 'REPORTED').toUpperCase();
      if (civilianStatusBadge) civilianStatusBadge.textContent = st;
      civilianTrackerContent.innerHTML = `
        <div class="tracker-timeline">
          <div class="tracker-step completed">
            <strong>1. SOS Received & Validated</strong>
            <span>Reported at ${activeCivilianIncident.time} • ${activeCivilianIncident.type} (${activeCivilianIncident.id})</span>
          </div>
          <div class="tracker-step ${['TRIAGED', 'DISPATCHED', 'ON_SCENE', 'RESOLVED'].includes(st) ? 'completed' : 'active'}">
            <strong>2. Dispatch Triage & Verification</strong>
            <span>Priority: ${activeCivilianIncident.severity?.toUpperCase() || 'HIGH'} • Central Dispatch notified</span>
          </div>
          <div class="tracker-step ${['DISPATCHED', 'ON_SCENE', 'RESOLVED'].includes(st) ? 'completed' : ''}">
            <strong>3. Responders Dispatched</strong>
            <span>${activeCivilianIncident.responderCallsign ? `Unit ${activeCivilianIncident.responderCallsign} en route` : 'Assigning nearest response unit...'}</span>
          </div>
          <div class="tracker-step ${['ON_SCENE', 'RESOLVED'].includes(st) ? 'completed' : ''}">
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

  if (civilianSOSForm) {
    civilianSOSForm.onsubmit = async (e) => {
      e.preventDefault();
      const activePill = sosTypeSelector?.querySelector('.type-pill.active');
      const type = activePill ? activePill.getAttribute('data-type') : 'Medical';
      const affected = document.getElementById('sosAffectedCount')?.value || 1;
      const contactPhone = document.getElementById('sosContact')?.value || '';
      const desc = document.getElementById('sosDescription')?.value || 'Emergency assistance requested via Civilian Portal.';
      const consent = document.getElementById('sosLocationConsent')?.checked;

      const submitBtn = civilianSOSForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> TRANSMITTING SOS...';
      }

      try {
        let incidentLat = baseLat + 0.005;
        let incidentLng = baseLng - 0.004;
        let locSource = 'MANUAL';

        if (consent && typeof navigator !== 'undefined' && navigator.geolocation) {
          try {
            const pos = await new Promise((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 10000
              });
            });
            incidentLat = pos.coords.latitude;
            incidentLng = pos.coords.longitude;
            locSource = 'GPS';
          } catch (posErr) {
            console.warn('GPS location lookup skipped or timed out, using fallback coordinates:', posErr);
          }
        }

        const payload = {
          type: type.toUpperCase(),
          affectedCount: parseInt(affected, 10),
          severity: 'HIGH',
          description: desc,
          reporterContact: contactPhone,
          lat: incidentLat,
          lng: incidentLng,
          source: locSource,
          locationSharingActive: Boolean(consent)
        };

        const res = await fetch('/api/incidents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        const serverInc = data.incident;

        const inc = {
          id: serverInc ? serverInc.incidentNumber : `SOS-${Date.now()}`,
          dbId: serverInc?.id,
          type: type,
          icon: type === 'Medical' ? 'ph-ambulance' : (type === 'Fire' ? 'ph-fire' : 'ph-shield-warning'),
          severity: 'critical',
          location: serverInc?.address || 'Connaught Place (Voluntary GPS Pin)',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          coords: { lat: serverInc?.lat || (baseLat + 0.005), lng: serverInc?.lng || (baseLng - 0.004) },
          status: serverInc?.status || 'REPORTED',
          affected: affected,
          voluntaryGPS: consent
        };

        state.incidents.unshift(inc);
        activeCivilianIncident = inc;
        
        if (socket && inc.dbId) {
          socket.emit('join:incident', { incidentId: inc.dbId });
          socket.emit('chat:join', { incidentId: inc.dbId, channel: 'CIVILIAN' });
        }

        updateMetrics();
        renderAll();
        renderTracker();
        addMapMarker(inc);
      } catch (err) {
        console.warn('Backend SOS submission error:', err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="ph-fill ph-phone-call"></i> TRANSMIT EMERGENCY SOS';
        }
      }
    };
  }

  // Civilian Live Chat Dock Wiring
  const civChatStream = document.getElementById('civilianViewChatStream');
  const civChatForm = document.getElementById('civilianViewChatForm');
  const civChatInput = document.getElementById('civilianViewChatInput');

  if (activeCivilianIncident?.dbId && civChatStream) {
    fetch(`/api/chat/${activeCivilianIncident.dbId}?channel=CIVILIAN`)
      .then(res => res.json())
      .then(data => {
        if (data.messages && data.messages.length > 0) {
          const hint = civChatStream.querySelector('.chat-empty-hint');
          if (hint) hint.remove();
          renderChatStream(civChatStream, data.messages, currentUser?.name || 'Civilian');
        }
      })
      .catch(e => console.warn('Could not load civilian chat history:', e));
  }

  if (civChatForm) {
    civChatForm.onsubmit = async (e) => {
      e.preventDefault();
      const text = civChatInput?.value.trim();
      if (!text) return;
      if (!activeCivilianIncident?.dbId) {
        alert('Please submit an emergency SOS request first to communicate with arriving rescue units.');
        return;
      }

      civChatInput.value = '';

      const payload = {
        incidentId: activeCivilianIncident.dbId,
        channel: 'CIVILIAN',
        message: text,
        senderName: currentUser?.name || 'Civilian (Reporter)',
        senderRole: 'CIVILIAN'
      };

      if (socket && socket.connected) {
        socket.emit('chat:send', payload);
      } else {
        await fetch(`/api/chat/${activeCivilianIncident.dbId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
    };
  }
}

window.cancelCivilianSOS = async () => {
  if (activeCivilianIncident) {
    if (activeCivilianIncident.dbId) {
      try {
        await fetch(`/api/incidents/${activeCivilianIncident.dbId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Civilian marked safe via UI' })
        });
      } catch (e) {
        console.warn('Error cancelling incident on server:', e);
      }
    }
    state.incidents = state.incidents.filter(i => i.id !== activeCivilianIncident.id);
    activeCivilianIncident = null;
    updateMetrics();
    renderAll();
    setupCivilianView();
  }
};

// --- Modals & Navigation Wiring ---
function setupModals() {
  // 1. Audit Modal
  const openAuditBtn = document.getElementById('openAuditBtn');
  const closeAuditModalBtn = document.getElementById('closeAuditModalBtn');
  const auditModal = document.getElementById('auditModal');

  if (openAuditBtn) openAuditBtn.onclick = () => { if (auditModal) auditModal.style.display = 'flex'; };
  if (closeAuditModalBtn) closeAuditModalBtn.onclick = () => { if (auditModal) auditModal.style.display = 'none'; };

  // 2. Tactical Chat Modal
  const closeTacticalChatModalBtn = document.getElementById('closeTacticalChatModalBtn');
  const tacticalChatModal = document.getElementById('tacticalChatModal');
  const coordinatorChatForm = document.getElementById('coordinatorChatForm');
  const coordinatorChatInput = document.getElementById('coordinatorChatInput');

  if (closeTacticalChatModalBtn) closeTacticalChatModalBtn.onclick = () => {
    if (tacticalChatModal) tacticalChatModal.style.display = 'none';
  };

  if (coordinatorChatForm) {
    coordinatorChatForm.onsubmit = async (e) => {
      e.preventDefault();
      const text = coordinatorChatInput?.value.trim();
      if (!text || !activeOpsChatIncidentId) return;

      coordinatorChatInput.value = '';

      if (socket) {
        socket.emit('chat:send', {
          incidentId: activeOpsChatIncidentId,
          channel: 'OPS',
          message: text,
          senderName: currentUser?.name || 'Coordinator',
          senderRole: currentUser?.role || 'COORDINATOR'
        });
      } else {
        await fetch(`/api/chat/${activeOpsChatIncidentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'OPS',
            message: text,
            senderName: currentUser?.name || 'Coordinator',
            senderRole: currentUser?.role || 'COORDINATOR'
          })
        });
      }
    };
  }

  // 3. Register Respondent Modal
  const openAddResponderModalBtn = document.getElementById('openAddResponderModalBtn');
  const closeRegisterResponderModalBtn = document.getElementById('closeRegisterResponderModalBtn');
  const registerResponderModal = document.getElementById('registerResponderModal');
  const registerResponderForm = document.getElementById('registerResponderForm');
  const regRespAlert = document.getElementById('regRespAlert');

  if (openAddResponderModalBtn) {
    openAddResponderModalBtn.onclick = () => {
      if (registerResponderModal) registerResponderModal.style.display = 'flex';
    };
  }
  if (closeRegisterResponderModalBtn) {
    closeRegisterResponderModalBtn.onclick = () => {
      if (registerResponderModal) registerResponderModal.style.display = 'none';
    };
  }

  if (registerResponderForm) {
    registerResponderForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('regRespName')?.value.trim();
      const callsign = document.getElementById('regRespCallsign')?.value.trim();
      const type = document.getElementById('regRespType')?.value;
      const email = document.getElementById('regRespEmail')?.value.trim();
      const agency = document.getElementById('regRespAgency')?.value.trim();

      const submitBtn = document.getElementById('regRespSubmitBtn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Registering...';
      }

      try {
        const res = await fetch('/api/responders/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            callsign,
            type,
            email,
            agency: agency || 'Emergency Response Fleet'
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed.');

        if (regRespAlert) {
          regRespAlert.style.display = 'block';
          regRespAlert.className = 'auth-alert success';
          regRespAlert.textContent = `Unit ${callsign.toUpperCase()} successfully registered and active in fleet!`;
        }

        setTimeout(() => {
          if (registerResponderModal) registerResponderModal.style.display = 'none';
          if (regRespAlert) regRespAlert.style.display = 'none';
          registerResponderForm.reset();
        }, 1200);

        await loadBackendData();
      } catch (err) {
        if (regRespAlert) {
          regRespAlert.style.display = 'block';
          regRespAlert.className = 'auth-alert error';
          regRespAlert.textContent = err.message;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Register & Add to Available Fleet</span> <i class="ph ph-check"></i>';
        }
      }
    };
  }

  // 4. Decline Assignment Modal Close
  const closeDeclineModalBtn = document.getElementById('closeDeclineModalBtn');
  const declineAssignmentModal = document.getElementById('declineAssignmentModal');
  if (closeDeclineModalBtn) {
    closeDeclineModalBtn.onclick = () => {
      if (declineAssignmentModal) declineAssignmentModal.style.display = 'none';
    };
  }

  // 5. Coordinator Comms Dock Wiring
  setupCoordinatorCommsDock();

  // 6. Navigation Bar & View Handlers
  setupNavHandlers();

  // 7. Auth Gate & Session Management
  setupAuthUI();
}

function setupNavHandlers() {
  const navCommandCenter = document.getElementById('navCommandCenter');
  const navSOSPortal = document.getElementById('navSOSPortal');
  const navResponderTerminal = document.getElementById('navResponderTerminal');
  const navFullMap = document.getElementById('navFullMap');
  const navFleet = document.getElementById('navFleet');
  const navAuditLogs = document.getElementById('navAuditLogs');
  const topbarSOSBtn = document.getElementById('topbarSOSBtn');

  if (navCommandCenter) {
    navCommandCenter.onclick = (e) => {
      e.preventDefault();
      switchView('dashboard');
    };
  }

  if (navSOSPortal) {
    navSOSPortal.onclick = (e) => {
      e.preventDefault();
      switchView('civilian');
    };
  }

  if (topbarSOSBtn) {
    topbarSOSBtn.onclick = (e) => {
      e.preventDefault();
      switchView('civilian');
    };
  }

  if (navResponderTerminal) {
    navResponderTerminal.onclick = (e) => {
      e.preventDefault();
      switchView('responder');
    };
  }

  if (navFullMap) {
    navFullMap.onclick = (e) => {
      e.preventDefault();
      switchView('dashboard');
      const mapEl = document.getElementById('tacticalMap');
      if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth' });
    };
  }

  if (navFleet) {
    navFleet.onclick = (e) => {
      e.preventDefault();
      switchView('dashboard');
      const fleetEl = document.getElementById('resourceList');
      if (fleetEl) fleetEl.scrollIntoView({ behavior: 'smooth' });
    };
  }

  if (navAuditLogs) {
    navAuditLogs.onclick = (e) => {
      e.preventDefault();
      closeMobileSidebar();
      const auditModal = document.getElementById('auditModal');
      if (auditModal) auditModal.style.display = 'flex';
    };
  }

  // Mobile Drawer Open / Close Handlers
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');

  if (mobileMenuToggle) {
    mobileMenuToggle.onclick = (e) => {
      e.preventDefault();
      openMobileSidebar();
    };
  }

  if (sidebarCloseBtn) {
    sidebarCloseBtn.onclick = (e) => {
      e.preventDefault();
      closeMobileSidebar();
    };
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.onclick = (e) => {
      e.preventDefault();
      closeMobileSidebar();
    };
  }

  // Mobile Bottom Navigation Bar Buttons
  const bnavCommand = document.getElementById('bnavCommand');
  const bnavMap = document.getElementById('bnavMap');
  const bnavSOS = document.getElementById('bnavSOS');
  const bnavResponder = document.getElementById('bnavResponder');
  const bnavMenu = document.getElementById('bnavMenu');

  if (bnavCommand) {
    bnavCommand.onclick = (e) => {
      e.preventDefault();
      switchView('dashboard');
    };
  }

  if (bnavMap) {
    bnavMap.onclick = (e) => {
      e.preventDefault();
      switchView('dashboard');
      document.querySelectorAll('.mobile-bottom-nav .bnav-item').forEach(el => el.classList.remove('active'));
      bnavMap.classList.add('active');
      const mapEl = document.getElementById('map') || document.querySelector('.map-panel');
      if (mapEl) {
        mapEl.scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => { if (map) map.invalidateSize(); }, 200);
      }
    };
  }

  if (bnavSOS) {
    bnavSOS.onclick = (e) => {
      e.preventDefault();
      switchView('civilian');
    };
  }

  if (bnavResponder) {
    bnavResponder.onclick = (e) => {
      e.preventDefault();
      switchView('responder');
    };
  }

  if (bnavMenu) {
    bnavMenu.onclick = (e) => {
      e.preventDefault();
      openMobileSidebar();
    };
  }
}

function showAuthGate() {
  const gate = document.getElementById('authGateScreen');
  if (gate) gate.style.display = 'flex';
  const profileDropdown = document.getElementById('profileDropdown');
  if (profileDropdown) profileDropdown.style.display = 'none';
}

function hideAuthGate() {
  const gate = document.getElementById('authGateScreen');
  if (gate) gate.style.display = 'none';
}

function handleLogout() {
  try {
    localStorage.removeItem('crisiscore_token');
    localStorage.removeItem('crisiscore_user');
  } catch (e) {}
  currentUser = null;
  const profileDropdown = document.getElementById('profileDropdown');
  if (profileDropdown) profileDropdown.style.display = 'none';
  showAuthGate();
}

function setupCoordinatorCommsDock() {
  const commsSelect = document.getElementById('commsIncidentSelect');
  const form = document.getElementById('coordinatorDirectChatForm');
  const input = document.getElementById('coordinatorDirectChatInput');
  const quickChips = document.getElementById('coordinatorQuickChips');

  if (quickChips && input) {
    quickChips.querySelectorAll('.quick-chip').forEach(chip => {
      chip.onclick = () => {
        input.value = chip.getAttribute('data-msg');
        input.focus();
      };
    });
  }

  if (commsSelect) {
    commsSelect.onchange = () => {
      if (commsSelect.value) {
        loadDirectCoordinatorChat(commsSelect.value);
      }
    };
  }

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input?.value.trim();
      if (!text) return;
      if (!activeOpsChatIncidentId) {
        alert('Please select an active incident from the dropdown above to transmit orders.');
        return;
      }

      input.value = '';

      if (socket && socket.connected) {
        socket.emit('chat:send', {
          incidentId: activeOpsChatIncidentId,
          channel: 'OPS',
          message: text,
          senderName: currentUser ? currentUser.name : 'Coordinator',
          senderRole: 'COORDINATOR'
        });
      } else {
        await fetch(`/api/chat/${activeOpsChatIncidentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'OPS',
            message: text,
            senderName: currentUser ? currentUser.name : 'Coordinator',
            senderRole: 'COORDINATOR'
          })
        });
      }
    };
  }
}

function setupAuthUI() {
  const openAuthModalBtn = document.getElementById('openAuthModalBtn');
  const quickAuthBtn = document.getElementById('quickAuthBtn');
  const userProfileBtn = document.getElementById('userProfileBtn');
  const profileDropdown = document.getElementById('profileDropdown');
  const bannerSwitchBtn = document.getElementById('bannerSwitchBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const topbarLogoutBtn = document.getElementById('topbarLogoutBtn');
  const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');

  // Tabs in Auth Gate
  const tabAuthSignIn = document.getElementById('tabAuthSignIn');
  const tabAuthRegister = document.getElementById('tabAuthRegister');
  const authSignInPane = document.getElementById('authSignInPane');
  const authRegisterPane = document.getElementById('authRegisterPane');

  if (tabAuthSignIn && tabAuthRegister && authSignInPane && authRegisterPane) {
    tabAuthSignIn.onclick = () => {
      tabAuthSignIn.classList.add('active');
      tabAuthRegister.classList.remove('active');
      authSignInPane.style.display = 'flex';
      authRegisterPane.style.display = 'none';
    };
    tabAuthRegister.onclick = () => {
      tabAuthRegister.classList.add('active');
      tabAuthSignIn.classList.remove('active');
      authRegisterPane.style.display = 'flex';
      authSignInPane.style.display = 'none';
    };
  }

  // Registration Role Selector (Civilian vs Responder)
  const btnRegCivilian = document.getElementById('btnRegCivilian');
  const btnRegResponder = document.getElementById('btnRegResponder');
  const regCivilianForm = document.getElementById('regCivilianForm');
  const regResponderForm = document.getElementById('regResponderForm');

  if (btnRegCivilian && btnRegResponder && regCivilianForm && regResponderForm) {
    btnRegCivilian.onclick = () => {
      btnRegCivilian.classList.add('active');
      btnRegResponder.classList.remove('active');
      regCivilianForm.style.display = 'flex';
      regResponderForm.style.display = 'none';
    };
    btnRegResponder.onclick = () => {
      btnRegResponder.classList.add('active');
      btnRegCivilian.classList.remove('active');
      regResponderForm.style.display = 'flex';
      regCivilianForm.style.display = 'none';
    };
  }

  // Respondent ToS Checkbox unlock
  const regRespTosCheck = document.getElementById('regRespTosCheck');
  const regRespSubmitBtn = document.getElementById('regRespSubmitBtn');
  if (regRespTosCheck && regRespSubmitBtn) {
    regRespTosCheck.onchange = () => {
      regRespSubmitBtn.disabled = !regRespTosCheck.checked;
    };
  }

  // Sign In Form Submission
  const authLoginForm = document.getElementById('authLoginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const authAlert = document.getElementById('authAlert');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');

  if (authLoginForm) {
    authLoginForm.onsubmit = async (e) => {
      e.preventDefault();
      const email = loginEmail?.value.trim();
      const password = loginPassword?.value;
      if (!email || !password) return;

      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Authenticating...';
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed.');

        if (data.token) {
          try { localStorage.setItem('crisiscore_token', data.token); } catch(e){}
        }

        updateUserUI(data.user);
        hideAuthGate();
        await loadBackendData();
      } catch (err) {
        if (authAlert) {
          authAlert.style.display = 'block';
          authAlert.className = 'auth-alert';
          authAlert.textContent = err.message;
        }
      } finally {
        if (loginSubmitBtn) {
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.innerHTML = '<span>Sign In to Terminal</span> <i class="ph ph-arrow-right"></i>';
        }
      }
    };
  }

  // Civilian Registration Form Submission
  if (regCivilianForm) {
    regCivilianForm.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('regCivName')?.value.trim();
      const phone = document.getElementById('regCivPhone')?.value.trim();
      const email = document.getElementById('regCivEmail')?.value.trim();
      const password = document.getElementById('regCivPassword')?.value;
      const alertBox = document.getElementById('regCivAlert');
      const submitBtn = document.getElementById('regCivSubmitBtn');

      if (!name || !email || !password) return;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Registering...';
      }

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, email, password, role: 'CIVILIAN' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed.');

        if (data.token) {
          try { localStorage.setItem('crisiscore_token', data.token); } catch(e){}
        }

        updateUserUI(data.user);
        hideAuthGate();
      } catch (err) {
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.className = 'auth-alert';
          alertBox.textContent = err.message;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Register as Civilian</span> <i class="ph ph-check-circle"></i>';
        }
      }
    };
  }

  // Respondent Registration Form Submission (With Mandatory ToS Agreement)
  if (regResponderForm) {
    regResponderForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!regRespTosCheck?.checked) {
        alert('You must review and accept the Voluntary Emergency Responder Terms of Service & Code of Conduct.');
        return;
      }

      const name = document.getElementById('regRespName')?.value.trim();
      const callsign = document.getElementById('regRespCallsign')?.value.trim().toUpperCase();
      const agency = document.getElementById('regRespAgency')?.value.trim();
      const badgeNumber = document.getElementById('regRespBadge')?.value.trim();
      const type = document.getElementById('regRespType')?.value || 'MEDICAL_AMBULANCE';
      const phone = document.getElementById('regRespPhone')?.value.trim();
      const email = document.getElementById('regRespEmail')?.value.trim();
      const password = document.getElementById('regRespPassword')?.value;
      const alertBox = document.getElementById('regRespAlert');

      if (!name || !callsign || !email || !password) return;
      if (regRespSubmitBtn) {
        regRespSubmitBtn.disabled = true;
        regRespSubmitBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Enlisting Respondent...';
      }

      try {
        const res = await fetch('/api/responders/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, callsign, agency, badgeNumber, type, phone, email, password,
            tosAgreed: true,
            lat: baseLat + 0.002,
            lng: baseLng + 0.003
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to enlist respondent unit.');

        if (data.token) {
          try { localStorage.setItem('crisiscore_token', data.token); } catch(e){}
        }

        updateUserUI(data.user);
        hideAuthGate();
        await loadBackendData();
      } catch (err) {
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.className = 'auth-alert';
          alertBox.textContent = err.message;
        }
      } finally {
        if (regRespSubmitBtn) {
          regRespSubmitBtn.disabled = !regRespTosCheck?.checked;
          regRespSubmitBtn.innerHTML = '<span>Accept Terms & Register Respondent Unit</span> <i class="ph ph-arrow-right"></i>';
        }
      }
    };
  }

  // Quick 1-Click Demo Profile Sign-In Cards
  const roleCards = document.querySelectorAll('.quick-role-cards .role-card');
  roleCards.forEach(card => {
    card.onclick = async () => {
      const email = card.getAttribute('data-email');
      const role = card.getAttribute('data-role');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'password123' })
        });
        const data = await res.json();
        if (res.ok && data.user) {
          if (data.token) {
            try { localStorage.setItem('crisiscore_token', data.token); } catch(e){}
          }
          updateUserUI(data.user);
          hideAuthGate();
          await loadBackendData();
          return;
        }
      } catch (e) {
        console.warn('API login fallback:', e);
      }

      // Offline Demo Fallback
      const profile = DEMO_PROFILES[role];
      if (profile) {
        updateUserUI(profile);
        hideAuthGate();
      }
    };
  });

  // Profile Dropdown Toggle
  if (userProfileBtn) {
    userProfileBtn.onclick = (e) => {
      e.stopPropagation();
      if (profileDropdown) {
        profileDropdown.style.display = profileDropdown.style.display === 'none' ? 'block' : 'none';
      }
    };
  }

  document.addEventListener('click', (e) => {
    if (profileDropdown && !profileDropdown.contains(e.target) && !userProfileBtn?.contains(e.target)) {
      profileDropdown.style.display = 'none';
    }
  });

  if (openAuthModalBtn) openAuthModalBtn.onclick = showAuthGate;
  if (quickAuthBtn) quickAuthBtn.onclick = showAuthGate;
  if (bannerSwitchBtn) bannerSwitchBtn.onclick = showAuthGate;

  // Logout Buttons
  if (logoutBtn) logoutBtn.onclick = handleLogout;
  if (topbarLogoutBtn) topbarLogoutBtn.onclick = handleLogout;
  if (sidebarLogoutBtn) sidebarLogoutBtn.onclick = handleLogout;
}

// --- WebSocket Real-Time Listener ---
function initSocket() {
  try {
    socket = io(getApiBase() || undefined);

    socket.on('connect', () => {
      console.log('📡 Connected to CrisisCore Gateway:', socket.id);
      socket.emit('join:coordinator');
      if (currentUser?.role === 'RESPONDER') {
        socket.emit('join:responder', { responderId: '3084912b-5bdc-4fd3-87bb-fb89a96d50fd' });
      }
    });

    // 1. Live Incidents
    socket.on('incident:new', (newInc) => {
      console.log('🚨 Live Incident received from SOS portal:', newInc);
      const incObj = formatIncident(newInc);

      if (!state.incidents.some(i => i.id === incObj.id || i.dbId === incObj.dbId)) {
        state.incidents.unshift(incObj);
        updateMetrics();
        renderAll();
        addMapMarker(incObj);

        // Update Comms select dropdown if visible
        const commsSelect = document.getElementById('commsIncidentSelect');
        if (commsSelect && incObj.dbId) {
          const opt = document.createElement('option');
          opt.value = incObj.dbId;
          opt.textContent = `${incObj.id} — ${incObj.type} (${incObj.location})`;
          commsSelect.appendChild(opt);
        }

        // Audible/visual Dispatcher prompt notification
        showDispatcherPrompt({
          type: 'DECLINED',
          responderName: 'EMERGENCY INTAKE (SOS)',
          callsign: incObj.type,
          notes: `New distress signal reported at ${incObj.location} (${incObj.affected} affected)`,
          incidentNumber: incObj.id
        });
      }
    });

    socket.on('incident:updated', (updatedInc) => {
      const match = state.incidents.find(i => i.id === updatedInc.incidentNumber || i.dbId === updatedInc.id);
      if (match) {
        match.status = updatedInc.status.toLowerCase();
        updateMetrics();
        renderAll();
      }
      if (activeCivilianIncident && (activeCivilianIncident.id === updatedInc.incidentNumber || activeCivilianIncident.dbId === updatedInc.id)) {
        activeCivilianIncident.status = updatedInc.status;
        setupCivilianView();
      }
    });

    // Real-Time Assignment Dispatches
    socket.on('assignment:new', (assignment) => {
      console.log('🚨 New Assignment received via WebSocket:', assignment);
      currentActiveResponderAssignment = assignment;
      loadBackendData();
      setupResponderView();

      if (currentUser?.role === 'RESPONDER') {
        showDispatcherPrompt({
          type: 'ACCEPTED',
          responderName: assignment.responder?.name || 'Your Unit',
          callsign: assignment.responder?.callsign || 'UNIT',
          notes: `New mission assigned: ${assignment.incident?.type || 'Emergency'} (${assignment.incident?.incidentNumber || ''})`,
          incidentNumber: assignment.incident?.incidentNumber
        });
      }

      if (activeCivilianIncident && (activeCivilianIncident.dbId === assignment.incidentId || activeCivilianIncident.id === assignment.incident?.incidentNumber)) {
        activeCivilianIncident.status = 'DISPATCHED';
        activeCivilianIncident.responderCallsign = assignment.responder?.callsign || 'MEDIC-01';
        activeCivilianIncident.responderName = assignment.responder?.name || 'Emergency Unit';
        setupCivilianView();
      }
    });

    // Real-Time Incident Status Transitions (DISPATCHED, ON_SCENE, RESOLVED)
    socket.on('incident:status', (statusData) => {
      console.log('📍 Incident status update received:', statusData);
      if (activeCivilianIncident && (activeCivilianIncident.dbId === statusData.incidentId || !statusData.incidentId || activeCivilianIncident.id === statusData.incidentNumber)) {
        activeCivilianIncident.status = statusData.incidentStatus || statusData.status;
        if (statusData.responderCallsign) activeCivilianIncident.responderCallsign = statusData.responderCallsign;
        if (statusData.responderName) activeCivilianIncident.responderName = statusData.responderName;
        setupCivilianView();
      }
      loadBackendData();
      setupResponderView();
    });

    socket.on('assignment:updated', (updatedAssignment) => {
      console.log('🔄 Assignment updated:', updatedAssignment);
      loadBackendData();
      setupResponderView();
    });

    // 2. Real-Time Responder Action Prompts (Accept, Decline, En Route, On Scene, Completed)
    socket.on('assignment:responder_action', (actionPayload) => {
      console.log('🔔 Dispatcher Action Prompt received:', actionPayload);
      showDispatcherPrompt(actionPayload);
      loadBackendData();
      if (currentUser?.role === 'RESPONDER') {
        setupResponderView();
      }
    });

    // 3. Newly Registered Responders
    socket.on('responder:registered', (newResp) => {
      console.log('🚑 New Responder Registered:', newResp);
      showDispatcherPrompt({
        type: 'ACCEPTED',
        responderName: newResp.name,
        callsign: newResp.callsign,
        notes: 'Newly registered and ready for dispatch.'
      });
      loadBackendData();
    });

    // 4. Real-time Chat message received
    socket.on('chat:message', (newMsg) => {
      // Append to Coordinator Tactical Ops Chat Modal if open
      if (activeOpsChatIncidentId === newMsg.incidentId && newMsg.channel === 'OPS') {
        const modalStream = document.getElementById('coordinatorChatStream');
        if (modalStream) {
          const isSelf = newMsg.senderName === currentUser?.name || newMsg.senderRole === currentUser?.role;
          const time = new Date(newMsg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const msgEl = document.createElement('div');
          msgEl.className = `chat-msg ${isSelf ? 'self' : 'other'}`;
          msgEl.innerHTML = `
            <div class="chat-sender">${escapeHtml(newMsg.senderName)} (${escapeHtml(newMsg.senderRole)})</div>
            <div class="chat-bubble">${escapeHtml(newMsg.message)}</div>
            <div class="chat-time">${time}</div>
          `;
          modalStream.appendChild(msgEl);
          modalStream.scrollTop = modalStream.scrollHeight;
        }

        // Also append to Coordinator Persistent Comms Dock if open
        const directStream = document.getElementById('coordinatorDirectChatStream');
        if (directStream) {
          const hint = directStream.querySelector('.chat-empty-hint');
          if (hint) hint.remove();
          const isSelf = newMsg.senderName === currentUser?.name || newMsg.senderRole === 'COORDINATOR';
          const time = new Date(newMsg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const msgEl = document.createElement('div');
          msgEl.className = `chat-msg ${isSelf ? 'self' : 'other'}`;
          msgEl.innerHTML = `
            <div class="chat-sender">${escapeHtml(newMsg.senderName)} (${escapeHtml(newMsg.senderRole)})</div>
            <div class="chat-bubble">${escapeHtml(newMsg.message)}</div>
            <div class="chat-time">${time}</div>
          `;
          directStream.appendChild(msgEl);
          directStream.scrollTop = directStream.scrollHeight;
        }
      }

      // Append to Responder Chat if in responder view
      if (currentUser?.role === 'RESPONDER') {
        if (newMsg.channel === activeResponderChannel) {
          const stream = document.getElementById('responderChatStream');
          if (stream) {
            const isSelf = (currentUser && newMsg.senderName === currentUser.name) || newMsg.senderRole === 'RESPONDER';
            const time = new Date(newMsg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const msgEl = document.createElement('div');
            msgEl.className = `chat-msg ${isSelf ? 'self' : 'other'}`;
            msgEl.innerHTML = `
              <div class="chat-sender">${escapeHtml(newMsg.senderName)} (${escapeHtml(newMsg.senderRole)})</div>
              <div class="chat-bubble">${escapeHtml(newMsg.message)}</div>
              <div class="chat-time">${time}</div>
            `;
            stream.appendChild(msgEl);
            stream.scrollTop = stream.scrollHeight;
          }
        } else if (newMsg.channel === 'CIVILIAN') {
          const dot = document.getElementById('civUnreadDot');
          if (dot) dot.style.display = 'block';
        }
      }

      // Append to Civilian View Live Chat Dock if open
      if (activeCivilianIncident && (newMsg.incidentId === activeCivilianIncident.dbId || newMsg.incidentId === activeCivilianIncident.id) && newMsg.channel === 'CIVILIAN') {
        const civStream = document.getElementById('civilianViewChatStream');
        if (civStream) {
          const hint = civStream.querySelector('.chat-empty-hint');
          if (hint) hint.remove();
          const isSelf = newMsg.senderRole === 'CIVILIAN';
          const time = new Date(newMsg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const msgEl = document.createElement('div');
          msgEl.className = `chat-msg ${isSelf ? 'self' : 'other'}`;
          msgEl.innerHTML = `
            <div class="chat-sender">${escapeHtml(newMsg.senderName)} (${escapeHtml(newMsg.senderRole)})</div>
            <div class="chat-bubble">${escapeHtml(newMsg.message)}</div>
            <div class="chat-time">${time}</div>
          `;
          civStream.appendChild(msgEl);
          civStream.scrollTop = civStream.scrollHeight;
        }
      }
    });

    socket.on('incident:location_updated', (loc) => {
      const marker = mapMarkers[loc.incidentId];
      if (marker && loc.lat && loc.lng) {
        marker.setLatLng([loc.lat, loc.lng]);
      }
    });
  } catch (err) {
    console.warn('Socket init warning:', err);
  }
}

// --- App Initialization ---
async function init() {
  initMap();
  setupModals();
  initSocket();
  if (currentUser) {
    updateUserUI(currentUser);
    await loadBackendData();
  } else {
    showAuthGate();
  }
}

document.addEventListener('DOMContentLoaded', init);
