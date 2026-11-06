/**
 * CrisisCore ML & Optimization Client Service (Weeks 4 & 5)
 * Interfaces the Node.js Express Gateway with the Python FastAPI ML microservice.
 */

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';
const TIMEOUT_MS = 2500;

async function fetchWithTimeout(url, options = {}, timeout = TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export const mlClient = {
  /**
   * Health check for Python ML microservice
   */
  async checkHealth() {
    try {
      const res = await fetchWithTimeout(`${ML_SERVICE_URL}/api/ml/health`, {}, 1500);
      if (!res.ok) return { online: false };
      const data = await res.json();
      return { online: true, ...data };
    } catch (e) {
      return { online: false, error: e.message };
    }
  },

  /**
   * Evaluate incident urgency via NLP Random Forest model
   */
  async evaluateIncident(incidentData, inventory = []) {
    try {
      const res = await fetchWithTimeout(`${ML_SERVICE_URL}/api/ml/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...incidentData,
          inventory
        })
      });
      if (!res.ok) throw new Error(`ML Service responded with ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[ML Client] Evaluate fallback: ${err.message}`);
      return null;
    }
  },

  /**
   * Run Hungarian Bipartite matching and ILP cargo allocation
   */
  async optimizeDispatch(incidents, responders, depots = [], inventory = []) {
    try {
      const res = await fetchWithTimeout(`${ML_SERVICE_URL}/api/ml/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidents, responders, depots, inventory })
      });
      if (!res.ok) throw new Error(`ML Service responded with ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[ML Client] Optimize fallback: ${err.message}`);
      return null;
    }
  },

  /**
   * Dynamic multi-stop route planner
   */
  async planRoute(incident, allocatedSupplies, responder) {
    try {
      const res = await fetchWithTimeout(`${ML_SERVICE_URL}/api/ml/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident, allocatedSupplies, responder })
      });
      if (!res.ok) throw new Error(`ML Service responded with ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[ML Client] Route planning fallback: ${err.message}`);
      return null;
    }
  }
};

