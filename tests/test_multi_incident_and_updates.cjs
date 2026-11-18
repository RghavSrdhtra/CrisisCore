/**
 * Automated Test Suite for User Requirements:
 * 1. Incident Manager adds new incident directly with auto-verified triage.
 * 2. Resource Manager adds resource without needing quantity (defaults gracefully).
 * 3. AI Multi-Incident Optimizer evaluates two or more concurrent disaster sites,
 *    optimally matches resources (e.g. Site 1 Fire/Critical vs Site 2 Medical/Trauma),
 *    and generates cross-location trade-off decision analysis.
 * 4. Batch dispatch of multi-optimized fleet execution.
 */

const assert = require('assert');

const BASE_URL = 'http://localhost:3001/api';

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 TESTING INCIDENT MANAGER, RESOURCE MANAGER & MULTI-INCIDENT AI');
  console.log('===============================================================');

  let passed = 0;
  let failed = 0;

  function pass(msg) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  }

  function fail(msg, err) {
    console.error(`  ❌ FAIL: ${msg}`, err ? (err.message || err) : '');
    failed++;
  }

  // --- Step 1: Resource Manager adds resource WITHOUT quantity ---
  console.log('\n--- Step 1: Resource Manager adds resource WITHOUT quantity ---');
  let resourceId = null;
  try {
    const res = await fetch(`${BASE_URL}/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Advanced Portable Field Trauma Kits',
        category: 'MEDICINE',
        depotName: 'Apex Sector 12 Depot',
        depotLat: 28.6180,
        depotLng: 77.2150
        // Notice: NO quantityTotal or quantity!
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201, 'Resource creation failed');
    assert.ok(data.resource, 'Resource missing in response');
    assert.strictEqual(data.resource.category, 'MEDICINE', 'Category mismatch');
    assert.ok(data.resource.quantityTotal >= 1, 'Default quantity not set');
    resourceId = data.resource.id;
    pass(`Resource added without quantity: "${data.resource.name}" (default stock: ${data.resource.quantityTotal} ${data.resource.unit})`);
  } catch (e) {
    fail('Add resource without quantity failed', e);
  }

  // --- Step 2: Incident Manager logs Incident 1 (Location A: Critical Fire with trapped casualties) ---
  console.log('\n--- Step 2: Incident Manager logs Incident 1 (Location A - Critical Fire) ---');
  let incIdA = null;
  try {
    const res = await fetch(`${BASE_URL}/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'FIRE',
        severity: 'CRITICAL',
        address: 'Sector 7 Industrial Complex, District North',
        lat: 28.6250,
        lng: 77.2050,
        affectedCount: 15,
        description: 'Multi-story warehouse chemical fire with 15 workers trapped. Severe smoke inhalation.',
        autoVerify: true,
        resourceNeeds: {
          water_litres: 500,
          food_rations: 30,
          medical_kits: 15,
          ambulances: 2
        }
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201, 'Incident A creation failed');
    assert.ok(data.incident, 'Incident A missing');
    assert.strictEqual(data.incident.verificationStatus, 'VERIFIED', 'Incident A should be auto-verified');
    assert.strictEqual(data.incident.status, 'TRIAGED', 'Incident A should be TRIAGED');
    incIdA = data.incident.id;
    pass(`Incident 1 logged & triaged: ${data.incident.incidentNumber} (${data.incident.severity}, ${data.incident.affectedCount} casualties)`);
  } catch (e) {
    fail('Incident 1 creation failed', e);
  }

  // --- Step 3: Incident Manager logs Incident 2 (Location B: High Medical Emergency) ---
  console.log('\n--- Step 3: Incident Manager logs Incident 2 (Location B - High Medical) ---');
  let incIdB = null;
  try {
    const res = await fetch(`${BASE_URL}/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MEDICAL',
        severity: 'HIGH',
        address: 'Sector 4 Community Center, District South',
        lat: 28.6020,
        lng: 77.2280,
        affectedCount: 4,
        description: 'Structural awning collapse causing 4 blunt force trauma injuries and lacerations.',
        autoVerify: true,
        resourceNeeds: {
          water_litres: 50,
          food_rations: 10,
          medical_kits: 4,
          ambulances: 1
        }
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201, 'Incident B creation failed');
    assert.ok(data.incident, 'Incident B missing');
    assert.strictEqual(data.incident.verificationStatus, 'VERIFIED', 'Incident B should be auto-verified');
    incIdB = data.incident.id;
    pass(`Incident 2 logged & triaged: ${data.incident.incidentNumber} (${data.incident.severity}, ${data.incident.affectedCount} casualties)`);
  } catch (e) {
    fail('Incident 2 creation failed', e);
  }

  // --- Step 4: AI Multi-Incident Optimization ---
  console.log('\n--- Step 4: AI Multi-Incident Optimization (Two Places, Global Bipartite Solving) ---');
  let multiOptimizations = [];
  try {
    const res = await fetch(`${BASE_URL}/assignments/multi-optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incidentIds: [incIdA, incIdB]
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, 'Multi-optimize endpoint failed');
    assert.ok(Array.isArray(data.optimizations), 'optimizations array missing');
    assert.strictEqual(data.optimizations.length, 2, 'Should optimize both incident sites');
    assert.ok(data.summary, 'Summary missing');
    assert.ok(data.summary.globalEfficiencyScore > 80, 'Global efficiency score should be high');

    multiOptimizations = data.optimizations;

    const optA = data.optimizations.find(o => o.incident.id === incIdA);
    const optB = data.optimizations.find(o => o.incident.id === incIdB);

    assert.ok(optA, 'Optimization for Incident A missing');
    assert.ok(optB, 'Optimization for Incident B missing');
    assert.ok(optA.recommendedResponder, 'Recommended responder for A missing');
    assert.ok(optB.recommendedResponder, 'Recommended responder for B missing');

    // Verify non-conflicting responder dispatch
    assert.notStrictEqual(optA.recommendedResponder.id, optB.recommendedResponder.id, 'Responders must not be double-booked across concurrent sites');

    pass(`Multi-site optimization solved with ${data.summary.globalEfficiencyScore}% efficiency score`);
    pass(`Location A (${optA.incident.incidentNumber}) paired with ${optA.recommendedResponder.name} (${optA.recommendedResponder.callsign}) [ETA: ${optA.etaMinutes}m]`);
    pass(`Location B (${optB.incident.incidentNumber}) paired with ${optB.recommendedResponder.name} (${optB.recommendedResponder.callsign}) [ETA: ${optB.etaMinutes}m]`);
    pass(`Trade-off Rationale A: "${optA.tradeOffAnalysis}"`);
    pass(`Trade-off Rationale B: "${optB.tradeOffAnalysis}"`);
  } catch (e) {
    fail('Multi-Incident Optimization failed', e);
  }

  // --- Step 5: 1-Click Batch Dispatch Execution ---
  console.log('\n--- Step 5: 1-Click Batch Dispatch Execution ---');
  try {
    const dispatches = multiOptimizations.map(opt => ({
      incidentId: opt.incident.id,
      responderId: opt.recommendedResponder.id,
      allocatedSupplies: opt.allocatedSupplies,
      stopSequence: opt.stopSequence,
      recommendationScore: opt.recommendationScore,
      notes: opt.tradeOffAnalysis
    }));

    const res = await fetch(`${BASE_URL}/assignments/batch-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatches })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, 'Batch dispatch failed');
    assert.ok(Array.isArray(data.assignments), 'Assignments missing');
    assert.strictEqual(data.assignments.length, 2, 'Should dispatch both assignments');
    pass(`Batch deployed ${data.assignments.length} units simultaneously across emergency locations`);

    // Verify incidents transitioned to DISPATCHED
    const checkA = await (await fetch(`${BASE_URL}/incidents`)).json();
    const incA = checkA.incidents.find(i => i.id === incIdA);
    const incB = checkA.incidents.find(i => i.id === incIdB);
    assert.strictEqual(incA.status, 'DISPATCHED', 'Incident A status should be DISPATCHED');
    assert.strictEqual(incB.status, 'DISPATCHED', 'Incident B status should be DISPATCHED');
    pass('Both incidents updated in real-time to DISPATCHED status');
  } catch (e) {
    fail('Batch dispatch failed', e);
  }

  // --- Step 6: Cleanup Test Data ---
  console.log('\n--- Step 6: Cleanup Test Data ---');
  try {
    if (incIdA) await fetch(`${BASE_URL}/incidents/${incIdA}`, { method: 'DELETE' });
    if (incIdB) await fetch(`${BASE_URL}/incidents/${incIdB}`, { method: 'DELETE' });
    if (resourceId) await fetch(`${BASE_URL}/resources/${resourceId}`, { method: 'DELETE' });
    pass('Cleaned up test incidents and test resource');
  } catch (e) {
    fail('Cleanup failed', e);
  }

  console.log('\n===============================================================');
  console.log(`📊 EXECUTION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

runTests();
