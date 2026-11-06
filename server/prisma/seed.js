import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting CrisisCore Database Seeding with 8-Stage Disaster Logistics Data...');

  // Clean existing records in reverse relation order
  await prisma.chatMessage.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.locationLog.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.responder.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.user.deleteMany();

  console.log('🧹 Cleaned existing database records.');

  // Password hashing helper
  const salt = await bcrypt.genSalt(10);
  const hashPassword = async (pwd) => bcrypt.hash(pwd, salt);
  const passwordHash = await hashPassword('password123');

  // 1. Seed Users representing All Key Roles
  const civilianUser = await prisma.user.create({
    data: {
      email: 'civilian@test.com',
      passwordHash,
      name: 'Jane Doe',
      role: 'CIVILIAN',
      phone: '+1-555-0101',
      agency: 'Public Citizen'
    }
  });

  const coordinatorUser = await prisma.user.create({
    data: {
      email: 'coordinator@test.com',
      passwordHash,
      name: 'Sarah Connor',
      role: 'COORDINATOR',
      phone: '+1-555-0202',
      agency: 'Central Disaster Coordination Directorate',
      badgeNumber: 'COORD-8801'
    }
  });

  const responderUser = await prisma.user.create({
    data: {
      email: 'responder@test.com',
      passwordHash,
      name: 'Carlos Vance',
      role: 'RESPONDER',
      phone: '+1-555-0303',
      agency: 'Metro Fire & Rescue Dept',
      badgeNumber: 'RESP-4102'
    }
  });

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@test.com',
      passwordHash,
      name: 'Marcus Wright',
      role: 'ADMIN',
      phone: '+1-555-0404',
      agency: 'National Emergency Operations Authority',
      badgeNumber: 'ADM-001'
    }
  });

  const resourceManagerUser = await prisma.user.create({
    data: {
      email: 'resources@test.com',
      passwordHash,
      name: 'Elena Rostova',
      role: 'RESOURCE_MANAGER',
      phone: '+1-555-0505',
      agency: 'Central Emergency Relief Supply Depots',
      badgeNumber: 'RES-901'
    }
  });

  const incidentManagerUser = await prisma.user.create({
    data: {
      email: 'incidents@test.com',
      passwordHash,
      name: 'Dr. Tariq Al-Mansoor',
      role: 'INCIDENT_MANAGER',
      phone: '+1-555-0606',
      agency: 'Disaster Triage & Field Assessment Directorate',
      badgeNumber: 'INC-702'
    }
  });

  console.log('✅ Seeded 6 Users (Civilian, Coordinator, Responder, Admin, Resource Manager, Incident Manager).');

  // 2. Base Coordinates (Delhi center)
  const baseLat = 28.6139;
  const baseLng = 77.2090;

  // 3. Seed Registered Responders (Ambulances & Rescue Teams)
  const responder1 = await prisma.responder.create({
    data: {
      callsign: 'MEDIC-01',
      name: 'Paramedic Unit Alpha',
      type: 'MEDICAL_AMBULANCE',
      capability: 'Triage, Advanced Life Support, Defibrillator, Trauma Care, Cargo Bay (400kg)',
      status: 'AVAILABLE',
      lat: baseLat + 0.005,
      lng: baseLng - 0.004,
      userId: responderUser.id
    }
  });

  const responder2 = await prisma.responder.create({
    data: {
      callsign: 'RESCUE-01',
      name: 'Heavy Urban Search & Rescue Team',
      type: 'FIRE_RESCUE',
      capability: 'Structural Breach, Heavy Lifting, Inflatable Boats, Hydraulic Cutters',
      status: 'AVAILABLE',
      lat: baseLat - 0.008,
      lng: baseLng + 0.006
    }
  });

  const responder3 = await prisma.responder.create({
    data: {
      callsign: 'SUPPLY-TRUCK-01',
      name: 'Emergency Relief Logistics Vehicle',
      type: 'SPECIALIZED_EQUIPMENT',
      capability: 'Mass Water Delivery, 1.5-ton Food Transport, Modular Shelter Tents',
      status: 'AVAILABLE',
      lat: baseLat + 0.015,
      lng: baseLng - 0.010
    }
  });

  console.log('✅ Seeded Field Responders (MEDIC-01, RESCUE-01, SUPPLY-TRUCK-01).');

  // 4. Seed Multi-Category Resource Inventory (Diagram 1: Ambulance, Rescue Teams, Food, Water, Medicine, Equipment)
  await prisma.resource.createMany({
    data: [
      {
        name: 'Type-A Rapid Response Ambulance',
        category: 'AMBULANCE',
        type: 'VEHICLE',
        status: 'OPERATIONAL',
        quantityTotal: 5,
        quantityAvailable: 4,
        quantityAllocated: 1,
        unit: 'VEHICLES',
        depotName: 'Central Logistics Depot',
        depotLat: baseLat + 0.002,
        depotLng: baseLng - 0.003,
        assignedResponderId: responder1.id
      },
      {
        name: 'Urban Search & Rescue Squad Alpha',
        category: 'RESCUE_TEAM',
        type: 'PERSONNEL',
        status: 'OPERATIONAL',
        quantityTotal: 4,
        quantityAvailable: 3,
        quantityAllocated: 1,
        unit: 'TEAMS',
        depotName: 'North Emergency Staging Depot',
        depotLat: baseLat + 0.018,
        depotLng: baseLng + 0.012,
        assignedResponderId: responder2.id
      },
      {
        name: 'High-Calorie Ready-to-Eat Emergency Food Packs',
        category: 'FOOD',
        type: 'RELIEF_SUPPLY',
        status: 'OPERATIONAL',
        quantityTotal: 1000,
        quantityAvailable: 850,
        quantityAllocated: 150,
        unit: 'RATIONS',
        depotName: 'Central Logistics Depot',
        depotLat: baseLat + 0.002,
        depotLng: baseLng - 0.003
      },
      {
        name: 'Purified Drinking Water Rations (5L Containers)',
        category: 'WATER',
        type: 'RELIEF_SUPPLY',
        status: 'OPERATIONAL',
        quantityTotal: 3000,
        quantityAvailable: 2600,
        quantityAllocated: 400,
        unit: 'LITRES',
        depotName: 'Central Logistics Depot',
        depotLat: baseLat + 0.002,
        depotLng: baseLng - 0.003
      },
      {
        name: 'Advanced Trauma First-Aid Kits (ALS/BLS)',
        category: 'MEDICINE',
        type: 'KIT',
        status: 'OPERATIONAL',
        quantityTotal: 120,
        quantityAvailable: 95,
        quantityAllocated: 25,
        unit: 'KITS',
        depotName: 'North Emergency Staging Depot',
        depotLat: baseLat + 0.018,
        depotLng: baseLng + 0.012
      },
      {
        name: 'Hydraulic Extrication Cutters & Spreaders',
        category: 'EQUIPMENT',
        type: 'TOOL',
        status: 'OPERATIONAL',
        quantityTotal: 15,
        quantityAvailable: 12,
        quantityAllocated: 3,
        unit: 'KITS',
        depotName: 'North Emergency Staging Depot',
        depotLat: baseLat + 0.018,
        depotLng: baseLng + 0.012
      },
      {
        name: 'Emergency Inflatable Evacuation Rafts',
        category: 'EQUIPMENT',
        type: 'TOOL',
        status: 'OPERATIONAL',
        quantityTotal: 10,
        quantityAvailable: 8,
        quantityAllocated: 2,
        unit: 'RAFTS',
        depotName: 'Central Logistics Depot',
        depotLat: baseLat + 0.002,
        depotLng: baseLng - 0.003
      }
    ]
  });

  console.log('✅ Seeded Resource Inventory (Food, Water, Medicine, Equipment, Ambulances, Rescue Teams).');

  // 5. Seed Incidents with Structured Resource Needs (Diagram 1: Incident Manager)
  const inc1 = await prisma.incident.create({
    data: {
      incidentNumber: 'INC-2026-001',
      type: 'FIRE',
      description: 'Commercial 3-story warehouse fire with heavy black smoke and risk of structural collapse.',
      affectedCount: 8,
      status: 'REPORTED',
      severity: 'CRITICAL',
      predictedPriority: 'CRITICAL',
      priorityConfidence: 0.94,
      lat: baseLat + 0.010,
      lng: baseLng - 0.012,
      address: '742 Evergreen Blvd, Sector 4',
      reporterContact: '+1-555-9011',
      locationSharingActive: true,
      reporterId: civilianUser.id,
      resourceNeeds: JSON.stringify({
        ambulances: 1,
        rescue_teams: 1,
        food_rations: 30,
        water_litres: 100,
        medical_kits: 4,
        equipment: 'Hydraulic Cutters'
      }),
      managerNotes: 'Incident Manager verified: perimeter secured, heavy smoke, 8 workers trapped near rear exit.'
    }
  });

  const inc2 = await prisma.incident.create({
    data: {
      incidentNumber: 'INC-2026-002',
      type: 'MEDICAL',
      description: 'Multiple vehicle pileup on expressway overpass. 4 individuals trapped with traumatic injuries.',
      affectedCount: 4,
      status: 'DISPATCHED',
      severity: 'HIGH',
      predictedPriority: 'HIGH',
      priorityConfidence: 0.88,
      lat: baseLat - 0.007,
      lng: baseLng + 0.015,
      address: 'I-95 Expressway Northbound Mile 14',
      reporterContact: '+1-555-9012',
      locationSharingActive: true,
      resourceNeeds: JSON.stringify({
        ambulances: 1,
        medical_kits: 4,
        water_litres: 20
      }),
      managerNotes: 'Priority dispatch confirmed by Incident Manager.'
    }
  });

  const inc3 = await prisma.incident.create({
    data: {
      incidentNumber: 'INC-2026-003',
      type: 'NATURAL_DISASTER',
      description: 'Flash flood torrent trapped 12 commuters inside flooded underpass subway exit.',
      affectedCount: 12,
      status: 'TRIAGED',
      severity: 'HIGH',
      predictedPriority: 'CRITICAL',
      priorityConfidence: 0.92,
      lat: baseLat - 0.018,
      lng: baseLng - 0.015,
      address: 'Central Station Underpass Lower Level',
      reporterContact: '+1-555-9014',
      locationSharingActive: true,
      resourceNeeds: JSON.stringify({
        rescue_teams: 1,
        water_litres: 150,
        food_rations: 50,
        equipment: 'Inflatable Rafts'
      }),
      managerNotes: 'Requires water rescue squad and thermal blankets.'
    }
  });

  console.log('✅ Seeded Incidents with Structured Resource Needs.');

  // 6. Seed Mission Assignment with Stop Sequence & Delivery Status (Diagram 1, Step 6 & 7)
  const initialStopSequence = [
    {
      stopNumber: 1,
      type: 'DEPOT_PICKUP',
      name: 'Central Logistics Depot',
      lat: baseLat + 0.002,
      lng: baseLng - 0.003,
      items: 'Load 20L Water & 4 ALS Trauma Kits',
      status: 'COMPLETED',
      notes: 'Picked up from Depot Master Elena Rostova'
    },
    {
      stopNumber: 2,
      type: 'INCIDENT_DELIVERY',
      name: 'I-95 Expressway Overpass (INC-2026-002)',
      lat: inc2.lat,
      lng: inc2.lng,
      items: 'Deliver 4 ALS Trauma Kits & Stabilize 4 Casualties',
      status: 'IN_TRANSIT',
      notes: 'Trauma treatment and extrication in progress'
    },
    {
      stopNumber: 3,
      type: 'HOSPITAL_TRANSFER',
      name: 'City Trauma Emergency Hospital',
      lat: baseLat - 0.010,
      lng: baseLng + 0.005,
      items: 'Transfer Critical Patients',
      status: 'PENDING',
      notes: 'Receiving bay pre-alerted'
    }
  ];

  await prisma.assignment.create({
    data: {
      incidentId: inc2.id,
      responderId: responder1.id,
      status: 'EN_ROUTE',
      adminApprovalStatus: 'APPROVED',
      approvedByAdminId: adminUser.id,
      allocatedSupplies: JSON.stringify([
        { item: 'Water Rations', qty: 20, unit: 'LITRES' },
        { item: 'Trauma First-Aid Kits', qty: 4, unit: 'KITS' }
      ]),
      stopSequence: JSON.stringify(initialStopSequence),
      deliveryStatus: 'IN_TRANSIT',
      assignedByCoordinatorId: coordinatorUser.id,
      notes: 'Admin approved mission with 3-stop itinerary (Depot -> Scene -> Hospital).'
    }
  });

  console.log('✅ Seeded Mission Assignment with Stop Sequence & Delivery Tracking.');

  // 7. Seed Initial 3-Channel Communication Messages (Diagram 2)
  await prisma.chatMessage.createMany({
    data: [
      {
        channel: 'CHANNEL_1_RESOURCE',
        senderId: resourceManagerUser.id,
        senderName: 'Elena Rostova',
        senderRole: 'RESOURCE_MANAGER',
        message: 'Central Depot currently has 2,600L drinking water and 850 food rations on immediate reserve.'
      },
      {
        channel: 'CHANNEL_1_RESOURCE',
        senderId: adminUser.id,
        senderName: 'Marcus Wright',
        senderRole: 'ADMIN',
        message: 'Understood Elena. Prepare 200L water and 50 rations for imminent dispatch to Sector 4.'
      },
      {
        channel: 'CHANNEL_2_INCIDENT',
        senderId: incidentManagerUser.id,
        senderName: 'Dr. Tariq Al-Mansoor',
        senderRole: 'INCIDENT_MANAGER',
        message: 'INC-2026-001 (Warehouse Fire) escalated to CRITICAL. 8 casualties verified. Requires 1 ALS Ambulance and heavy rescue gear.'
      },
      {
        channel: 'CHANNEL_2_INCIDENT',
        senderId: adminUser.id,
        senderName: 'Marcus Wright',
        senderRole: 'ADMIN',
        message: 'Acknowledged Tariq. Reviewing AI Allocation recommendation now for immediate approval.'
      },
      {
        channel: 'CHANNEL_3_RESPONDER',
        senderId: adminUser.id,
        senderName: 'Marcus Wright',
        senderRole: 'ADMIN',
        message: 'Unit MEDIC-01, your 3-stop mission manifest for INC-2026-002 is approved. Proceed to I-95 overpass.'
      },
      {
        channel: 'CHANNEL_3_RESPONDER',
        senderId: responderUser.id,
        senderName: 'Carlos Vance',
        senderRole: 'RESPONDER',
        message: 'Copy Central Command. Departed Central Depot with ALS kits and water. ETA 4 minutes.'
      }
    ]
  });

  console.log('✅ Seeded Initial Messages for Admin Channels 1, 2, and 3.');

  console.log('🎉 8-Stage Disaster Logistics Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
