import express from 'express';
import { prisma } from '../config/db.js';
import { optionalAuthenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/resources - List all resource inventory items with category metrics
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const resources = await prisma.resource.findMany({
      include: {
        assignedResponder: true
      },
      orderBy: [
        { category: 'asc' },
        { name: 'asc' }
      ]
    });

    // Compute category aggregations
    const summary = {
      waterLitresTotal: 0,
      waterLitresAvailable: 0,
      foodRationsTotal: 0,
      foodRationsAvailable: 0,
      medicineKitsTotal: 0,
      medicineKitsAvailable: 0,
      ambulancesTotal: 0,
      ambulancesAvailable: 0,
      rescueTeamsTotal: 0,
      rescueTeamsAvailable: 0,
      equipmentTotal: 0,
      equipmentAvailable: 0
    };

    resources.forEach(r => {
      if (r.category === 'WATER') {
        summary.waterLitresTotal += r.quantityTotal;
        summary.waterLitresAvailable += r.quantityAvailable;
      } else if (r.category === 'FOOD') {
        summary.foodRationsTotal += r.quantityTotal;
        summary.foodRationsAvailable += r.quantityAvailable;
      } else if (r.category === 'MEDICINE') {
        summary.medicineKitsTotal += r.quantityTotal;
        summary.medicineKitsAvailable += r.quantityAvailable;
      } else if (r.category === 'AMBULANCE') {
        summary.ambulancesTotal += r.quantityTotal;
        summary.ambulancesAvailable += r.quantityAvailable;
      } else if (r.category === 'RESCUE_TEAM') {
        summary.rescueTeamsTotal += r.quantityTotal;
        summary.rescueTeamsAvailable += r.quantityAvailable;
      } else if (r.category === 'EQUIPMENT') {
        summary.equipmentTotal += r.quantityTotal;
        summary.equipmentAvailable += r.quantityAvailable;
      }
    });

    res.json({ resources, summary });
  } catch (err) {
    console.error('Error fetching resources:', err);
    res.status(500).json({ error: 'Failed to retrieve resource inventory.' });
  }
});

// POST /api/resources - Resource Manager adds new relief supplies or equipment
router.post('/', optionalAuthenticate, async (req, res) => {
  try {
    const { name, category, type, quantityTotal, unit, depotName, depotLat, depotLng } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required.' });
    }

    const qty = parseInt(quantityTotal || 1, 10);
    const newResource = await prisma.resource.create({
      data: {
        name,
        category: category.toUpperCase(),
        type: type || 'RELIEF_SUPPLY',
        status: 'OPERATIONAL',
        quantityTotal: qty,
        quantityAvailable: qty,
        quantityAllocated: 0,
        unit: unit || 'UNITS',
        depotName: depotName || 'Central Logistics Depot',
        depotLat: depotLat ? parseFloat(depotLat) : 28.614,
        depotLng: depotLng ? parseFloat(depotLng) : 77.210
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('resource:updated', newResource);
    }

    res.status(201).json({ message: 'Resource added successfully.', resource: newResource });
  } catch (err) {
    console.error('Error creating resource:', err);
    res.status(500).json({ error: 'Failed to create resource.' });
  }
});

// PATCH /api/resources/:id - Update resource stock or status
router.patch('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantityTotal, quantityAvailable, status, depotName } = req.body;

    const data = {};
    if (quantityTotal !== undefined) data.quantityTotal = parseInt(quantityTotal, 10);
    if (quantityAvailable !== undefined) data.quantityAvailable = parseInt(quantityAvailable, 10);
    if (status) data.status = status;
    if (depotName) data.depotName = depotName;

    const updated = await prisma.resource.update({
      where: { id },
      data
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('resource:updated', updated);
    }

    res.json({ message: 'Resource updated.', resource: updated });
  } catch (err) {
    console.error('Error updating resource:', err);
    res.status(500).json({ error: 'Failed to update resource.' });
  }
});

// POST /api/resources/replenish - Quick replenishment of consumables
router.post('/replenish', optionalAuthenticate, async (req, res) => {
  try {
    const { category, amount } = req.body;
    const addAmt = parseInt(amount || 50, 10);

    const match = await prisma.resource.findFirst({
      where: { category: (category || 'WATER').toUpperCase() }
    });

    if (!match) return res.status(404).json({ error: 'Resource category not found.' });

    const updated = await prisma.resource.update({
      where: { id: match.id },
      data: {
        quantityTotal: match.quantityTotal + addAmt,
        quantityAvailable: match.quantityAvailable + addAmt,
        status: 'OPERATIONAL'
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('resource:updated', updated);
    }

    res.json({ message: `Replenished ${addAmt} ${match.unit} of ${match.name}.`, resource: updated });
  } catch (err) {
    console.error('Error replenishing resource:', err);
    res.status(500).json({ error: 'Failed to replenish resource.' });
  }
});

export default router;

