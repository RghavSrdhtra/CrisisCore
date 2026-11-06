"""
CrisisCore Machine Learning Model Trainer (Week 4)
Trains a calibrated multi-modal emergency priority classification pipeline
combining NLP text embeddings with categorical and numerical disaster parameters.
"""

import os
import json
import time
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, accuracy_score, f1_score

from dataset import generate_emergency_dataset

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "priority_classifier.joblib")
METRICS_PATH = os.path.join(MODEL_DIR, "metrics.json")

def build_preprocessor():
    """Builds multi-modal feature transformation pipeline."""
    text_features = "description"
    categorical_features = ["type"]
    numerical_features = [
        "affected_count",
        "need_water",
        "need_food",
        "need_medicine",
        "need_ambulance",
        "need_rescue_team",
        "hour_of_day"
    ]

    preprocessor = ColumnTransformer(
        transformers=[
            ("text", TfidfVectorizer(max_features=1500, ngram_range=(1, 2), stop_words="english"), text_features),
            ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_features),
            ("num", StandardScaler(), numerical_features)
        ]
    )
    return preprocessor

def train_and_evaluate():
    os.makedirs(MODEL_DIR, exist_ok=True)
    print("🚀 Generating realistic emergency disaster training dataset (3,500 samples)...")
    df = generate_emergency_dataset(n_samples=3500, random_seed=42)

    X = df[[
        "type", "description", "affected_count",
        "need_water", "need_food", "need_medicine",
        "need_ambulance", "need_rescue_team", "hour_of_day"
    ]]
    y = df["priority_class"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    models = {
        "RandomForest": RandomForestClassifier(n_estimators=150, random_state=42, class_weight="balanced", max_depth=20),
        "GradientBoosting": GradientBoostingClassifier(n_estimators=100, random_state=42),
        "LogisticRegression": LogisticRegression(max_iter=1000, random_state=42)
    }

    benchmark_results = {}
    print("\n📊 Benchmarking Candidate Classifiers:")
    print("-" * 68)

    for name, clf in models.items():
        start_t = time.time()
        pipeline = Pipeline(steps=[
            ("preprocessor", build_preprocessor()),
            ("classifier", clf)
        ])

        pipeline.fit(X_train, y_train)
        train_time = round(time.time() - start_t, 3)

        preds = pipeline.predict(X_test)
        acc = float(accuracy_score(y_test, preds))
        f1_macro = float(f1_score(y_test, preds, average="macro"))

        benchmark_results[name] = {
            "accuracy": round(acc, 4),
            "f1_macro": round(f1_macro, 4),
            "training_time_sec": train_time
        }

        print(f"  • {name:18} | Accuracy: {acc*100:.2f}% | F1-Macro: {f1_macro:.4f} | Time: {train_time}s")

    # Production choice: RandomForest for superior non-linear keyword & numerical interaction
    best_pipeline = Pipeline(steps=[
        ("preprocessor", build_preprocessor()),
        ("classifier", models["RandomForest"])
    ])
    best_pipeline.fit(X_train, y_train)

    final_preds = best_pipeline.predict(X_test)
    class_report = classification_report(y_test, final_preds, output_dict=True)

    print("-" * 68)
    print(f"🏆 Production Selected Architecture: RandomForest (Accuracy: {accuracy_score(y_test, final_preds)*100:.2f}%)")

    # Save artifacts
    print(f"\n💾 Serializing trained production pipeline to: {MODEL_PATH}")
    joblib.dump(best_pipeline, MODEL_PATH)

    metrics_payload = {
        "selected_model": "RandomForestClassifier",
        "test_accuracy": round(accuracy_score(y_test, final_preds), 4),
        "test_f1_macro": round(f1_score(y_test, final_preds, average="macro"), 4),
        "benchmark_comparison": benchmark_results,
        "classification_report": class_report,
        "training_samples": len(df),
        "classes": list(best_pipeline.classes_),
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    with open(METRICS_PATH, "w", encoding="utf-8") as f:
        json.dump(metrics_payload, f, indent=2)

    print(f"📈 Saved model performance metrics to: {METRICS_PATH}")
    return best_pipeline, metrics_payload

if __name__ == "__main__":
    train_and_evaluate()
