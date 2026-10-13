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

  // 2. Seed Registered Responder Fleet (tied to registered user Carlos Vance)
  const baseLat = 28.6139; // Delhi coordinates aligned with dashboard
  const baseLng = 77.2090;

  const responder1 = await prisma.responder.create({
    data: {
      callsign: 'MEDIC-01',
      name: 'Paramedic Unit Alpha',
      type: 'MEDICAL_AMBULANCE',
      capability: 'Triage, Advanced Life Support, Defibrillator, Trauma Care',
      status: 'AVAILABLE',
      lat: baseLat + 0.005,
      lng: baseLng - 0.004,
      userId: responderUser.id
    }
  });

  console.log('✅ Seeded 1 Registered Field Responder (MEDIC-01 linked to Carlos Vance).');

  // 3. Seed Specialized Resources
  await prisma.resource.createMany({
    data: [
      {
        name: 'Paramedic ALS Mobile Kit',
        type: 'MEDICAL_KIT',
        status: 'OPERATIONAL',
        assignedResponderId: responder1.id
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

  // 5. Seed Privacy-Aware Location Logs (Breadcrumbs)
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
        responderId: responder1.id,
        lat: responder1.lat,
        lng: responder1.lng,
        accuracy: 3.0,
        source: 'GPS',
        isActive: true
      }
    ]
  });

  console.log('✅ Seeded LocationLog breadcrumbs.');

  // 6. Seed Audit Log entry
  await prisma.auditLog.create({
    data: {
      userId: coordinatorUser.id,
      action: 'SYSTEM_BOOT',
      resourceType: 'INCIDENT',
      resourceId: inc1.id,
      details: JSON.stringify({ note: 'Initial incident triage and coordination readiness' })
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
