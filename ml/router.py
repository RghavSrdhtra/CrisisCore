"""
CrisisCore Dynamic Route Planning & Sequential Itinerary Generator (Week 5)
Constructs sequential multi-stop missions (Depot Pickup -> Scene Delivery -> Hospital/Base)
with Haversine distances, estimated travel durations, and digital checkpoint manifests.
"""

from typing import List, Dict, Any
from resource_matcher import haversine_distance

DEFAULT_DEPOT_COORDS = {"lat": 28.6139, "lng": 77.2090, "name": "Central Regional Logistics Depot"}
DEFAULT_HOSPITAL_COORDS = {"lat": 28.6050, "lng": 77.2150, "name": "Metro Emergency Base Hospital"}

class RoutePlanner:
    def __init__(self, avg_speed_kmh: float = 35.0):
        self.avg_speed_kmh = avg_speed_kmh

    def estimate_travel_time_min(self, dist_km: float) -> int:
        """Estimates transit duration in minutes assuming emergency sirens and clearance."""
        hours = dist_km / max(1.0, self.avg_speed_kmh)
        return max(2, int(round(hours * 60)))

    def generate_mission_itinerary(
        self,
        incident: Dict[str, Any],
        allocated_supplies: List[Dict[str, Any]],
        responder: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Creates an ordered 3-to-4 stop sequence for the field responder.
        """
        resp_lat = responder.get("lat") or 28.6139
        resp_lng = responder.get("lng") or 77.2090

        inc_lat = incident.get("lat") or 28.6250
        inc_lng = incident.get("lng") or 77.2180
        inc_num = incident.get("incidentNumber") or incident.get("id") or "INC-CURRENT"
        inc_addr = incident.get("address") or f"Zone GPS ({inc_lat:.4f}, {inc_lng:.4f})"
        casualties = incident.get("affectedCount", incident.get("affected_count", 1))

        # 1. Determine Depot Stop
        if allocated_supplies and len(allocated_supplies) > 0:
            first_sup = allocated_supplies[0]
            depot_name = first_sup.get("depotName") or DEFAULT_DEPOT_COORDS["name"]
            depot_lat = first_sup.get("depotLat") or DEFAULT_DEPOT_COORDS["lat"]
            depot_lng = first_sup.get("depotLng") or DEFAULT_DEPOT_COORDS["lng"]
            items_to_load = ", ".join([f"{s.get('qty')} {s.get('unit', 'units')} {s.get('name', 'Supplies')}" for s in allocated_supplies])
        else:
            depot_name = DEFAULT_DEPOT_COORDS["name"]
            depot_lat = DEFAULT_DEPOT_COORDS["lat"]
            depot_lng = DEFAULT_DEPOT_COORDS["lng"]
            items_to_load = "Emergency medical & trauma stabilization kits"

        # Calculate Leg Distances
        dist_leg_1 = haversine_distance(resp_lat, resp_lng, depot_lat, depot_lng)
        time_leg_1 = self.estimate_travel_time_min(dist_leg_1) + 4 # 4 mins depot loading

        dist_leg_2 = haversine_distance(depot_lat, depot_lng, inc_lat, inc_lng)
        time_leg_2 = self.estimate_travel_time_min(dist_leg_2)

        dist_leg_3 = haversine_distance(inc_lat, inc_lng, DEFAULT_HOSPITAL_COORDS["lat"], DEFAULT_HOSPITAL_COORDS["lng"])
        time_leg_3 = self.estimate_travel_time_min(dist_leg_3)

        total_distance = round(dist_leg_1 + dist_leg_2 + dist_leg_3, 2)
        total_eta_min = time_leg_1 + time_leg_2 + time_leg_3

        stops = [
            {
                "stopNumber": 1,
                "type": "DEPOT_PICKUP",
                "name": depot_name,
                "lat": depot_lat,
                "lng": depot_lng,
                "itemsToLoad": items_to_load,
                "status": "PENDING",
                "legDistanceKm": dist_leg_1,
                "estimatedDurationMin": time_leg_1,
                "notes": "Verify warehouse manifest and sign loading receipt before departure."
            },
            {
                "stopNumber": 2,
                "type": "INCIDENT_DELIVERY",
                "name": f"Incident Site: {inc_num} ({inc_addr})",
                "lat": inc_lat,
                "lng": inc_lng,
                "itemsToDeliver": f"Deliver {items_to_load} to {casualties} casualties; conduct on-scene triage",
                "status": "PENDING",
                "legDistanceKm": dist_leg_2,
                "estimatedDurationMin": time_leg_2,
                "notes": "Mandatory digital delivery confirmation upon arrival at emergency scene."
            },
            {
                "stopNumber": 3,
                "type": "HOSPITAL_TRANSFER",
                "name": DEFAULT_HOSPITAL_COORDS["name"],
                "lat": DEFAULT_HOSPITAL_COORDS["lat"],
                "lng": DEFAULT_HOSPITAL_COORDS["lng"],
                "itemsToDeliver": "Transport critical stabilized casualties to Emergency Trauma Ward",
                "status": "PENDING",
                "legDistanceKm": dist_leg_3,
                "estimatedDurationMin": time_leg_3,
                "notes": "Transfer patient custody to triage chief and return unit to Available pool."
            }
        ]

        return {
            "mission_id": f"MISSION-{inc_num}",
            "responder_callsign": responder.get("callsign", "UNIT"),
            "total_stops": len(stops),
            "total_distance_km": total_distance,
            "total_eta_minutes": total_eta_min,
            "stop_sequence": stops,
            "algorithm": "Dynamic Multi-Stop Sequential Router"
        }

if __name__ == "__main__":
    planner = RoutePlanner()
    sample_inc = {"id": "inc-01", "incidentNumber": "INC-2026-088", "lat": 28.635, "lng": 77.225, "address": "Market Square Sector 4", "affectedCount": 3}
    sample_supplies = [{"name": "Drinking Water", "qty": 40, "unit": "LITRES", "depotName": "North Depot", "depotLat": 28.65, "depotLng": 77.21}]
    sample_resp = {"callsign": "MEDIC-01", "lat": 28.61, "lng": 77.20}
    itinerary = planner.generate_mission_itinerary(sample_inc, sample_supplies, sample_resp)
    import json
    print(json.dumps(itinerary, indent=2))

