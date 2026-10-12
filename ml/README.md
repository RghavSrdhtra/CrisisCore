# CrisisCore Machine Learning & Optimization Subsystem

This module handles:
1. **Predictive Incident Prioritization (Week 4):**
   - Classifies emergency requests into `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` based on incident category, affected headcounts, time, and keywords.
   - Evaluates Random Forest, Gradient Boosting, and Logistic Regression baselines.
2. **Resource Allocation via Hungarian Algorithm & ILP (Week 5):**
   - Bipartite matching between incoming incidents and available responders.
   - Weighted cost matrix: distance (haversine) + priority penalty + capability fit + response time.
   - Constrained solver using PuLP/OR-Tools.
