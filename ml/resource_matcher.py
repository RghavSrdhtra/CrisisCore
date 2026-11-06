"""
CrisisCore Multi-Depot Resource Matcher (Week 4)
Matches structured incident relief requirements against live multi-depot inventory,
optimizing for geographic proximity and flagging supply deficits.
"""

import math
from typing import List, Dict, Any

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates Haversine distance in kilometers between two GPS coordinates."""
    R = 6371.0  # Earth's radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

class ResourceMatcher:
    def __init__(self):
        pass

    def match_resources(
        self,
        incident_needs: Dict[str, int],
        inventory: List[Dict[str, Any]],
        incident_lat: float,
        incident_lng: float
    ) -> Dict[str, Any]:
        """
        Matches needs against available inventory across depots sorted by distance.
        """
        # Map need keys to inventory categories
        category_map = {
            "water_litres": "WATER",
            "food_rations": "FOOD",
            "medical_kits": "MEDICINE",
            "ambulances": "AMBULANCE",
            "rescue_teams": "RESCUE_TEAM"
        }

        # Calculate distance to each depot/resource
        annotated_inventory = []
        for res in inventory:
            depot_lat = res.get("depotLat") or 28.6139
            depot_lng = res.get("depotLng") or 77.2090
            dist = haversine_distance(incident_lat, incident_lng, depot_lat, depot_lng)
            annotated_inventory.append({**res, "distance_km": dist})

        # Sort inventory by distance to incident
        annotated_inventory.sort(key=lambda r: r["distance_km"])

        allocated_supplies = []
        pickup_manifest = {}
        deficits = []
        total_requested_units = 0
        total_allocated_units = 0

        for need_key, req_qty in incident_needs.items():
            if not req_qty or req_qty <= 0:
                continue

            category = category_map.get(need_key)
            if not category:
                continue

            total_requested_units += req_qty
            remaining_to_allocate = req_qty

            # Find matching stocks in sorted inventory
            candidate_stocks = [r for r in annotated_inventory if r.get("category") == category and r.get("quantityAvailable", 0) > 0]

            for stock in candidate_stocks:
                avail = stock.get("quantityAvailable", 0)
                if avail <= 0:
                    continue

                take = min(remaining_to_allocate, avail)
                if take > 0:
                    allocated_supplies.append({
                        "resourceId": stock.get("id"),
                        "name": stock.get("name"),
                        "category": category,
                        "qty": take,
                        "unit": stock.get("unit", "UNITS"),
                        "depotName": stock.get("depotName", "Regional Depot"),
                        "depotLat": stock.get("depotLat", 28.6139),
                        "depotLng": stock.get("depotLng", 77.2090),
                        "distance_km": stock.get("distance_km", 0.0)
                    })

                    depot = stock.get("depotName", "Regional Depot")
                    pickup_manifest.setdefault(depot, []).append(f"{take} {stock.get('unit')} {stock.get('name')}")

                    remaining_to_allocate -= take
                    total_allocated_units += take

                if remaining_to_allocate == 0:
                    break

            if remaining_to_allocate > 0:
                deficits.append({
                    "category": category,
                    "requested": req_qty,
                    "unfulfilled": remaining_to_allocate,
                    "message": f"Deficit: {remaining_to_allocate} {category} units unavailable across depots"
                })

        fulfillment_ratio = round(
            (total_allocated_units / max(1, total_requested_units)) * 100.0, 1
        ) if total_requested_units > 0 else 100.0

        return {
            "allocated_supplies": allocated_supplies,
            "pickup_manifest": pickup_manifest,
            "deficits": deficits,
            "fulfillment_ratio": fulfillment_ratio,
            "total_requested": total_requested_units,
            "total_allocated": total_allocated_units
        }

if __name__ == "__main__":
    matcher = ResourceMatcher()
    sample_inventory = [
        {"id": "r1", "name": "Drinking Water Cans", "category": "WATER", "quantityAvailable": 100, "unit": "LITRES", "depotName": "North Depot", "depotLat": 28.65, "depotLng": 77.21},
        {"id": "r2", "name": "Drinking Water Cans", "category": "WATER", "quantityAvailable": 500, "unit": "LITRES", "depotName": "Central Depot", "depotLat": 28.61, "depotLng": 77.20},
        {"id": "r3", "name": "Emergency MRE Rations", "category": "FOOD", "quantityAvailable": 200, "unit": "RATIONS", "depotName": "Central Depot", "depotLat": 28.61, "depotLng": 77.20},
        {"id": "r4", "name": "Trauma Trauma Kits", "category": "MEDICINE", "quantityAvailable": 25, "unit": "KITS", "depotName": "Central Depot", "depotLat": 28.61, "depotLng": 77.20}
    ]
    needs = {"water_litres": 150, "food_rations": 30, "medical_kits": 5}
    res = matcher.match_resources(needs, sample_inventory, 28.62, 77.22)
    import json
    print(json.dumps(res, indent=2))

