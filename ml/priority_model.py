"""
CrisisCore Priority Prediction Engine (Week 4)
Inference module for real-time disaster triage and priority scoring.
"""

import os
import joblib
import pandas as pd
import numpy as np
from datetime import datetime

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "priority_classifier.joblib")

class PriorityPredictor:
    def __init__(self, model_path=MODEL_PATH):
        self.model_path = model_path
        self.pipeline = None
        self._load_model()

    def _load_model(self):
        if not os.path.exists(self.model_path):
            print(f"⚠️ Model artifact not found at {self.model_path}, training now...")
            from train_priority_model import train_and_evaluate
            self.pipeline, _ = train_and_evaluate()
        else:
            self.pipeline = joblib.load(self.model_path)
        print("✅ PriorityPredictor pipeline loaded successfully.")

    def predict(self, incident: dict) -> dict:
        """
        Predicts priority class, calibrated urgency score, and explanation factors.
        """
        # Extract features
        inc_type = str(incident.get("type", "MEDICAL")).upper()
        desc = str(incident.get("description", "") or f"{inc_type} emergency incident")
        affected = int(incident.get("affected_count", incident.get("affectedCount", 1)) or 1)

        needs = incident.get("resourceNeeds", incident.get("resource_needs", {}))
        if isinstance(needs, str):
            import json
            try:
                needs = json.loads(needs)
            except Exception:
                needs = {}
        elif not isinstance(needs, dict):
            needs = {}

        need_water = int(needs.get("water_litres", incident.get("need_water", 0)) or 0)
        need_food = int(needs.get("food_rations", incident.get("need_food", 0)) or 0)
        need_meds = int(needs.get("medical_kits", incident.get("need_medicine", 0)) or 0)
        need_amb = int(needs.get("ambulances", incident.get("need_ambulance", 0)) or 0)
        need_rescue = int(needs.get("rescue_teams", incident.get("need_rescue_team", 0)) or 0)

        hour = incident.get("hour_of_day", datetime.now().hour)

        input_df = pd.DataFrame([{
            "type": inc_type,
            "description": desc,
            "affected_count": affected,
            "need_water": need_water,
            "need_food": need_food,
            "need_medicine": need_meds,
            "need_ambulance": need_amb,
            "need_rescue_team": need_rescue,
            "hour_of_day": hour
        }])

        pred_class = self.pipeline.predict(input_df)[0]
        probs = self.pipeline.predict_proba(input_df)[0]
        classes = list(self.pipeline.classes_)
        prob_dict = {cls: round(float(prob), 4) for cls, prob in zip(classes, probs)}

        # Calibrate continuous urgency score (0.00 to 1.00)
        weights = {"CRITICAL": 0.95, "HIGH": 0.75, "MEDIUM": 0.48, "LOW": 0.18}
        calibrated_score = sum(prob_dict.get(cls, 0.0) * weights[cls] for cls in weights)
        calibrated_score = round(float(min(1.0, max(0.05, calibrated_score))), 3)

        # Generate human-interpretable factors
        factors = []
        desc_lower = desc.lower()
        critical_keywords = ["unconscious", "collapse", "trapped", "bleeding", "explosion", "cardiac", "drowning", "ammonia"]
        matched_keywords = [kw for kw in critical_keywords if kw in desc_lower]
        if matched_keywords:
            factors.append(f"Urgent keywords detected: {', '.join(matched_keywords)}")

        if affected >= 4:
            factors.append(f"Mass-casualty incident ({affected} affected individuals)")
        elif affected > 1:
            factors.append(f"Multiple casualties reported ({affected})")

        if need_amb > 0 or need_meds > 2:
            factors.append(f"Critical medical response required ({need_meds} kits, {need_amb} ambulances)")

        if need_rescue > 0:
            factors.append("Specialized search and rescue squad needed")

        if not factors:
            factors.append("Standard municipal emergency report")

        return {
            "priority": pred_class,
            "priority_score": calibrated_score,
            "confidence": round(float(max(probs) * 100), 2),
            "probabilities": prob_dict,
            "key_factors": factors
        }

if __name__ == "__main__":
    predictor = PriorityPredictor()
    test_case = {
        "type": "MEDICAL",
        "description": "Two victims trapped in collapsed stairwell, heavy bleeding and unconscious.",
        "affected_count": 2,
        "resourceNeeds": {"medical_kits": 3, "ambulances": 1}
    }
    result = predictor.predict(test_case)
    print("\nTest Prediction Result:")
    import json
    print(json.dumps(result, indent=2))

