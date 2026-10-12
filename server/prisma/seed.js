import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting CrisisCore Database Seeding...');

  // Clean existing records in reverse relation order
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

  // 1. Seed Users representing all 4 Privilege Levels (RBAC)
  const passwordHash = await hashPassword('password123');

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

  console.log('✅ Seeded 4 RBAC Users (Civilian, Coordinator, Responder, Admin).');

  // 2. Seed Responders Fleet (Section 4.3)
  const baseLat = 40.7128;
  const baseLng = -74.0060;

  const responder1 = await prisma.responder.create({
    data: {
      callsign: 'MEDIC-01',
      name: 'Paramedic Unit Alpha',
      type: 'MEDICAL_AMBULANCE',
      capability: 'Triage, Advanced Life Support, Defibrillator, Trauma Care',
      status: 'AVAILABLE',
      lat: baseLat + 0.012,
      lng: baseLng - 0.015,
      userId: responderUser.id
    }
  });

  const responder2 = await prisma.responder.create({
    data: {
      callsign: 'MEDIC-02',
      name: 'Rapid EMS Van Beta',
      type: 'MEDICAL_AMBULANCE',
      capability: 'Basic Life Support, Patient Transport, Oxygen Supplies',
      status: 'ASSIGNED',
      lat: baseLat - 0.008,
      lng: baseLng + 0.018
    }
  });

  const responder3 = await prisma.responder.create({
    data: {
      callsign: 'FIRE-01',
      name: 'Heavy Engine 12',
      type: 'FIRE_RESCUE',
      capability: 'Structural Firefighting, Water Cannon 4000L, Thermal Sensor',
      status: 'AVAILABLE',
      lat: baseLat - 0.015,
      lng: baseLng - 0.022
    }
  });

  const responder4 = await prisma.responder.create({
    data: {
      callsign: 'FIRE-02',
      name: 'Ladder Company 04',
      type: 'FIRE_RESCUE',
      capability: 'High-Rise Rescue, 32m Turntable Ladder, Breathing Apparatus',
      status: 'AVAILABLE',
      lat: baseLat + 0.025,
      lng: baseLng + 0.010
    }
  });

  const responder5 = await prisma.responder.create({
    data: {
      callsign: 'RESCUE-ALPHA',
      name: 'Disaster Technical Rescue Team',
      type: 'DISASTER_PERSONNEL',
      capability: 'Confined Space Rescue, Hydraulic Cutters, Canine Search',
      status: 'AVAILABLE',
      lat: baseLat + 0.005,
      lng: baseLng + 0.030
    }
  });

  const responder6 = await prisma.responder.create({
    data: {
      callsign: 'POLICE-09',
      name: 'Tactical Perimeter Patrol 9',
      type: 'POLICE_SECURITY',
      capability: 'Perimeter Lockdown, Traffic Divert, Crowd Management',
      status: 'AVAILABLE',
      lat: baseLat - 0.020,
      lng: baseLng - 0.005
    }
  });

  const responder7 = await prisma.responder.create({
    data: {
      callsign: 'DRONE-01',
      name: 'Air Reconnaissance Drone Unit',
      type: 'SPECIALIZED_EQUIPMENT',
      capability: 'Thermal Infrared Mapping, Real-time Aerial Feed, Gas Sensor',
      status: 'AVAILABLE',
      lat: baseLat + 0.018,
      lng: baseLng - 0.008
    }
  });

  console.log('✅ Seeded 7 Responders across all service types.');

  // 3. Seed Specialized Resources
  await prisma.resource.createMany({
    data: [
      {
        name: 'Paramedic ALS Mobile Kit',
        type: 'MEDICAL_KIT',
        status: 'IN_USE',
        assignedResponderId: responder1.id
      },
      {
        name: 'Hydraulic Heavy Rescue Extrication Tool',
        type: 'HEAVY_EQUIPMENT',
        status: 'OPERATIONAL',
        assignedResponderId: responder5.id
      },
      {
        name: 'Infrared Aerial Surveillance Sensor Pod',
        type: 'DRONE',
        status: 'OPERATIONAL',
        assignedResponderId: responder7.id
      },
      {
        name: 'High-Pressure 5000 GPM Water Pump',
        type: 'WATER_PUMP',
        status: 'OPERATIONAL',
        assignedResponderId: responder3.id
      }
    ]
  });

  console.log('✅ Seeded Emergency Resources.');

  // 4. Seed Sample Incidents
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
      reporterId: civilianUser.id
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
      locationSharingActive: true
    }
  });

  const inc3 = await prisma.incident.create({
    data: {
      incidentNumber: 'INC-2026-003',
      type: 'INDUSTRIAL',
      description: 'Chlorine gas cylinder breach detected inside processing plant. Workers evacuating perimeter.',
      affectedCount: 18,
      status: 'REPORTED',
      severity: 'CRITICAL',
      predictedPriority: 'CRITICAL',
      priorityConfidence: 0.96,
      lat: baseLat + 0.022,
      lng: baseLng + 0.015,
      address: '900 Industrial Parkway, Dock C',
      reporterContact: '+1-555-9013',
      locationSharingActive: true
    }
  });

  const inc4 = await prisma.incident.create({
    data: {
      incidentNumber: 'INC-2026-004',
      type: 'NATURAL_DISASTER',
      description: 'Flash flood torrent trapped 12 commuters inside flooded underpass subway exit.',
      affectedCount: 12,
      status: 'TRIAGED',
      severity: 'MEDIUM',
      predictedPriority: 'HIGH',
      priorityConfidence: 0.79,
      lat: baseLat - 0.018,
      lng: baseLng - 0.015,
      address: 'Central Station Underpass Lower Level',
      reporterContact: '+1-555-9014',
      locationSharingActive: true
    }
  });

  console.log('✅ Seeded 4 Crisis Incidents.');

  // 5. Seed Active Assignment linking MEDIC-02 to INC-2026-002
  await prisma.assignment.create({
    data: {
      incidentId: inc2.id,
      responderId: responder2.id,
      status: 'EN_ROUTE',
      assignedByCoordinatorId: coordinatorUser.id,
      recommendationScore: 0.92,
      acknowledgedAt: new Date(Date.now() - 5 * 60 * 1000),
      notes: 'Dispatched immediately by Coordinator. ETA 4 mins.'
    }
  });

  console.log('✅ Seeded Assignment (MEDIC-02 -> INC-2026-002).');

  // 6. Seed Privacy-Aware Location Logs (Breadcrumbs)
  await prisma.locationLog.createMany({
    data: [
      {
        incidentId: inc1.id,
        lat: inc1.lat,
        lng: inc1.lng,
        accuracy: 4.5,
        source: 'GPS',
        isActive: true
      },
      {
        responderId: responder2.id,
        lat: responder2.lat,
        lng: responder2.lng,
        accuracy: 3.0,
        source: 'GPS',
        isActive: true
      }
    ]
  });

  console.log('✅ Seeded LocationLog breadcrumbs.');

  // 7. Seed Audit Log entry
  await prisma.auditLog.create({
    data: {
      userId: coordinatorUser.id,
      action: 'DISPATCH_CONFIRMED',
      resourceType: 'ASSIGNMENT',
      resourceId: inc2.id,
      details: JSON.stringify({ responder: 'MEDIC-02', priority: 'HIGH', algorithmScore: 0.92 })
    }
  });

  console.log('✅ Seeded Security Audit Log.');
  console.log('🎉 Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
