# CrisisCore AI Allocation & Optimization Subsystem

This subsystem powers **Stage 4** of the CrisisCore Disaster Logistics Pipeline:
1. **Predictive Incident Urgency & Priority Classification (Week 4)**
2. **Multi-Depot Proximity Relief Matching (Week 4)**
3. **Hungarian Bipartite Dispatch & Integer Linear Programming (ILP) Solver (Week 5)**
4. **Dynamic Sequential Multi-Stop Route Planner (Week 5)**

---

## 🏗️ Architecture & Modules

```
ml/
├── app.py                   # FastAPI microservice (REST endpoints on port 8000)
├── dataset.py               # Multi-modal emergency incident dataset generator (3,500 samples)
├── train_priority_model.py  # Benchmark & training pipeline for scikit-learn models
├── priority_model.py        # Production inference & calibrated urgency scoring
├── resource_matcher.py      # Multi-depot proximity matching & deficit detection
├── optimizer.py             # Hungarian Bipartite Matcher & PuLP ILP solver
├── router.py                # Sequential multi-stop mission route planner
├── requirements.txt         # Subsystem Python dependencies
└── models/
    ├── priority_classifier.joblib  # Serialized production pipeline
    └── metrics.json                # Benchmark metrics and classification report
```

---

## 🧠 1. Machine Learning Priority Model (Week 4)

- **Dataset**: Synthesized from realistic disaster incident templates across six categories (`MEDICAL`, `FIRE`, `COLLAPSE`, `FLOOD`, `SECURITY`, `HAZMAT`) with casualty counts, time-of-day features, and emergency distress descriptions.
- **Feature Extraction**:
  - **Textual**: `TfidfVectorizer` (max 1,500 features, n-grams 1–2, English stop-word removal).
  - **Categorical**: `OneHotEncoder(handle_unknown="ignore")` for incident categories.
  - **Numerical**: `StandardScaler` for `affected_count`, relief demands (`need_water`, `need_food`, `need_medicine`, `need_ambulance`, `need_rescue_team`), and `hour_of_day`.
- **Model Benchmark Results**:
  - `RandomForestClassifier`: **100.0% accuracy / 1.0000 F1-Macro** (selected for production due to superior non-linear keyword & casualty interactions).
  - `GradientBoostingClassifier`: 100.0% accuracy / 1.0000 F1-Macro.
  - `LogisticRegression`: 100.0% accuracy / 1.0000 F1-Macro.
- **Inference Output**:
  - `priority`: `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW`.
  - `priority_score`: Continuous calibrated urgency ($0.00$ to $1.00$).
  - `confidence`: Maximum class probability percentage.
  - `key_factors`: Human-interpretable factors explaining the decision (e.g. *"Urgent keywords detected: trapped, collapse"*, *"Mass-casualty incident: 6 victims"*).

---

## ⚡ 2. Multi-Depot Resource Matcher (Week 4)

- **Input**: Requested emergency relief quantities (`water_litres`, `food_rations`, `medical_kits`, `ambulances`, `rescue_teams`) and live regional depot inventory.
- **Algorithm**:
  - Computes Haversine distances between the incident location and all warehouse depots.
  - Greedy nearest-depot allocation: pulls supplies from the closest available depot. If insufficient, automatically splits fulfillment across multiple depots.
  - Flags supply deficits and calculates the aggregate `fulfillment_ratio`.

---

## 🎯 3. Algorithmic Optimization Engine (Week 5)

### A. Hungarian Bipartite Matcher
- **Implementation**: `scipy.optimize.linear_sum_assignment`.
- **Objective**: Finds the global minimum cost pairing between incoming incidents and active available emergency responders.
- **Cost Formulation**:
  $$\text{Cost}(i, r) = \text{DistanceCost}(i, r) + \text{PriorityPenalty}(i) + \text{CapabilityMismatchPenalty}(i, r)$$
  - Big bonuses for matching dedicated vehicles (Ambulance $\rightarrow$ Medical, Fire Engine $\rightarrow$ Fire/Collapse).
  - Heavy penalties for delaying Critical or High priority calls.

### B. Integer Linear Programming (ILP) Solver
- **Implementation**: `pulp` with the bundled CBC solver.
- **Objective**: Multi-commodity relief distribution from depots to incidents minimizing total transport distance while fulfilling demands up to vehicle payload capacities:
  $$\min \sum_{r,d,i} \text{Distance}(d, i) \cdot x_{r,d,i} + \sum_{i,c} \text{Penalty}(i) \cdot \text{UnmetDemand}(i, c)$$
  **Subject to:**
  1. $\sum_c \text{weight}(c) \cdot q_{r,d,i,c} \le \text{Capacity}(r)$ (Vehicle payload constraint)
  2. $\sum_{r,i} q_{r,d,i,c} \le \text{DepotInventory}(d, c)$ (Warehouse stock bounds)
  3. $\sum_{r,d} q_{r,d,i,c} + \text{UnmetDemand}(i, c) \ge \text{Demand}(i, c)$ (Incident requirement fulfillment)

---

## 🗺️ 4. Sequential Route Planner (Week 5)

- Constructs an ordered mission sequence:
  1. **Stop 1 (DEPOT_PICKUP)**: Regional depot waypoint with warehouse loading manifest.
  2. **Stop 2 (INCIDENT_DELIVERY)**: Disaster site with delivery instructions and digital recipient confirmation requirement.
  3. **Stop 3 (HOSPITAL_TRANSFER / BASE_RETURN)**: Emergency trauma ward or operational base.
- Calculates leg distances (Haversine) and estimated travel durations (assuming sirens + emergency traffic clearance).

---

## 🔌 API Endpoints (FastAPI — Port 8000)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/ml/health` | Health check, uptime, architecture specs, and solver status |
| `POST` | `/api/ml/evaluate` | Evaluates incident priority, calibrated score, and matches supplies |
| `POST` | `/api/ml/optimize` | Runs Hungarian bipartite matching and PuLP ILP optimization |
| `POST` | `/api/ml/route` | Generates sequential multi-stop mission route manifests |

---

## 🛠️ CLI Commands

```bash
# Re-train priority classifier and update metrics
python ml/train_priority_model.py

# Launch FastAPI microservice directly
python ml/app.py

# Run test client
python scratch/test_ml_api.py
```
