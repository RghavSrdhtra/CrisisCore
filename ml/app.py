"""
CrisisCore AI Resource Allocation & Optimization Microservice (Weeks 4 & 5)
FastAPI application delivering ML Priority Classification, Hungarian Matching,
Integer Linear Programming (PuLP) cargo allocation, and Sequential Route Planning.
"""

import time
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from priority_model import PriorityPredictor
from resource_matcher import ResourceMatcher
from optimizer import HungarianDispatcher, ILPReliefOptimizer, ORToolsReliefOptimizer
from router import RoutePlanner

app = FastAPI(
    title="CrisisCore AI Allocation & Optimization Engine",
    description="ML Priority Scoring, Multi-Depot Resource Matching, Hungarian Dispatch & Google OR-Tools Routing",
    version="2.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize engines
priority_predictor = PriorityPredictor()
resource_matcher = ResourceMatcher()
hungarian_dispatcher = HungarianDispatcher()
ilp_optimizer = ILPReliefOptimizer()
ortools_optimizer = ORToolsReliefOptimizer()
route_planner = RoutePlanner()

START_TIME = time.time()

# Request Models
class IncidentEvaluateRequest(BaseModel):
    id: Optional[str] = None
    incidentNumber: Optional[str] = None
    type: str = "MEDICAL"
    description: Optional[str] = ""
    affectedCount: Optional[int] = 1
    lat: Optional[float] = 28.6139
    lng: Optional[float] = 77.2090
    resourceNeeds: Optional[Dict[str, Any]] = Field(default_factory=dict)
    inventory: Optional[List[Dict[str, Any]]] = Field(default_factory=list)

class OptimizeRequest(BaseModel):
    incidents: List[Dict[str, Any]] = Field(default_factory=list)
    responders: List[Dict[str, Any]] = Field(default_factory=list)
    depots: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    inventory: Optional[List[Dict[str, Any]]] = Field(default_factory=list)

class RouteRequest(BaseModel):
    incident: Dict[str, Any]
    allocatedSupplies: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    responder: Dict[str, Any]

@app.get("/api/ml/health")
def health():
    return {
        "status": "healthy",
        "service": "CrisisCore AI Allocation & Optimization Microservice",
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "model_architecture": "RandomForestClassifier (150 estimators, class_weight=balanced)",
        "feature_extractors": ["TF-IDF N-Gram Text Embeddings", "OneHot Categorical", "StandardScaler Numeric"],
        "solvers": [
            "Google OR-Tools (SCIP Mixed-Integer Solver)",
            "Hungarian Bipartite Matcher (scipy.optimize.linear_sum_assignment)",
            "Integer Linear Programming (PuLP CBC Solver)"
        ]
    }

@app.post("/api/ml/evaluate")
def evaluate_incident(req: IncidentEvaluateRequest):
    """
    Evaluates incident priority and matches required supplies against available inventory.
    """
    try:
        inc_data = {
            "type": req.type,
            "description": req.description,
            "affected_count": req.affectedCount,
            "resourceNeeds": req.resourceNeeds,
            "lat": req.lat,
            "lng": req.lng
        }

        # 1. Run Machine Learning Priority Prediction
        priority_result = priority_predictor.predict(inc_data)

        # 2. Match Resources if inventory provided
        match_result = None
        if req.inventory and len(req.inventory) > 0:
            match_result = resource_matcher.match_resources(
                incident_needs=req.resourceNeeds or {},
                inventory=req.inventory,
                incident_lat=req.lat or 28.6139,
                incident_lng=req.lng or 77.2090
            )

        return {
            "incident_id": req.id,
            "incident_number": req.incidentNumber,
            "triage": priority_result,
            "resource_matching": match_result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Priority evaluation failed: {str(e)}")

@app.post("/api/ml/optimize")
def optimize_dispatch(req: OptimizeRequest):
    """
    Runs Hungarian algorithm and ILP solver to optimize responder dispatch and commodity distribution.
    """
    try:
        hungarian_matches = hungarian_dispatcher.match(req.incidents, req.responders)

        allocation_result = None
        if req.depots and len(req.depots) > 0 and len(req.incidents) > 0 and len(req.responders) > 0:
            # Primary solver: Google OR-Tools
            allocation_result = ortools_optimizer.solve_allocation(req.incidents, req.depots, req.responders)

        return {
            "hungarian_matches": hungarian_matches,
            "allocation_optimization": allocation_result,
            "ilp_allocation": allocation_result,
            "total_incidents_processed": len(req.incidents),
            "total_responders_considered": len(req.responders)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {str(e)}")

@app.post("/api/ml/route")
def generate_route(req: RouteRequest):
    """
    Generates an optimized multi-stop mission route manifest.
    """
    try:
        itinerary = route_planner.generate_mission_itinerary(
            incident=req.incident,
            allocated_supplies=req.allocatedSupplies or [],
            responder=req.responder
        )
        return itinerary
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Route planning failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    print("🚀 Launching CrisisCore AI Microservice on http://127.0.0.1:8000...")
    uvicorn.run(app, host="127.0.0.1", port=8000)

