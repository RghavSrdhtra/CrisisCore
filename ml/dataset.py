"""
CrisisCore Emergency Dataset Generator
Generates realistic multi-modal disaster incidents with natural language text,
severity indicators, casualty figures, and relief resource requests.
"""

import random
import numpy as np
import pandas as pd

EMERGENCY_TEMPLATES = {
    "CRITICAL": [
        ("MEDICAL", "Massive vehicular collision on highway, {count} victims unconscious and trapped, severe hemorrhaging reported.", {"water_litres": 80, "food_rations": 20, "medical_kits": 6, "ambulances": 2, "rescue_teams": 1}),
        ("MEDICAL", "Elderly patient collapsed, sudden cardiac arrest, no pulse, bystander CPR initiated for {count} person.", {"water_litres": 20, "food_rations": 0, "medical_kits": 2, "ambulances": 1, "rescue_teams": 0}),
        ("FIRE", "Industrial warehouse explosion, structural collapse with active chemical blaze, {count} workers unaccounted for inside.", {"water_litres": 200, "food_rations": 50, "medical_kits": 10, "ambulances": 3, "rescue_teams": 2}),
        ("COLLAPSE", "Four-story residential building structural collapse following tremor, screams heard from debris, {count} people buried alive.", {"water_litres": 150, "food_rations": 60, "medical_kits": 8, "ambulances": 3, "rescue_teams": 2}),
        ("FLOOD", "Flash flood breached barrier wall, roaring torrent submerging first floors, {count} residents trapped on roof clinging to antennas.", {"water_litres": 300, "food_rations": 100, "medical_kits": 10, "ambulances": 2, "rescue_teams": 3}),
        ("HAZMAT", "Toxic ammonia gas cloud escaping storage facility, {count} workers coughing blood and collapsing, immediate hazmat evacuation required.", {"water_litres": 100, "food_rations": 20, "medical_kits": 12, "ambulances": 4, "rescue_teams": 2}),
        ("SECURITY", "Armed assault in dense commercial plaza, multiple gunshot casualties reported, active scene with {count} injured victims.", {"water_litres": 50, "food_rations": 10, "medical_kits": 8, "ambulances": 3, "rescue_teams": 2})
    ],
    "HIGH": [
        ("MEDICAL", "Severe pedestrian hit-and-run, compound leg fractures, heavy arterial bleeding, {count} casualty conscious but fading.", {"water_litres": 30, "food_rations": 5, "medical_kits": 3, "ambulances": 1, "rescue_teams": 0}),
        ("FIRE", "Commercial restaurant grease fire spreading up kitchen exhaust duct, heavy black smoke filling upper floors, {count} people evacuated with smoke inhalation.", {"water_litres": 80, "food_rations": 25, "medical_kits": 4, "ambulances": 2, "rescue_teams": 1}),
        ("COLLAPSE", "Balcony overhang detached and fell onto sidewalk cafe, {count} people pinned under heavy masonry, serious blunt trauma.", {"water_litres": 60, "food_rations": 15, "medical_kits": 4, "ambulances": 2, "rescue_teams": 1}),
        ("FLOOD", "Storm surge inundating low-lying neighborhood streets up to waist level, power lines sparking in water, {count} families need immediate extraction.", {"water_litres": 120, "food_rations": 50, "medical_kits": 5, "ambulances": 1, "rescue_teams": 2}),
        ("SECURITY", "Violent riot erupted near transit station, bottles thrown, {count} bystanders injured with lacerations and head contusions.", {"water_litres": 40, "food_rations": 10, "medical_kits": 4, "ambulances": 2, "rescue_teams": 1})
    ],
    "MEDIUM": [
        ("MEDICAL", "Severe diabetic emergency, insulin reaction causing confusion and tremors, {count} patient conscious with family present.", {"water_litres": 15, "food_rations": 5, "medical_kits": 1, "ambulances": 1, "rescue_teams": 0}),
        ("MEDICAL", "Child fell from playground climbing frame, suspected broken forearm, crying and in pain, {count} casualty stabilized by school nurse.", {"water_litres": 10, "food_rations": 0, "medical_kits": 1, "ambulances": 1, "rescue_teams": 0}),
        ("FIRE", "Electrical panel sparking and smoking in apartment basement, main circuit breaker tripped, {count} residents gathered outside safely.", {"water_litres": 20, "food_rations": 10, "medical_kits": 1, "ambulances": 0, "rescue_teams": 1}),
        ("FLOOD", "Severe basement drain backup following heavy rainfall, 2 feet of stagnant water, {count} residents need sump pump and clean drinking supplies.", {"water_litres": 60, "food_rations": 20, "medical_kits": 1, "ambulances": 0, "rescue_teams": 1}),
        ("SECURITY", "Commercial burglary in progress, perpetrator fled, store owner shaken but uninjured, {count} witness on scene.", {"water_litres": 10, "food_rations": 0, "medical_kits": 0, "ambulances": 0, "rescue_teams": 1})
    ],
    "LOW": [
        ("MEDICAL", "Minor ankle sprain while jogging on public trail, able to bear slight weight, {count} person requesting non-emergency guidance.", {"water_litres": 10, "food_rations": 0, "medical_kits": 1, "ambulances": 0, "rescue_teams": 0}),
        ("FIRE", "Small controlled leaves fire in backyard emitting excessive smoke, no structural threat, {count} neighbor reporting odor complaint.", {"water_litres": 20, "food_rations": 0, "medical_kits": 0, "ambulances": 0, "rescue_teams": 0}),
        ("COLLAPSE", "Fallen wooden garden trellis and rotten boundary fence after gusty winds, no injuries, {count} home owner requesting cleanup advice.", {"water_litres": 0, "food_rations": 0, "medical_kits": 0, "ambulances": 0, "rescue_teams": 0}),
        ("FLOOD", "Minor street curb gutter puddle overflow, shallow standing water in driveway, {count} resident requesting storm drain clearance.", {"water_litres": 15, "food_rations": 0, "medical_kits": 0, "ambulances": 0, "rescue_teams": 0}),
        ("SECURITY", "Lost handbag reported in shopping mall food court, security camera review requested, {count} citizen waiting at help desk.", {"water_litres": 0, "food_rations": 0, "medical_kits": 0, "ambulances": 0, "rescue_teams": 0})
    ]
}

def generate_emergency_dataset(n_samples=2500, random_seed=42):
    random.seed(random_seed)
    np.random.seed(random_seed)

    data = []
    priorities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    priority_weights = [0.20, 0.35, 0.30, 0.15]

    score_ranges = {
        "CRITICAL": (0.82, 0.99),
        "HIGH": (0.60, 0.81),
        "MEDIUM": (0.35, 0.59),
        "LOW": (0.05, 0.34)
    }

    casualty_ranges = {
        "CRITICAL": (3, 25),
        "HIGH": (1, 8),
        "MEDIUM": (1, 3),
        "LOW": (0, 1)
    }

    for _ in range(n_samples):
        priority = random.choices(priorities, weights=priority_weights)[0]
        template_choice = random.choice(EMERGENCY_TEMPLATES[priority])
        category, desc_template, base_needs = template_choice

        c_min, c_max = casualty_ranges[priority]
        count = random.randint(c_min, c_max)

        # Populate text
        description = desc_template.format(count=count)

        # Perturb relief needs based on casualty count
        water = max(0, int(base_needs["water_litres"] * (0.8 + 0.4 * random.random()) + count * random.randint(2, 6)))
        food = max(0, int(base_needs["food_rations"] * (0.8 + 0.4 * random.random()) + count * random.randint(1, 3)))
        meds = max(0, int(base_needs["medical_kits"] * (0.8 + 0.4 * random.random()) + (1 if count > 0 else 0)))
        ambulances = max(0, int(base_needs["ambulances"] + (1 if count > 4 and priority in ["CRITICAL", "HIGH"] else 0)))
        rescue_teams = max(0, int(base_needs["rescue_teams"] + (1 if priority == "CRITICAL" and count > 8 else 0)))

        hour_of_day = random.randint(0, 23)

        # Continuous target urgency score
        s_min, s_max = score_ranges[priority]
        # Base score in range + small influence from count and needs
        noise = random.uniform(-0.03, 0.03)
        urgency_score = round(min(1.0, max(0.0, random.uniform(s_min, s_max) + noise)), 3)

        data.append({
            "type": category,
            "description": description,
            "affected_count": count,
            "need_water": water,
            "need_food": food,
            "need_medicine": meds,
            "need_ambulance": ambulances,
            "need_rescue_team": rescue_teams,
            "hour_of_day": hour_of_day,
            "priority_class": priority,
            "priority_score": urgency_score
        })

    df = pd.DataFrame(data)
    return df

if __name__ == "__main__":
    df = generate_emergency_dataset(100)
    print("Dataset generated successfully. Shape:", df.shape)
    print(df.head(3))

