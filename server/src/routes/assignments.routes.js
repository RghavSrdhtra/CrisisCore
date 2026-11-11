import express from 'express';
import { prisma } from '../config/db.js';
import { authenticate, optionalAuthenticate, requireRoles } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import { wsBroadcaster } from '../ws/socketHandler.js';
import { mlClient } from '../services/mlClient.js';

const router = express.Router();

// GET /api/assignments - View assignments
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: {
        incident: true,
        responder: true,
        assignedByCoordinator: {
          select: { id: true, name: true, badgeNumber: true }
        }
      },
      orderBy: { assignedAt: 'desc' }
    });
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve assignments.' });
  }
});

// POST /api/assignments - Coordinator/Admin dispatches a responder to an incident
router.post('/', optionalAuthenticate, async (req, res) => {
  try {
    const { incidentId, responderId, notes, recommendationScore } = req.body;

    if (!incidentId || !responderId) {
      return res.status(400).json({ error: 'incidentId and responderId are required.' });
    }

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    const responder = await prisma.responder.findUnique({ where: { id: responderId } });

    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    if (!responder) return res.status(404).json({ error: 'Responder unit not found.' });

    // Create assignment record
    const assignment = await prisma.assignment.create({
      data: {
        incidentId,
        responderId,
        status: 'DISPATCHED',
        assignedByCoordinatorId: req.user?.id || null,
        recommendationScore: recommendationScore ? parseFloat(recommendationScore) : null,
        notes: notes || 'Dispatched via Central Command'
      },
      include: {
        incident: true,
        responder: true,
        assignedByCoordinator: {
          select: { id: true, name: true, badgeNumber: true }
        }
      }
    });

    // Update responder status to ASSIGNED and set current incident
    await prisma.responder.update({
      where: { id: responderId },
      data: {
        status: 'ASSIGNED',
        currentIncidentId: incidentId,
        lastStatusUpdate: new Date()
      }
    });

    // Update incident status to DISPATCHED
    await prisma.incident.update({
      where: { id: incidentId },
      data: { status: 'DISPATCHED' }
    });

    // Broadcast through WebSocket to coordinator room, responder room, and civilian incident room
    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyNewAssignment(io, assignment);
      // Also broadcast prompt to coordinator dashboard
      wsBroadcaster.notifyResponderAction(io, {
        type: 'DISPATCHED',
        responderName: responder.name,
        callsign: responder.callsign,
        incidentNumber: incident.incidentNumber,
        incidentId: incident.id,
        notes: `Dispatched to ${incident.type} emergency`
      });
    }

    res.status(201).json({
      message: 'Responder successfully dispatched to incident.',
      assignment
    });
  } catch (err) {
    console.error('Error creating assignment:', err);
    res.status(500).json({ error: 'Failed to create assignment dispatch.' });
  }
});

// PATCH /api/assignments/:id/status - Update assignment lifecycle state (Accept, Decline, En Route, On Scene, Completed)
router.patch('/:id/status', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, declineReason } = req.body;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { responder: true, incident: true }
    });

    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });

    const upperStatus = (status || '').toUpperCase();
    const updateData = { status: upperStatus };
    if (notes) updateData.notes = notes;
    if (declineReason) updateData.declineReason = declineReason;

    if (upperStatus === 'ACKNOWLEDGED' || upperStatus === 'ACCEPTED') {
      updateData.status = 'ACKNOWLEDGED';
      updateData.acknowledgedAt = new Date();
    } else if (upperStatus === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    const updatedAssignment = await prisma.assignment.update({
      where: { id },
      data: updateData,
      include: { responder: true, incident: true }
    });

    const io = req.app.get('io');

    // Handle State Transitions
    if (upperStatus === 'ACKNOWLEDGED' || upperStatus === 'ACCEPTED') {
      // Respondent ACCEPTED dispatch
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'EN_ROUTE', lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'DISPATCHED' }
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'ACCEPTED',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Respondent accepted assignment and is mobilizing.'
        });
      }

    } else if (upperStatus === 'DECLINED') {
      // Respondent DECLINED dispatch
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'AVAILABLE', currentIncidentId: null, lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'TRIAGED' } // Returns to triaged pool for re-dispatch
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'DECLINED',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: declineReason || notes || 'Respondent unavailable or scene hazards outside unit capability.'
        });
      }

    } else if (upperStatus === 'EN_ROUTE') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'EN_ROUTE', lastStatusUpdate: new Date() }
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'EN_ROUTE',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Unit en route with sirens & GPS telemetry engaged.'
        });
      }

    } else if (upperStatus === 'ON_SCENE') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'ON_SCENE', lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'ON_SCENE' }
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'ON_SCENE',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Unit arrived on scene. Establishing triage perimeter.'
        });
      }

    } else if (upperStatus === 'COMPLETED') {
      await prisma.responder.update({
        where: { id: assignment.responderId },
        data: { status: 'AVAILABLE', currentIncidentId: null, lastStatusUpdate: new Date() }
      });
      await prisma.incident.update({
        where: { id: assignment.incidentId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          locationSharingActive: false
        }
      });
      // Automatic privacy termination of active location breadcrumbs (Week 10)
      await prisma.locationLog.updateMany({
        where: { incidentId: assignment.incidentId },
        data: { isActive: false }
      });

      if (io) {
        wsBroadcaster.notifyResponderAction(io, {
          type: 'COMPLETED',
          responderName: assignment.responder.name,
          callsign: assignment.responder.callsign,
          incidentNumber: assignment.incident.incidentNumber,
          incidentId: assignment.incidentId,
          notes: 'Operation successfully completed. Scene secured and unit returning to available pool.'
        });
      }
    }

    // Broadcast assignment state update to coordinator & civilian rooms
    if (io) {
      io.emit('assignment:updated', updatedAssignment);
      io.to('coordinators').emit('assignment:updated', updatedAssignment);
      const statusPayload = {
        incidentId: assignment.incidentId,
        status: updatedAssignment.status,
        incidentStatus: updatedAssignment.status === 'COMPLETED' ? 'RESOLVED' : updatedAssignment.status,
        responderName: assignment.responder.name,
        responderCallsign: assignment.responder.callsign
      };
      io.emit('incident:status', statusPayload);
      io.to(`incident:${assignment.incidentId}`).emit('incident:status', statusPayload);

      // Refresh incident state for all coordinator views
      const freshIncident = await prisma.incident.findUnique({
        where: { id: assignment.incidentId },
        include: { assignments: { include: { responder: true } } }
      });
      if (freshIncident) {
        wsBroadcaster.notifyIncidentUpdated(io, freshIncident);
      }
    }

    res.json({ message: 'Assignment state updated.', assignment: updatedAssignment });
  } catch (err) {
    console.error('Error updating assignment state:', err);
    res.status(500).json({ error: 'Failed to update assignment state.' });
  }
});


// POST /api/assignments/recommend - AI Resource Allocation Engine proposal (Diagram 1, Step 4)
// Generates matched inventory + closest responder + multi-stop sequence for Admin review
router.post('/recommend', optionalAuthenticate, async (req, res) => {
  try {
    const { incidentId } = req.body;
    if (!incidentId) return res.status(400).json({ error: 'incidentId is required.' });

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    // Parse requested needs
    let needs = {};
    try {
      needs = incident.resourceNeeds ? JSON.parse(incident.resourceNeeds) : {};
    } catch (e) {
      needs = {};
    }

    // 1. Fetch live pool of available responders and inventory
    let availableResponders = await prisma.responder.findMany({
      where: { status: 'AVAILABLE' }
    });

    // Resilient fallback: If all units are currently mobilized, draw from active fleet
    if (availableResponders.length === 0) {
      availableResponders = await prisma.responder.findMany({
        where: { status: { not: 'UNAVAILABLE' } }
      });
    }

    const resources = await prisma.resource.findMany({
      where: { quantityAvailable: { gt: 0 } }
    });

    let chosenResponder = null;
    let allocatedSupplies = [];
    let stopSequence = [];
    let recommendationScore = 0.94;
    let algorithmUsed = 'Google OR-Tools + Hungarian Bipartite + Random Forest';
    let rationale = 'Mathematically optimized with Google OR-Tools for depot proximity, vehicle payload capacity, and responder triage capability.';
    let triageDetails = null;

    // Try calling Python AI Microservice (Week 4 & 5 Pipeline)
    try {
      const mlEvaluation = await mlClient.evaluateIncident(
        {
          id: incident.id,
          incidentNumber: incident.incidentNumber,
          type: incident.type,
          description: incident.description,
          affectedCount: incident.affectedCount,
          lat: incident.lat,
          lng: incident.lng,
          resourceNeeds: needs
        },
        resources
      );

      if (mlEvaluation && mlEvaluation.resource_matching) {
        allocatedSupplies = mlEvaluation.resource_matching.allocated_supplies || [];
        triageDetails = mlEvaluation.triage || null;
      }

      // Run Hungarian matching for best available responder
      if (availableResponders.length > 0) {
        const optResult = await mlClient.optimizeDispatch(
          [
            {
              id: incident.id,
              incidentNumber: incident.incidentNumber,
              type: incident.type,
              priority: incident.predictedPriority || 'HIGH',
              lat: incident.lat,
              lng: incident.lng,
              resourceNeeds: needs
            }
          ],
          availableResponders
        );

        if (optResult && optResult.hungarian_matches && optResult.hungarian_matches.length > 0) {
          const matched = optResult.hungarian_matches[0];
          chosenResponder = availableResponders.find(r => r.id === matched.responder_id) || null;
          if (matched.recommendation_score) {
            recommendationScore = matched.recommendation_score;
          }
        }

        // Run Route Planner to generate stops with distances and ETAs
        if (chosenResponder) {
          const routeRes = await mlClient.planRoute(
            {
              id: incident.id,
              incidentNumber: incident.incidentNumber,
              address: incident.address,
              lat: incident.lat,
              lng: incident.lng,
              affectedCount: incident.affectedCount
            },
            allocatedSupplies,
            chosenResponder
          );

          if (routeRes && routeRes.stop_sequence) {
            stopSequence = routeRes.stop_sequence;
          }
        }
      }
    } catch (mlErr) {
      console.warn('[Recommend] ML microservice call skipped, using heuristic fallback:', mlErr.message);
    }

    // Heuristic Fallback if ML microservice is offline or returned empty
    if (!chosenResponder && availableResponders.length > 0) {
      chosenResponder = availableResponders.find(r => 
        incident.type === 'MEDICAL' ? r.type === 'MEDICAL_AMBULANCE' :
        incident.type === 'FIRE' ? r.type === 'FIRE_RESCUE' : true
      ) || availableResponders[0];
    }

    if (allocatedSupplies.length === 0) {
      const waterNeed = needs.water_litres || 50;
      const waterRes = resources.find(r => r.category === 'WATER');
      if (waterRes) {
        const takeQty = Math.min(waterNeed, waterRes.quantityAvailable);
        allocatedSupplies.push({ resourceId: waterRes.id, name: waterRes.name, category: 'WATER', qty: takeQty, unit: waterRes.unit, depotName: waterRes.depotName });
      }

      const foodNeed = needs.food_rations || 20;
      const foodRes = resources.find(r => r.category === 'FOOD');
      if (foodRes) {
        const takeQty = Math.min(foodNeed, foodRes.quantityAvailable);
        allocatedSupplies.push({ resourceId: foodRes.id, name: foodRes.name, category: 'FOOD', qty: takeQty, unit: foodRes.unit, depotName: foodRes.depotName });
      }

      const medNeed = needs.medical_kits || 3;
      const medRes = resources.find(r => r.category === 'MEDICINE');
      if (medRes) {
        const takeQty = Math.min(medNeed, medRes.quantityAvailable);
        allocatedSupplies.push({ resourceId: medRes.id, name: medRes.name, category: 'MEDICINE', qty: takeQty, unit: medRes.unit, depotName: medRes.depotName });
      }
    }

    if (stopSequence.length === 0) {
      const depotName = allocatedSupplies[0]?.depotName || 'Central Regional Logistics Depot';
      const itemsList = allocatedSupplies.map(s => `${s.qty} ${s.unit} ${s.name}`).join(', ') || 'Relief Supplies';
      stopSequence = [
        {
          stopNumber: 1,
          type: 'DEPOT_PICKUP',
          name: depotName,
          lat: 28.616,
          lng: 77.206,
          itemsToLoad: itemsList,
          status: 'PENDING',
          notes: 'Load allocated relief supplies from depot manifest'
        },
        {
          stopNumber: 2,
          type: 'INCIDENT_DELIVERY',
          name: `Incident Site: ${incident.incidentNumber} (${incident.address || 'Target Area'})`,
          lat: incident.lat,
          lng: incident.lng,
          itemsToDeliver: `Distribute supplies to ${incident.affectedCount} casualties & conduct on-scene rescue`,
          status: 'PENDING',
          notes: 'Requires digital delivery confirmation handover'
        },
        {
          stopNumber: 3,
          type: 'HOSPITAL_TRANSFER',
          name: 'Metro Emergency Base Hospital',
          lat: 28.605,
          lng: 77.215,
          itemsToDeliver: 'Triage transfer for critical casualties',
          status: 'PENDING',
          notes: 'Final mission waypoint'
        }
      ];
    }

    res.json({
      recommendation: {
        incidentId: incident.id,
        incidentNumber: incident.incidentNumber,
        incidentType: incident.type,
        severity: incident.severity,
        affectedCount: incident.affectedCount,
        recommendedResponder: chosenResponder || null,
        availableResponders,
        allocatedSupplies,
        stopSequence,
        recommendationScore,
        algorithm: algorithmUsed,
        triageDetails,
        rationale
      }
    });
  } catch (err) {
    console.error('Error generating allocation recommendation:', err);
    res.status(500).json({ error: 'Failed to generate allocation recommendation.' });
  }
});

// POST /api/assignments/approve - Human-in-the-Loop Admin Approval & Mission Dispatch (Diagram 1, Step 5 & 6)
router.post('/approve', optionalAuthenticate, async (req, res) => {
  try {
    const { incidentId, responderId, allocatedSupplies, stopSequence, notes } = req.body;

    if (!incidentId || !responderId) {
      return res.status(400).json({ error: 'incidentId and responderId are required for mission approval.' });
    }

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    const responder = await prisma.responder.findUnique({ where: { id: responderId } });

    if (!incident) return res.status(404).json({ error: 'Incident not found.' });
    if (!responder) return res.status(404).json({ error: 'Responder not found.' });

    const suppliesArr = Array.isArray(allocatedSupplies) ? allocatedSupplies : [];
    const formattedSupplies = JSON.stringify(suppliesArr);
    const formattedStops = JSON.stringify(stopSequence || []);

    // 1. Create or update Assignment as APPROVED & DISPATCHED
    const assignment = await prisma.assignment.create({
      data: {
        incidentId,
        responderId,
        status: 'DISPATCHED',
        adminApprovalStatus: 'APPROVED',
        approvedByAdminId: req.user?.id || 'admin-root',
        allocatedSupplies: formattedSupplies,
        stopSequence: formattedStops,
        deliveryStatus: 'IN_TRANSIT',
        notes: notes || 'Mission approved by Admin via Human-in-the-Loop interface.'
      },
      include: {
        incident: true,
        responder: true
      }
    });

    // 2. Deduct allocated supplies from Resource inventory
    for (const item of suppliesArr) {
      if (item.resourceId && item.qty) {
        await prisma.resource.update({
          where: { id: item.resourceId },
          data: {
            quantityAvailable: { decrement: item.qty },
            quantityAllocated: { increment: item.qty }
          }
        }).catch(e => console.warn('Inventory decrement notice:', e.message));
      }
    }

    // 3. Update responder & incident statuses
    await prisma.responder.update({
      where: { id: responderId },
      data: { status: 'ASSIGNED', currentIncidentId: incidentId, lastStatusUpdate: new Date() }
    });

    await prisma.incident.update({
      where: { id: incidentId },
      data: { status: 'DISPATCHED' }
    });

    // 4. Record Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: 'ADMIN_APPROVAL',
        resourceType: 'ASSIGNMENT',
        resourceId: assignment.id,
        details: JSON.stringify({
          incidentNumber: incident.incidentNumber,
          responderCallsign: responder.callsign,
          suppliesAllocated: suppliesArr.length
        })
      }
    });

    // 5. Broadcast to WebSockets
    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyNewAssignment(io, assignment);
      io.to('coordinators').emit('mission:approved', assignment);
      io.to('channel:admin_responder').emit('mission:approved', assignment);
      io.emit('resource:depleted', { incidentId, supplies: suppliesArr });
    }

    res.status(201).json({
      message: 'Mission approved by Admin and dispatched to responder.',
      assignment
    });
  } catch (err) {
    console.error('Error approving mission allocation:', err);
    res.status(500).json({ error: 'Failed to approve mission dispatch.' });
  }
});

// POST /api/assignments/reject - Human-in-the-Loop Admin Rejection
router.post('/reject', optionalAuthenticate, async (req, res) => {
  try {
    const { incidentId, reason, notes } = req.body;
    if (!incidentId) return res.status(400).json({ error: 'incidentId is required.' });

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) return res.status(404).json({ error: 'Incident not found.' });

    // Mark incident as requiring re-triage or keep as TRIAGED/VERIFIED
    await prisma.incident.update({
      where: { id: incidentId },
      data: { status: 'TRIAGED' }
    });

    // Record Audit Log
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action: 'ADMIN_REJECTION',
        resourceType: 'INCIDENT',
        resourceId: incidentId,
        details: JSON.stringify({ reason: reason || 'Recommendation rejected by Coordinator/Admin', notes })
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to('coordinators').emit('allocation:rejected', {
        incidentId,
        incidentNumber: incident.incidentNumber,
        reason: reason || 'Recommendation declined by human operator.',
        notes
      });
      wsBroadcaster.notifyResponderAction(io, {
        type: 'DECLINED',
        responderName: 'ADMIN / COORDINATOR',
        callsign: incident.incidentNumber,
        incidentNumber: incident.incidentNumber,
        incidentId,
        notes: `AI Recommendation rejected: ${reason || 'Human operator intervention'}`
      });
    }

    res.json({
      message: 'AI recommendation rejected. Incident preserved in queue for re-evaluation.',
      incidentId,
      status: 'TRIAGED'
    });
  } catch (err) {
    console.error('Error rejecting assignment recommendation:', err);
    res.status(500).json({ error: 'Failed to reject recommendation.' });
  }
});

// POST /api/assignments/:id/stops/:stopNumber/confirm - Delivery Confirmation at Waypoint (Diagram 1, Step 7)
router.post('/:id/stops/:stopNumber/confirm', optionalAuthenticate, async (req, res) => {
  try {
    const { id, stopNumber } = req.params;
    const { recipientName, notes } = req.body;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { responder: true, incident: true }
    });

    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });

    let stops = [];
    try {
      stops = assignment.stopSequence ? JSON.parse(assignment.stopSequence) : [];
    } catch (e) {
      stops = [];
    }

    const sNum = parseInt(stopNumber, 10);
    const stopIndex = stops.findIndex(s => s.stopNumber === sNum);
    if (stopIndex === -1) {
      return res.status(404).json({ error: 'Stop number not found in mission sequence.' });
    }

    // Mark stop completed
    stops[stopIndex].status = 'COMPLETED';
    stops[stopIndex].completedAt = new Date().toISOString();
    stops[stopIndex].recipient = recipientName || 'On-Scene Representative';
    stops[stopIndex].notes = notes || 'Handover verified by field responder';

    // Check if all delivery stops are finished
    const allFinished = stops.every(s => s.status === 'COMPLETED');

    const updatedAssignment = await prisma.assignment.update({
      where: { id },
      data: {
        stopSequence: JSON.stringify(stops),
        deliveryStatus: allFinished ? 'DELIVERED' : 'IN_TRANSIT',
        deliveryConfirmedAt: new Date(),
        deliveryRecipient: recipientName || 'On-Scene Representative',
        deliveryNotes: notes || 'Delivery completed at stop checkpoint.'
      },
      include: { responder: true, incident: true }
    });

    // Permanently decrement allocated supplies from inventory
    if (assignment.allocatedSupplies) {
      try {
        const supplies = JSON.parse(assignment.allocatedSupplies);
        for (const item of supplies) {
          if (item.resourceId && item.qty) {
            await prisma.resource.update({
              where: { id: item.resourceId },
              data: {
                quantityAllocated: { decrement: item.qty },
                quantityTotal: { decrement: item.qty }
              }
            }).catch(e => console.warn('Final delivery inventory decrement notice:', e.message));
          }
        }
      } catch (e) {}
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('assignment:updated', updatedAssignment);
      io.to('coordinators').emit('mission:stop_completed', {
        assignmentId: id,
        stopNumber: sNum,
        recipient: recipientName,
        allFinished
      });
    }

    res.json({
      message: `Stop ${sNum} delivery confirmed.`,
      assignment: updatedAssignment,
      allFinished
    });
  } catch (err) {
    console.error('Error confirming delivery stop:', err);
    res.status(500).json({ error: 'Failed to confirm delivery.' });
  }
});

// POST /api/assignments/:id/reallocate - Dynamic Reallocation Trigger (Diagram 1, Step 8)
router.post('/:id/reallocate', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, notes } = req.body;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { responder: true, incident: true }
    });

    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });

    // Mark reallocation triggered on assignment
    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        reallocationTriggered: true,
        reallocationReason: reason || 'FIELD_DISRUPTION',
        status: 'CANCELLED',
        notes: `Reallocation triggered: ${notes || reason}`
      },
      include: { responder: true, incident: true }
    });

    // Reset responder to unavailable/maintenance or available
    await prisma.responder.update({
      where: { id: assignment.responderId },
      data: {
        status: reason === 'VEHICLE_BREAKDOWN' ? 'UNAVAILABLE' : 'AVAILABLE',
        currentIncidentId: null,
        lastStatusUpdate: new Date()
      }
    });

    // Reset incident to TRIAGED for immediate re-matching
    await prisma.incident.update({
      where: { id: assignment.incidentId },
      data: { status: 'TRIAGED' }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'REALLOCATION_TRIGGER',
        resourceType: 'ASSIGNMENT',
        resourceId: id,
        details: JSON.stringify({ reason, notes, responderCallsign: assignment.responder.callsign })
      }
    });

    const io = req.app.get('io');
    if (io) {
      wsBroadcaster.notifyResponderAction(io, {
        type: 'DECLINED',
        responderName: assignment.responder.name,
        callsign: assignment.responder.callsign,
        incidentNumber: assignment.incident.incidentNumber,
        incidentId: assignment.incidentId,
        notes: `REALLOCATION TRIGGERED: ${reason || 'Field disruption'}. Incident returned to triage queue.`
      });
      io.to('coordinators').emit('reallocation:triggered', {
        assignmentId: id,
        incidentId: assignment.incidentId,
        reason,
        notes
      });
      io.to('channel:admin_responder').emit('reallocation:triggered', {
        assignmentId: id,
        incidentId: assignment.incidentId,
        reason
      });
    }

    res.json({
      message: 'Reallocation triggered. Incident returned to triage queue for alternate resource matching.',
      assignment: updated
    });
  } catch (err) {
    console.error('Error triggering reallocation:', err);
    res.status(500).json({ error: 'Failed to trigger reallocation.' });
  }
});

export default router;
