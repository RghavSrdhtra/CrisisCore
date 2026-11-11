/**
 * Comprehensive Automated Verification for Incident Manager Lifecycle:
 * 1. Accept/Verify emergency request
 * 2. Reject emergency request with reason tracking
 * 3. Re-open request
 * 4. Individual Request Tracking Telemetry (Timeline milestones, Reporter details, Needs)
 * 5. Mark as Done / Resolved (with automated responder unit release)
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runIncidentManagerTests() {
  console.log('===============================================================');
  console.log('🚨 TESTING INCIDENT MANAGER ACCEPT / REJECT / DONE & TRACKING');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  let testIncidentId = null;
  let testIncidentNumber = null;

  try {
    // Step 1: Create incoming emergency request
    console.log('--- Step 1: Create Incoming Emergency SOS Request ---');
    const createRes = await request('POST', '/api/incidents', {
      type: 'COLLAPSE',
      severity: 'CRITICAL',
      title: 'Residential Structure Collapse in Old Delhi',
      description: 'Older brick building collapsed after monsoon storm. 12 residents trapped in basement.',
      address: 'Chandni Chowk Block B, Delhi',
      lat: 28.6562,
      lng: 77.2301,
      affectedCount: 12,
      resourceNeeds: {
        water_litres: 100,
        food_rations: 40,
        medical_kits: 6,
        ambulances: 2
      }
    });

    assert(createRes.status === 201 && createRes.data.incident?.id, 'Incoming disaster request created');
    testIncidentId = createRes.data.incident.id;
    testIncidentNumber = createRes.data.incident.incidentNumber;
    assert(createRes.data.incident.status === 'REPORTED', 'Initial request status is REPORTED');
    assert(createRes.data.incident.verificationStatus === 'PENDING', 'Initial verificationStatus is PENDING');

    // Step 2: Individual Request Tracking (Initial State)
    console.log('\n--- Step 2: Query Individual Request Tracking Telemetry ---');
    const trackRes1 = await request('GET', `/api/incidents/${testIncidentId}/tracking`);
    assert(trackRes1.status === 200 && trackRes1.data.incident?.id === testIncidentId, `Retrieved tracking data for ${testIncidentNumber}`);
    assert(Array.isArray(trackRes1.data.timeline) && trackRes1.data.timeline.length === 4, 'Tracking timeline contains 4 lifecycle stages');
    assert(trackRes1.data.timeline[0].status === 'COMPLETED', 'Timeline Stage 1 (Reported) is COMPLETED');
    assert(trackRes1.data.timeline[1].status === 'PENDING', 'Timeline Stage 2 (Triage) is PENDING');

    // Step 3: Incident Manager Rejects Request with Reason
    console.log('\n--- Step 3: Incident Manager Rejects Request ---');
    const rejectRes = await request('PATCH', `/api/incidents/${testIncidentId}/verify`, {
      action: 'REJECT',
      notes: 'Initial report flagged as duplicate of INC-2026-0098'
    });
    assert(rejectRes.status === 200, 'Incident Manager executed REJECT action');
    assert(rejectRes.data.incident?.verificationStatus === 'REJECTED', 'verificationStatus updated to REJECTED');
    assert(rejectRes.data.incident?.status === 'CANCELLED', 'Request status updated to CANCELLED');
    assert(rejectRes.data.incident?.managerNotes.includes('duplicate'), 'Rejection note recorded in audit log');

    // Step 4: Incident Manager Re-opens Triage
    console.log('\n--- Step 4: Incident Manager Re-Opens Request for Re-Evaluation ---');
    const reopenRes = await request('PATCH', `/api/incidents/${testIncidentId}/verify`, {
      action: 'REOPEN',
      notes: 'On-scene field officer confirmed unique incident - re-opening triage.'
    });
    assert(reopenRes.status === 200, 'Incident Manager executed REOPEN action');
    assert(reopenRes.data.incident?.verificationStatus === 'PENDING', 'verificationStatus reverted to PENDING');
    assert(reopenRes.data.incident?.status === 'REPORTED', 'Request status restored to REPORTED');

    // Step 5: Incident Manager Accepts Request
    console.log('\n--- Step 5: Incident Manager Accepts Request ---');
    const acceptRes = await request('PATCH', `/api/incidents/${testIncidentId}/verify`, {
      action: 'ACCEPT',
      notes: 'Emergency confirmed valid. Queuing for AI resource allocation.'
    });
    assert(acceptRes.status === 200, 'Incident Manager executed ACCEPT action');
    assert(acceptRes.data.incident?.verificationStatus === 'VERIFIED', 'verificationStatus updated to VERIFIED');
    assert(acceptRes.data.incident?.status === 'TRIAGED', 'Request status updated to TRIAGED');

    // Step 6: Dispatch Responder via AI Recommendation & HITL Approval
    console.log('\n--- Step 6: Dispatch Mission via AI Recommendation ---');
    const recRes = await request('POST', '/api/assignments/recommend', { incidentId: testIncidentId });
    assert(recRes.status === 200 && recRes.data.recommendation?.recommendedResponder, 'AI matched responder for verified request');
    const chosenResp = recRes.data.recommendation.recommendedResponder;

    const approveRes = await request('POST', '/api/assignments/approve', {
      incidentId: testIncidentId,
      responderId: chosenResp.id,
      allocatedSupplies: recRes.data.recommendation.allocatedSupplies,
      stopSequence: recRes.data.recommendation.stopSequence,
      notes: 'Mission approved by Admin for accepted request'
    });
    assert(approveRes.status === 201 && approveRes.data.assignment?.status === 'DISPATCHED', 'Mission dispatched to responder unit');

    // Step 7: Incident Manager Marks Request as DONE
    console.log('\n--- Step 7: Incident Manager Marks Request as DONE ---');
    const doneRes = await request('PATCH', `/api/incidents/${testIncidentId}/verify`, {
      action: 'DONE',
      notes: 'All trapped residents rescued and treated. Perimeter secured and mission marked DONE.'
    });
    assert(doneRes.status === 200, 'Incident Manager executed DONE action');
    assert(doneRes.data.incident?.status === 'RESOLVED', 'Request status transitioned to RESOLVED');
    assert(doneRes.data.incident?.resolvedAt, `Resolution timestamp recorded: ${doneRes.data.incident?.resolvedAt}`);

    // Step 8: Verify Automated Release of Responders back to AVAILABLE
    console.log('\n--- Step 8: Verify Automated Release of Assigned Responder Units ---');
    const respCheck = await request('GET', `/api/responders/${chosenResp.id}`);
    const freedUnit = respCheck.data.responder;
    assert(freedUnit && freedUnit.status === 'AVAILABLE', `Assigned responder (${freedUnit?.callsign}) automatically released back to AVAILABLE status`);

    // Step 9: Final Individual Tracking Telemetry Check
    console.log('\n--- Step 9: Final Individual Tracking Telemetry Verification ---');
    const finalTrack = await request('GET', `/api/incidents/${testIncidentId}/tracking`);
    assert(finalTrack.status === 200, 'Retrieved final tracking telemetry');
    assert(finalTrack.data.currentStatus === 'RESOLVED', 'Final tracking status is RESOLVED');
    assert(finalTrack.data.timeline[3].status === 'COMPLETED', 'Timeline Stage 4 (Mission Resolved & Done) is COMPLETED');

    // Cleanup
    console.log('\n--- Step 10: Cleanup Test Data ---');
    const delRes = await request('DELETE', `/api/incidents/${testIncidentId}`);
    assert(delRes.status === 200, 'Test incident cleaned up');

  } catch (err) {
    assert(false, `Unexpected exception: ${err.message}`);
  }

  console.log('\n===============================================================');
  console.log(`📊 EXECUTION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed === 0) {
    console.log('🎉 ALL INCIDENT MANAGER LIFECYCLE & TRACKING FEATURES WORK FLAWLESSLY!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runIncidentManagerTests().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
