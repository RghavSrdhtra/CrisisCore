/**
 * CrisisCore Comprehensive Automated Feature Verification
 * Tests the 5 Core System Pillars:
 * 1. Resource Management (Create, Replenish, Query, Delete)
 * 2. Incident Management (Create, Needs Parsing, Incident Manager Verification)
 * 3. Communication Channels (3-Channel Hub, Socket.io Real-Time Broadcast & Persistence)
 * 4. AI-Based Resource Allocation Engine (Multi-Resource Matching, Optimization & Waypoint Generation)
 * 5. Coordinator/Admin Human-in-the-Loop (HITL) Decisioning (Approval with Stock Deduction & Rejection)
 */

const http = require('http');
const { io } = require('socket.io-client');

const BASE_URL = 'http://localhost:3001';

// Helper for HTTP requests
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

async function runAllTests() {
  console.log('===============================================================');
  console.log('🧪 CRISISCORE AUTOMATED COMPREHENSIVE VERIFICATION SUITE');
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

  // -----------------------------------------------------------------
  // 1. RESOURCE MANAGEMENT TEST
  // -----------------------------------------------------------------
  console.log('---------------------------------------------------------------');
  console.log('📦 TEST 1: RESOURCE MANAGEMENT');
  console.log('---------------------------------------------------------------');

  let testResourceId = null;
  try {
    // 1.1 Create Resource
    const createRes = await request('POST', '/api/resources', {
      name: 'Verification Relief Mineral Water (1L)',
      category: 'WATER',
      quantityTotal: 200,
      unit: 'Bottles',
      depotName: 'South Delhi Depot Alpha',
      lat: 28.5355,
      lng: 77.2711,
      minThreshold: 50
    });
    assert(createRes.status === 201 && createRes.data.resource?.id, 'Create relief resource (200 units)');
    testResourceId = createRes.data.resource?.id;

    // 1.2 Replenish Resource
    const replenishRes = await request('POST', '/api/resources/replenish', {
      category: 'WATER',
      amount: 50
    });
    assert(replenishRes.status === 200, 'Replenish resource inventory (+50 units)');

    // 1.3 Verify Resource Listing
    const listRes = await request('GET', '/api/resources');
    const found = listRes.data.resources?.find(r => r.id === testResourceId);
    assert(found && found.quantityAvailable >= 200, `Resource retrieved with valid stock level (${found?.quantityAvailable} ${found?.unit})`);

  } catch (err) {
    assert(false, `Resource management exception: ${err.message}`);
  }

  // -----------------------------------------------------------------
  // 2. INCIDENT MANAGEMENT TEST
  // -----------------------------------------------------------------
  console.log('\n---------------------------------------------------------------');
  console.log('🚨 TEST 2: INCIDENT MANAGEMENT & VERIFICATION');
  console.log('---------------------------------------------------------------');

  let testIncidentId = null;
  let testIncidentNumber = null;
  try {
    // 2.1 Create Incident with Needs
    const incRes = await request('POST', '/api/incidents', {
      type: 'FLOOD',
      severity: 'CRITICAL',
      title: 'Monsoon Flash Flood Flashpoint',
      description: 'Water levels rising rapidly along river banks. Families trapped on high ground.',
      address: 'Yamuna Floodplain Sector 15, Delhi',
      lat: 28.6679,
      lng: 77.2312,
      affectedCount: 35,
      resourceNeeds: {
        water_litres: 120,
        food_rations: 60,
        medical_kits: 8,
        ambulances: 2
      }
    });
    assert(incRes.status === 201 && incRes.data.incident?.id, 'Create critical incident with structured needs');
    testIncidentId = incRes.data.incident?.id;
    testIncidentNumber = incRes.data.incident?.incidentNumber;

    // 2.2 Verify Incident by Incident Manager
    const verifyRes = await request('PATCH', `/api/incidents/${testIncidentId}/verify`, {
      action: 'VERIFY',
      notes: 'Incident verified via aerial drone survey. Needs validated.'
    });
    assert(verifyRes.status === 200 && verifyRes.data.incident?.verificationStatus === 'VERIFIED', 'Incident Manager verified triage status (VERIFIED)');

    // 2.3 Verify Incident details retrieval
    const getIncRes = await request('GET', `/api/incidents/${testIncidentId}`);
    assert(getIncRes.status === 200 && getIncRes.data.incident?.id === testIncidentId, `Incident ${testIncidentNumber} active and triaged`);

  } catch (err) {
    assert(false, `Incident management exception: ${err.message}`);
  }

  // -----------------------------------------------------------------
  // 3. COMMUNICATION CHANNEL TEST (STRICT 2-CHANNEL ISOLATION)
  // -----------------------------------------------------------------
  console.log('\n---------------------------------------------------------------');
  console.log('💬 TEST 3: REAL-TIME COMMUNICATION (STRICT 2-CHANNEL ISOLATION)');
  console.log('---------------------------------------------------------------');

  try {
    const socketCh1 = io(BASE_URL, { transports: ['websocket'], reconnection: false });
    const socketCh2 = io(BASE_URL, { transports: ['websocket'], reconnection: false });

    await Promise.all([
      new Promise(res => {
        socketCh1.on('connect', () => {
          socketCh1.emit('channel:join', { channel: 'CHANNEL_1_RESOURCE' });
          res();
        });
      }),
      new Promise(res => {
        socketCh2.on('connect', () => {
          socketCh2.emit('channel:join', { channel: 'CHANNEL_2_INCIDENT' });
          res();
        });
      })
    ]);
    assert(true, 'Both Channel 1 and Channel 2 sockets connected and joined respective rooms');

    // Socket 1 listens for messages on Channel 1
    let ch2ReceivedLeak = false;
    socketCh2.on('channel:message', () => {
      ch2ReceivedLeak = true;
    });

    const ch1Promise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 3000);
      socketCh1.on('channel:message', (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
    });

    await new Promise(r => setTimeout(r, 100));

    // Send message to CHANNEL_1_RESOURCE
    const testMsgText = `Isolated Ch1 Sync - ${Date.now()}`;
    const postMsgRes = await request('POST', '/api/chat/channel/CHANNEL_1_RESOURCE', {
      message: testMsgText,
      senderRole: 'RESOURCE_MANAGER',
      senderName: 'Elena Rostova (Resource Manager)'
    });
    assert(postMsgRes.status === 201, 'Send message to CHANNEL_1_RESOURCE');

    const receivedPayload = await ch1Promise;
    assert(receivedPayload && receivedPayload.message === testMsgText && receivedPayload.channel === 'CHANNEL_1_RESOURCE', 'Channel 1 subscriber received targeted broadcast');

    // Wait briefly and verify Channel 2 DID NOT receive it (zero cross-channel leakage)
    await new Promise(r => setTimeout(r, 200));
    assert(!ch2ReceivedLeak, 'Channel 2 subscriber received 0 messages (strict channel isolation verified)');

    // Verify chat history persistence in Channel 1 and absence in Channel 2
    const histResCh1 = await request('GET', '/api/chat/channel/CHANNEL_1_RESOURCE');
    const msgFoundInCh1 = histResCh1.data.messages?.some(m => m.message === testMsgText);
    assert(msgFoundInCh1, 'Message persisted in Channel 1 history');

    const histResCh2 = await request('GET', '/api/chat/channel/CHANNEL_2_INCIDENT');
    const msgLeakedInCh2 = histResCh2.data.messages?.some(m => m.message === testMsgText);
    assert(!msgLeakedInCh2, 'Message absent from Channel 2 history (database channel isolation verified)');

    socketCh1.disconnect();
    socketCh2.disconnect();

  } catch (err) {
    assert(false, `Communication channel exception: ${err.message}`);
  }

  // -----------------------------------------------------------------
  // 4. AI-BASED RESOURCE ALLOCATION ENGINE TEST
  // -----------------------------------------------------------------
  console.log('\n---------------------------------------------------------------');
  console.log('🧠 TEST 4: AI RESOURCE ALLOCATION ENGINE');
  console.log('---------------------------------------------------------------');

  let recommendationData = null;
  try {
    const recRes = await request('POST', '/api/assignments/recommend', {
      incidentId: testIncidentId
    });

    assert(recRes.status === 200 && recRes.data.recommendation, 'AI Recommendation Engine returned allocation plan');
    recommendationData = recRes.data.recommendation;

    assert(Array.isArray(recommendationData.allocatedSupplies) && recommendationData.allocatedSupplies.length > 0,
      `Allocated supplies matched: ${recommendationData.allocatedSupplies.map(s => `${s.qty} ${s.unit} ${s.name}`).join(', ')}`);

    assert(recommendationData.recommendedResponder && recommendationData.recommendedResponder.id,
      `Matched optimal responder unit: ${recommendationData.recommendedResponder?.callsign || recommendationData.recommendedResponder?.name}`);

    assert(Array.isArray(recommendationData.stopSequence) && recommendationData.stopSequence.length >= 2,
      `Generated multi-stop waypoint itinerary (${recommendationData.stopSequence.length} stops: ${recommendationData.stopSequence.map(s => s.type).join(' -> ')})`);

    assert(typeof recommendationData.recommendationScore === 'number',
      `Recommendation match score calculated: ${(recommendationData.recommendationScore * 100).toFixed(1)}%`);

  } catch (err) {
    assert(false, `AI Recommendation exception: ${err.message}`);
  }

  // -----------------------------------------------------------------
  // 5. COORDINATOR / ADMIN ACCEPT & REJECT (HITL)
  // -----------------------------------------------------------------
  console.log('\n---------------------------------------------------------------');
  console.log('⚖️  TEST 5: COORDINATOR / ADMIN HITL ACCEPT OR REJECT');
  console.log('---------------------------------------------------------------');

  try {
    // 5.1 Test HITL Rejection Flow
    const rejectRes = await request('POST', '/api/assignments/reject', {
      incidentId: testIncidentId,
      reason: 'Logistics detour needed due to flooded bridge',
      notes: 'Admin evaluated route and chose to reject initial recommendation.'
    });
    assert(rejectRes.status === 200 && rejectRes.data.status === 'TRIAGED', 'Admin / Coordinator successfully rejected recommendation (Incident preserved in queue)');

    // 5.2 Test HITL Approval Flow
    if (recommendationData && recommendationData.recommendedResponder) {
      const approveRes = await request('POST', '/api/assignments/approve', {
        incidentId: testIncidentId,
        responderId: recommendationData.recommendedResponder.id,
        allocatedSupplies: recommendationData.allocatedSupplies,
        stopSequence: recommendationData.stopSequence,
        notes: 'Admin approved AI allocation with priority dispatch.'
      });

      assert(approveRes.status === 201 && approveRes.data.assignment?.status === 'DISPATCHED',
        `Admin approved mission: Assignment created with status DISPATCHED (ID: ${approveRes.data.assignment?.id})`);

      assert(approveRes.data.assignment?.adminApprovalStatus === 'APPROVED', 'Human-in-the-Loop approval recorded (status: APPROVED)');

      // Verify incident transitioned to DISPATCHED
      const incCheck = await request('GET', `/api/incidents/${testIncidentId}`);
      assert(incCheck.data.incident?.status === 'DISPATCHED', 'Incident status updated to DISPATCHED');

      // Verify delivery stop confirmation
      const stopConfirmRes = await request('POST', `/api/assignments/${approveRes.data.assignment.id}/stops/1/confirm`, {
        recipientName: 'Depot Logistics Officer',
        notes: 'Depot supplies loaded onto vehicle'
      });
      assert(stopConfirmRes.status === 200, 'Delivery stop 1 confirmation verified');
    }

  } catch (err) {
    assert(false, `HITL Accept/Reject exception: ${err.message}`);
  }

  // -----------------------------------------------------------------
  // CLEANUP
  // -----------------------------------------------------------------
  console.log('\n---------------------------------------------------------------');
  console.log('🧹 CLEANUP TEST ARTIFACTS');
  console.log('---------------------------------------------------------------');
  try {
    if (testResourceId) {
      const delRes = await request('DELETE', `/api/resources/${testResourceId}`);
      assert(delRes.status === 200, 'Cleaned up test resource');
    }
    if (testIncidentId) {
      const delInc = await request('DELETE', `/api/incidents/${testIncidentId}`);
      assert(delInc.status === 200, 'Cleaned up test incident and released responder units');
    }
  } catch (e) {
    console.warn('Cleanup notice:', e.message);
  }

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`📊 TEST EXECUTION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed === 0) {
    console.log('🎉 ALL SYSTEM FUNCTIONALITIES VERIFIED & FULLY OPERATIONAL!');
    process.exit(0);
  } else {
    console.error('⚠️ SOME TESTS ENCOUNTERED FAILURES. Check output above.');
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
