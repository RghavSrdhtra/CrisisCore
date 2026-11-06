"""
CrisisCore Algorithmic Optimization Engine (Week 5)
Implements:
1. Hungarian Bipartite Matching for incident-to-responder dispatch.
2. Integer Linear Programming (ILP) via PuLP for multi-commodity vehicle-load distribution.
"""

import math
from typing import List, Dict, Any, Tuple
import numpy as np
from scipy.optimize import linear_sum_assignment
import pulp

from resource_matcher import haversine_distance

class HungarianDispatcher:
    """
    Bipartite matching between incoming incidents and available responders
    minimizing weighted response time, capability mismatch, and priority delays.
    """
    def __init__(self):
        pass

    def match(
        self,
        incidents: List[Dict[str, Any]],
        responders: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        if not incidents or not responders:
            return []

        n_inc = len(incidents)
        n_resp = len(responders)

        # Cost matrix: rows = incidents, cols = responders
        cost_matrix = np.zeros((n_inc, n_resp))

        priority_bonuses = {
            "CRITICAL": -120.0,
            "HIGH": -60.0,
            "MEDIUM": -20.0,
            "LOW": 0.0
        }

        capability_map = {
            "MEDICAL": "MEDICAL_AMBULANCE",
            "FIRE": "FIRE_RESCUE",
            "COLLAPSE": "FIRE_RESCUE",
            "SECURITY": "POLICE_CRISIS",
            "HAZMAT": "FIRE_RESCUE",
            "FLOOD": "FIRE_RESCUE"
        }

        for i, inc in enumerate(incidents):
            inc_lat = inc.get("lat") or 28.6139
            inc_lng = inc.get("lng") or 77.2090
            inc_type = str(inc.get("type", "MEDICAL")).upper()
            inc_priority = str(inc.get("priority", "HIGH")).upper()
            ideal_role = capability_map.get(inc_type, "MEDICAL_AMBULANCE")

            for j, resp in enumerate(responders):
                resp_lat = resp.get("lat") or 28.6139
                resp_lng = resp.get("lng") or 77.2090
                resp_type = str(resp.get("type", "")).upper()

                dist_km = haversine_distance(inc_lat, inc_lng, resp_lat, resp_lng)
                distance_cost = dist_km * 3.5  # 3.5 cost units per km

                # Priority discount (negative cost encourages early critical pairing)
                priority_cost = priority_bonuses.get(inc_priority, -20.0)

                # Capability match
                if resp_type == ideal_role:
                    capability_cost = -45.0  # Big bonus for perfect match
                elif "RESCUE" in resp_type or "AMBULANCE" in resp_type:
                    capability_cost = -10.0  # Acceptable generalist
                else:
                    capability_cost = 40.0   # Mismatch penalty

                # Base constant to ensure matrix remains non-negative where possible
                cost_val = distance_cost + priority_cost + capability_cost + 200.0
                cost_matrix[i, j] = max(0.1, cost_val)

        # Execute Hungarian algorithm
        row_ind, col_ind = linear_sum_assignment(cost_matrix)

        assignments = []
        for r, c in zip(row_ind, col_ind):
            inc = incidents[r]
            resp = responders[c]
            assigned_cost = cost_matrix[r, c]
            dist = haversine_distance(inc.get("lat", 28.61), inc.get("lng", 77.2), resp.get("lat", 28.61), resp.get("lng", 77.2))

            # Recommendation confidence score (0.0 to 1.0)
            score = round(max(0.40, min(0.99, 1.0 - (assigned_cost / 300.0))), 2)

            assignments.append({
                "incident_id": inc.get("id") or inc.get("incidentNumber"),
                "incident_number": inc.get("incidentNumber") or inc.get("id"),
                "incident_type": inc.get("type"),
                "priority": inc.get("priority", "HIGH"),
                "responder_id": resp.get("id"),
                "responder_name": resp.get("name"),
                "responder_callsign": resp.get("callsign"),
                "responder_type": resp.get("type"),
                "distance_km": dist,
                "recommendation_score": score,
                "algorithm": "Hungarian Bipartite (scipy.optimize.linear_sum_assignment)"
            })

        return assignments

class ILPReliefOptimizer:
    """
    Integer Linear Programming (ILP) Solver via PuLP.
    Optimizes multi-commodity supply allocation from depots to incidents
    respecting vehicle payload limits and regional inventory availability.
    """
    def __init__(self):
        pass

    def solve_allocation(
        self,
        incidents: List[Dict[str, Any]],
        depots: List[Dict[str, Any]],
        responders: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Solves multi-commodity allocation:
        Minimizes transport cost and unmet demand penalties.
        """
        prob = pulp.LpProblem("Disaster_Multi_Commodity_Allocation", pulp.LpMinimize)

        commodities = ["WATER", "FOOD", "MEDICINE"]
        commodity_unit_weights = {"WATER": 1.0, "FOOD": 0.5, "MEDICINE": 0.3} # in kg

        # Vehicle capacity (default 500kg per vehicle)
        default_capacity = 500.0

        # Decision variables: flow_r_d_i_c = quantity of commodity c carried by responder r from depot d to incident i
        flows = {}
        for r_idx, r in enumerate(responders):
            for d_idx, d in enumerate(depots):
                for i_idx, inc in enumerate(incidents):
                    for c in commodities:
                        var_name = f"flow_{r_idx}_{d_idx}_{i_idx}_{c}"
                        flows[(r_idx, d_idx, i_idx, c)] = pulp.LpVariable(var_name, lowBound=0, cat=pulp.LpInteger)

        # Binary indicator: does responder r serve incident i from depot d?
        use_route = {}
        for r_idx, r in enumerate(responders):
            for d_idx, d in enumerate(depots):
                for i_idx, inc in enumerate(incidents):
                    var_name = f"route_{r_idx}_{d_idx}_{i_idx}"
                    use_route[(r_idx, d_idx, i_idx)] = pulp.LpVariable(var_name, cat=pulp.LpBinary)

        # Slack variables for unmet demand
        unmet_demand = {}
        for i_idx, inc in enumerate(incidents):
            for c in commodities:
                var_name = f"unmet_{i_idx}_{c}"
                unmet_demand[(i_idx, c)] = pulp.LpVariable(var_name, lowBound=0, cat=pulp.LpContinuous)

        # Objective function: Minimize transport distance + heavily penalize unmet demand
        obj_terms = []
        for r_idx, r in enumerate(responders):
            for d_idx, d in enumerate(depots):
                for i_idx, inc in enumerate(incidents):
                    dist_rd = haversine_distance(r.get("lat", 28.61), r.get("lng", 77.2), d.get("lat", 28.61), d.get("lng", 77.2))
                    dist_di = haversine_distance(d.get("lat", 28.61), d.get("lng", 77.2), inc.get("lat", 28.61), inc.get("lng", 77.2))
                    total_dist = dist_rd + dist_di
                    obj_terms.append(total_dist * use_route[(r_idx, d_idx, i_idx)])

        # Add heavy penalty for unmet demand based on incident priority
        priority_multipliers = {"CRITICAL": 500.0, "HIGH": 250.0, "MEDIUM": 100.0, "LOW": 30.0}
        for i_idx, inc in enumerate(incidents):
            priority = str(inc.get("priority", "HIGH")).upper()
            mult = priority_multipliers.get(priority, 100.0)
            for c in commodities:
                obj_terms.append(mult * unmet_demand[(i_idx, c)])

        prob += pulp.lpSum(obj_terms)

        # Constraint 1: Vehicle Payload Capacity
        for r_idx, r in enumerate(responders):
            cap = float(r.get("capacity_kg", default_capacity))
            weight_terms = []
            for d_idx, d in enumerate(depots):
                for i_idx, inc in enumerate(incidents):
                    for c in commodities:
                        w = commodity_unit_weights[c]
                        weight_terms.append(w * flows[(r_idx, d_idx, i_idx, c)])
            prob += pulp.lpSum(weight_terms) <= cap, f"Cap_Resp_{r_idx}"

        # Constraint 2: Link flow to binary route selection
        M = 1000  # Big-M upper bound
        for r_idx, r in enumerate(responders):
            for d_idx, d in enumerate(depots):
                for i_idx, inc in enumerate(incidents):
                    for c in commodities:
                        prob += flows[(r_idx, d_idx, i_idx, c)] <= M * use_route[(r_idx, d_idx, i_idx)]

        # Constraint 3: Depot Available Inventory
        for d_idx, d in enumerate(depots):
            stocks = d.get("stocks", {})
            for c in commodities:
                avail = float(stocks.get(c, 0))
                depot_flow = [flows[(r_idx, d_idx, i_idx, c)] for r_idx in range(len(responders)) for i_idx in range(len(incidents))]
                prob += pulp.lpSum(depot_flow) <= avail, f"DepotStock_{d_idx}_{c}"

        # Constraint 4: Demand Satisfaction with Slack
        demand_keys = {"WATER": "water_litres", "FOOD": "food_rations", "MEDICINE": "medical_kits"}
        for i_idx, inc in enumerate(incidents):
            needs = inc.get("resourceNeeds", {})
            for c in commodities:
                req_qty = float(needs.get(demand_keys[c], 0))
                received = [flows[(r_idx, d_idx, i_idx, c)] for r_idx in range(len(responders)) for d_idx in range(len(depots))]
                prob += pulp.lpSum(received) + unmet_demand[(i_idx, c)] >= req_qty, f"Demand_{i_idx}_{c}"

        # Solve ILP model using CBC
        solver = pulp.PULP_CBC_CMD(msg=False)
        status = prob.solve(solver)

        status_str = pulp.LpStatus[status]

        # Extract results
        solution_routes = []
        for r_idx, r in enumerate(responders):
            for d_idx, d in enumerate(depots):
                for i_idx, inc in enumerate(incidents):
                    if pulp.value(use_route[(r_idx, d_idx, i_idx)]) and pulp.value(use_route[(r_idx, d_idx, i_idx)]) > 0.5:
                        cargo = {}
                        for c in commodities:
                            qty = int(pulp.value(flows[(r_idx, d_idx, i_idx, c)]) or 0)
                            if qty > 0:
                                cargo[c] = qty

                        if cargo:
                            dist = haversine_distance(d.get("lat", 28.61), d.get("lng", 77.2), inc.get("lat", 28.61), inc.get("lng", 77.2))
                            solution_routes.append({
                                "responder": r.get("name"),
                                "responder_callsign": r.get("callsign"),
                                "depot": d.get("name"),
                                "incident_id": inc.get("id"),
                                "incident_number": inc.get("incidentNumber"),
                                "cargo": cargo,
                                "delivery_distance_km": dist
                            })

        return {
            "solver_status": status_str,
            "objective_value": round(float(pulp.value(prob.objective)), 2) if prob.objective else 0.0,
            "optimal_routes": solution_routes,
            "algorithm": "Integer Linear Programming (PuLP CBC Solver)"
        }

if __name__ == "__main__":
    dispatcher = HungarianDispatcher()
    sample_incidents = [
        {"id": "inc-1", "incidentNumber": "INC-001", "type": "MEDICAL", "priority": "CRITICAL", "lat": 28.62, "lng": 77.21},
        {"id": "inc-2", "incidentNumber": "INC-002", "type": "FIRE", "priority": "HIGH", "lat": 28.64, "lng": 77.23}
    ]
    sample_responders = [
        {"id": "r-1", "name": "Carlos Vance", "callsign": "MEDIC-01", "type": "MEDICAL_AMBULANCE", "lat": 28.61, "lng": 77.20},
        {"id": "r-2", "name": "Elena Rostova", "callsign": "FIRE-02", "type": "FIRE_RESCUE", "lat": 28.63, "lng": 77.22}
    ]

    hungarian_res = dispatcher.match(sample_incidents, sample_responders)
    print("Hungarian Matching Result:")
    import json
    print(json.dumps(hungarian_res, indent=2))

    print("\nTesting ILP Solver...")
    ilp_solver = ILPReliefOptimizer()
    sample_depots = [
        {"name": "Central Depot", "lat": 28.61, "lng": 77.20, "stocks": {"WATER": 500, "FOOD": 200, "MEDICINE": 50}}
    ]
    sample_incidents[0]["resourceNeeds"] = {"water_litres": 60, "food_rations": 20, "medical_kits": 5}
    sample_incidents[1]["resourceNeeds"] = {"water_litres": 80, "food_rations": 30, "medical_kits": 2}

    ilp_res = ilp_solver.solve_allocation(sample_incidents, sample_depots, sample_responders)
    print("ILP Solver Result:")
    print(json.dumps(ilp_res, indent=2))

