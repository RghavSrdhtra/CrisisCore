import { io } from 'socket.io-client';
import { getApiBase } from './apiConfig.js';

// --- State Variables ---
let currentLat = 28.6139; // Default Delhi coordinates
let currentLng = 77.2090;
let locationSource = 'MANUAL';
let accuracyMeters = 10;
let map = null;
let pinMarker = null;
let activeIncident = null;
let socket = null;
let watchPositionId = null;

// --- Initialize DOM on Load ---
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindCategoryGrid();
  bindNumberStepper();
  bindQuickTags();
  bindGPSDetector();
  bindFormSubmit();
  bindTrackerActions();
  bindCivilianChat();
  connectSocketIO();
});

// --- 1. Leaflet Interactive Map Initialization ---
function initMap() {
  const mapEl = document.getElementById('sosLocationMap');
  if (!mapEl || typeof L === 'undefined') return;

  map = L.map('sosLocationMap', {
    center: [currentLat, currentLng],
    zoom: 13,
    zoomControl: true,
    attributionControl: false
  });

  // OpenStreetMap dark styled tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'tactical-dark-tiles',
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  // Custom marker icon
  const sosPinIcon = L.divIcon({
    className: 'custom-sos-pin',
    html: `
      <div class="pin-marker-pulse">
        <div class="pin-core"><i class="ph-fill ph-map-pin"></i></div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 36]
  });

  pinMarker = L.marker([currentLat, currentLng], {
    draggable: true,
    icon: sosPinIcon
  }).addTo(map);

  // Update coords on marker drag
  pinMarker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    updateLocationCoords(pos.lat, pos.lng, 'MANUAL PIN', 10);
  });

  // Click on map to place pin
  map.on('click', (e) => {
    pinMarker.setLatLng(e.latlng);
    updateLocationCoords(e.latlng.lat, e.latlng.lng, 'MANUAL PIN', 10);
  });

  updateLocationCoords(currentLat, currentLng, 'MANUAL PIN', 10);
}

// --- Update Coordinates Helper ---
function updateLocationCoords(lat, lng, source, acc) {
  currentLat = parseFloat(lat.toFixed(6));
  currentLng = parseFloat(lng.toFixed(6));
  locationSource = source || 'MANUAL';
  accuracyMeters = acc || 10;

  const latEl = document.getElementById('displayLat');
  const lngEl = document.getElementById('displayLng');
  const sourceEl = document.getElementById('displaySource');

  if (latEl) latEl.textContent = currentLat.toFixed(6);
  if (lngEl) lngEl.textContent = currentLng.toFixed(6);
  if (sourceEl) {
    sourceEl.textContent = locationSource;
    if (source.includes('GPS')) {
      sourceEl.className = 'badge badge-success';
    } else {
      sourceEl.className = 'badge';
    }
  }
}

// --- 2. GPS Auto-Detection ---
function bindGPSDetector() {
  const btnAutoGPS = document.getElementById('btnAutoGPS');
  if (!btnAutoGPS) return;

  btnAutoGPS.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    btnAutoGPS.innerHTML = `<i class="ph ph-spinner ph-spin"></i> Detecting GPS...`;
    btnAutoGPS.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        updateLocationCoords(latitude, longitude, `GPS AUTO-DETECT (±${Math.round(accuracy)}m)`, accuracy);

        if (map && pinMarker) {
          map.setView([latitude, longitude], 15);
          pinMarker.setLatLng([latitude, longitude]);
        }

        btnAutoGPS.innerHTML = `<i class="ph-fill ph-check-circle text-green"></i> GPS Locked (±${Math.round(accuracy)}m)`;
        btnAutoGPS.disabled = false;
      },
      (error) => {
        console.warn('Geolocation error:', error);
        let msg = 'Unable to acquire GPS signal. You can click anywhere on the map to set your location.';
        if (error.code === error.PERMISSION_DENIED) {
          msg = 'Location permission was denied. Please select your location on the map.';
        }
        alert(msg);
        btnAutoGPS.innerHTML = `<i class="ph-fill ph-crosshair"></i> Auto-Detect My GPS`;
        btnAutoGPS.disabled = false;
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

// --- 3. Category & Inputs ---
function bindCategoryGrid() {
  const grid = document.getElementById('categoryGrid');
  if (!grid) return;

  const buttons = grid.querySelectorAll('.type-card-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function bindNumberStepper() {
  const input = document.getElementById('inputAffected');
  const decBtn = document.getElementById('decAffectedBtn');
  const incBtn = document.getElementById('incAffectedBtn');

  if (!input) return;

  decBtn?.addEventListener('click', () => {
    const val = parseInt(input.value || 1, 10);
    if (val > 1) input.value = val - 1;
  });

  incBtn?.addEventListener('click', () => {
    const val = parseInt(input.value || 1, 10);
    if (val < 500) input.value = val + 1;
  });
}

function bindQuickTags() {
  const quickTags = document.getElementById('quickTags');
  const textarea = document.getElementById('inputDescription');
  if (!quickTags || !textarea) return;

  quickTags.addEventListener('click', (e) => {
    const tag = e.target.closest('.quick-tag');
    if (!tag) return;
    const text = tag.getAttribute('data-text');
    if (text) {
      if (textarea.value.trim().length > 0) {
        textarea.value += ' ' + text;
      } else {
        textarea.value = text;
      }
      textarea.focus();
    }
  });
}

// --- 4. Form Submission & Backend POST /api/incidents ---
function bindFormSubmit() {
  const form = document.getElementById('standaloneSOSForm');
  const submitBtn = document.getElementById('submitSosBtn');
  const alertBox = document.getElementById('sosAlertBox');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const activeTypeBtn = document.querySelector('.type-card-btn.active');
    const type = activeTypeBtn ? activeTypeBtn.getAttribute('data-type') : 'MEDICAL';
    const affectedCount = parseInt(document.getElementById('inputAffected')?.value || 1, 10);
    const severity = document.getElementById('inputSeverity')?.value || 'HIGH';
    const description = document.getElementById('inputDescription')?.value.trim();
    const phone = document.getElementById('inputPhone')?.value.trim();
    const consent = document.getElementById('sosConsentCheck')?.checked;

    if (!description) {
      showAlert('Please provide situation details for the emergency dispatch team.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> TRANSMITTING DISTRESS SIGNAL...`;

    try {
      const payload = {
        type,
        affectedCount,
        severity,
        description,
        reporterContact: phone || null,
        lat: currentLat,
        lng: currentLng,
        source: locationSource.includes('GPS') ? 'GPS' : 'MANUAL',
        accuracy: accuracyMeters,
        locationSharingActive: Boolean(consent)
      };

      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit emergency SOS.');
      }

      activeIncident = data.incident;
      showAlert('Emergency SOS successfully transmitted! Central Coordination alerted.', 'success');

      // Transition to active tracking state
      activateTracker(activeIncident);

      // Join WebSocket room for this incident
      if (socket && activeIncident?.id) {
        socket.emit('join:incident', { incidentId: activeIncident.id });
      }

      // Start voluntary location streaming if enabled
      if (activeIncident.locationSharingActive) {
        startLocationStreaming(activeIncident.id);
      }

    } catch (err) {
      console.error('Error submitting SOS:', err);
      showAlert(`Submission failed: ${err.message}. Please check connection or retry.`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="ph-fill ph-warning-octagon"></i> TRANSMIT EMERGENCY SOS`;
    }
  });
}

function showAlert(msg, type) {
  const box = document.getElementById('sosAlertBox');
  if (!box) return;
  box.style.display = 'block';
  box.className = `auth-alert ${type}`;
  box.innerHTML = `<i class="ph-fill ph-${type === 'success' ? 'check-circle' : 'warning-circle'}"></i> ${msg}`;
}

// --- 5. Active Response Tracker & Timeline ---
function activateTracker(incident) {
  const emptyState = document.getElementById('trackerEmptyState');
  const activeState = document.getElementById('trackerActiveState');
  const statusBadge = document.getElementById('trackerStatusBadge');
  const incNumEl = document.getElementById('activeIncNumber');
  const priorityEl = document.getElementById('activeIncPriority');
  const reportedTimeEl = document.getElementById('stepReportedTime');

  if (emptyState) emptyState.style.display = 'none';
  if (activeState) activeState.style.display = 'block';

  if (statusBadge) {
    statusBadge.textContent = incident.status || 'REPORTED';
    statusBadge.className = 'badge badge-warning';
  }

  if (incNumEl) incNumEl.textContent = incident.incidentNumber || 'INC-2026';
  if (priorityEl) {
    const prio = incident.predictedPriority || incident.severity || 'HIGH';
    priorityEl.textContent = `${prio} PRIORITY`;
    priorityEl.className = `priority-pill ${prio.toLowerCase()}`;
  }

  if (reportedTimeEl) {
    reportedTimeEl.textContent = `Reported at ${new Date(incident.reportedAt || Date.now()).toLocaleTimeString()}`;
  }

  updateTimelineStatus(incident.status || 'REPORTED');

  // Join civilian chat room and load existing messages
  if (incident?.id) {
    if (socket) {
      socket.emit('chat:join', { incidentId: incident.id, channel: 'CIVILIAN' });
    }
    loadCivilianMessages(incident.id);
  }
}

function updateTimelineStatus(status, details = {}) {
  const stepReported = document.getElementById('stepReported');
  const stepTriaged = document.getElementById('stepTriaged');
  const stepDispatched = document.getElementById('stepDispatched');
  const stepOnScene = document.getElementById('stepOnScene');
  const stepResolved = document.getElementById('stepResolved');
  const statusBadge = document.getElementById('trackerStatusBadge');
  const assignedUnitName = document.getElementById('assignedUnitName');

  const upper = (status || '').toUpperCase();

  if (statusBadge) {
    statusBadge.textContent = upper;
    if (upper === 'REPORTED') statusBadge.className = 'badge badge-warning';
    else if (upper === 'TRIAGED') statusBadge.className = 'badge badge-info';
    else if (upper === 'DISPATCHED') statusBadge.className = 'badge badge-primary';
    else if (upper === 'ON_SCENE') statusBadge.className = 'badge badge-cyan';
    else if (upper === 'RESOLVED') statusBadge.className = 'badge badge-success';
    else if (upper === 'CANCELLED') statusBadge.className = 'badge badge-muted';
  }

  // Reset steps
  [stepReported, stepTriaged, stepDispatched, stepOnScene, stepResolved].forEach(s => {
    if (s) s.className = 'timeline-step';
  });

  if (upper === 'REPORTED') {
    stepReported?.classList.add('completed');
  } else if (upper === 'TRIAGED') {
    stepReported?.classList.add('completed');
    stepTriaged?.classList.add('completed');
  } else if (upper === 'DISPATCHED') {
    stepReported?.classList.add('completed');
    stepTriaged?.classList.add('completed');
    stepDispatched?.classList.add('completed');
    if (details.responderCallsign && assignedUnitName) {
      assignedUnitName.innerHTML = `Dispatched: <strong>${details.responderCallsign}</strong> (${details.responderType || 'Rescue Unit'})`;
    }
    const chatMeta = document.getElementById('chatResponderMeta');
    if (chatMeta && (details.responderName || details.responderCallsign)) {
      chatMeta.textContent = `Direct link with ${details.responderName || details.responderCallsign} (${details.responderCallsign || 'MEDIC-01'})`;
    }
  } else if (upper === 'ON_SCENE') {
    stepReported?.classList.add('completed');
    stepTriaged?.classList.add('completed');
    stepDispatched?.classList.add('completed');
    stepOnScene?.classList.add('completed');
  } else if (upper === 'RESOLVED') {
    stepReported?.classList.add('completed');
    stepTriaged?.classList.add('completed');
    stepDispatched?.classList.add('completed');
    stepOnScene?.classList.add('completed');
    stepResolved?.classList.add('completed');
    stopLocationStreaming();
  } else if (upper === 'CANCELLED') {
    stopLocationStreaming();
  }
}

// --- 6. Voluntary GPS Telemetry Streaming (Section 4.11) ---
function startLocationStreaming(incidentId) {
  if (!navigator.geolocation) return;

  const streamDot = document.getElementById('streamDot');
  const streamStatusText = document.getElementById('streamStatusText');

  if (streamDot) streamDot.className = 'pulse-dot green';
  if (streamStatusText) streamStatusText.textContent = 'Live GPS Streaming: Active';

  watchPositionId = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      currentLat = latitude;
      currentLng = longitude;

      // Stream via WebSocket if available, fallback to REST
      if (socket && socket.connected) {
        socket.emit('location:stream', {
          incidentId,
          lat: latitude,
          lng: longitude
        });
      } else {
        try {
          await fetch(`/api/incidents/${incidentId}/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: latitude, lng: longitude, accuracy, source: 'GPS' })
          });
        } catch (e) {
          console.warn('Location stream error:', e);
        }
      }
    },
    (err) => {
      console.warn('watchPosition warning:', err);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

function stopLocationStreaming() {
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
  const streamDot = document.getElementById('streamDot');
  const streamStatusText = document.getElementById('streamStatusText');
  if (streamDot) streamDot.className = 'pulse-dot red';
  if (streamStatusText) streamStatusText.textContent = 'Location Streaming: Terminated';
}

// --- 7. Tracker Actions (Cancel SOS & Pause Stream) ---
function bindTrackerActions() {
  const btnCancelSOS = document.getElementById('btnCancelSOS');
  const toggleStreamBtn = document.getElementById('toggleStreamBtn');

  btnCancelSOS?.addEventListener('click', async () => {
    if (!activeIncident) return;
    const confirmCancel = confirm('Are you sure you want to cancel this emergency request?');
    if (!confirmCancel) return;

    try {
      const res = await fetch(`/api/incidents/${activeIncident.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Civilian marked safe via SOS portal' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel SOS.');

      updateTimelineStatus('CANCELLED');
      alert('Your SOS request has been cancelled and responders notified. Stay safe!');
    } catch (err) {
      alert(`Error cancelling SOS: ${err.message}`);
    }
  });

  toggleStreamBtn?.addEventListener('click', async () => {
    if (!activeIncident) return;
    const isCurrentlyActive = watchPositionId !== null;

    try {
      const res = await fetch(`/api/incidents/${activeIncident.id}/location-toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !isCurrentlyActive })
      });
      const data = await res.json();

      if (data.locationSharingActive) {
        startLocationStreaming(activeIncident.id);
        toggleStreamBtn.innerHTML = `<i class="ph ph-eye-slash"></i> Pause Location`;
      } else {
        stopLocationStreaming();
        toggleStreamBtn.innerHTML = `<i class="ph ph-eye"></i> Resume Location`;
      }
    } catch (err) {
      console.error('Failed to toggle location:', err);
    }
  });
}

// --- 8. Real-Time WebSocket Connection ---
function connectSocketIO() {
  const connDot = document.getElementById('connDot');
  const connText = document.getElementById('connText');

  try {
    socket = io(getApiBase() || undefined);

    socket.on('connect', () => {
      console.log('📡 Connected to CrisisCore Dispatch Gateway:', socket.id);
      if (connDot) connDot.className = 'pulse-dot green';
      if (connText) connText.textContent = 'Dispatch Online';

      if (activeIncident?.id) {
        socket.emit('join:incident', { incidentId: activeIncident.id });
        socket.emit('chat:join', { incidentId: activeIncident.id, channel: 'CIVILIAN', role: 'CIVILIAN' });
      }
    });

    socket.on('disconnect', () => {
      console.warn('⚠️ Disconnected from CrisisCore Dispatch Gateway');
      if (connDot) connDot.className = 'pulse-dot amber';
      if (connText) connText.textContent = 'Reconnecting...';
    });

    // Listen for real-time status updates from coordinator
    socket.on('incident:updated', (incident) => {
      if (activeIncident && incident.id === activeIncident.id) {
        console.log('🔄 Incident update received:', incident);
        updateTimelineStatus(incident.status);
      }
    });

    socket.on('incident:status', (data) => {
      console.log('🚑 Status event received:', data);
      updateTimelineStatus(data.status, data);
    });

    socket.on('incident:cancelled', () => {
      updateTimelineStatus('CANCELLED');
    });

    // Real-time chat message on civilian channel
    socket.on('chat:message', (newMsg) => {
      if (activeIncident && newMsg.incidentId === activeIncident.id && newMsg.channel === 'CIVILIAN') {
        renderCivilianChatMessage(newMsg);
      }
    });

    socket.on('chat:civilian_update', (data) => {
      if (activeIncident && data.incidentId === activeIncident.id && data.message) {
        renderCivilianChatMessage(data.message);
      }
    });

  } catch (err) {
    console.warn('Socket.IO initialization error:', err);
  }
}

// --- 9. Civilian Direct Responder Chat Channel ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderCivilianChatMessage(msg) {
  const stream = document.getElementById('civilianChatStream');
  if (!stream) return;

  const emptyHint = stream.querySelector('.chat-empty-hint');
  if (emptyHint) emptyHint.remove();

  // Avoid duplicates if already rendered
  if (msg.id && stream.querySelector(`[data-msg-id="${msg.id}"]`)) return;

  const isSelf = msg.senderRole === 'CIVILIAN' || (msg.senderName && msg.senderName.toLowerCase().includes('civilian'));
  const time = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgEl = document.createElement('div');
  if (msg.id) msgEl.setAttribute('data-msg-id', msg.id);
  msgEl.className = `chat-msg ${isSelf ? 'self' : 'other'}`;
  msgEl.innerHTML = `
    <div class="chat-sender">${escapeHtml(msg.senderName || (isSelf ? 'You' : 'Field Responder'))} (${escapeHtml(msg.senderRole || 'PERSONNEL')})</div>
    <div class="chat-bubble">${escapeHtml(msg.message)}</div>
    <div class="chat-time">${time}</div>
  `;
  stream.appendChild(msgEl);
  stream.scrollTop = stream.scrollHeight;
}

async function loadCivilianMessages(incidentId) {
  const stream = document.getElementById('civilianChatStream');
  if (!stream || !incidentId) return;

  try {
    const res = await fetch(`/api/chat/${incidentId}?channel=CIVILIAN`);
    const data = await res.json();
    if (data.messages && data.messages.length > 0) {
      stream.innerHTML = '';
      data.messages.forEach(m => renderCivilianChatMessage(m));
    }
  } catch (err) {
    console.warn('Could not load chat messages:', err);
  }
}

function bindCivilianChat() {
  const form = document.getElementById('civilianChatForm');
  const input = document.getElementById('civilianChatInput');
  const quickChips = document.getElementById('quickChatChips');

  if (quickChips) {
    quickChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.quick-chip');
      if (!chip) return;
      const msg = chip.getAttribute('data-msg');
      if (msg && input) {
        input.value = msg;
        input.focus();
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input?.value.trim();
      if (!text) return;
      if (!activeIncident?.id) {
        alert('Please submit your emergency SOS before transmitting messages.');
        return;
      }

      input.value = '';

      const payload = {
        incidentId: activeIncident.id,
        channel: 'CIVILIAN',
        message: text,
        senderName: 'Civilian (You)',
        senderRole: 'CIVILIAN'
      };

      if (socket && socket.connected) {
        socket.emit('chat:send', payload);
      } else {
        try {
          const res = await fetch(`/api/chat/${activeIncident.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.message) {
            renderCivilianChatMessage(data.message);
          }
        } catch (err) {
          console.error('Error sending message:', err);
        }
      }
    });
  }
}
