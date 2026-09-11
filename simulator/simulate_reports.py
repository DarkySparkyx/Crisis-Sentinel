from __future__ import annotations

import argparse
import random
import time

import requests


SAMPLE_REPORTS = [
    {
        "transcription": "Building fire spreading quickly with many trapped residents",
        "report_type": "civilian",
        "location": {"latitude": 40.7128, "longitude": -74.0060, "label": "New York"},
    },
    {
        "transcription": "Possible chemical leak near rail station, urgent evacuation requested",
        "report_type": "civilian",
        "location": {"latitude": 51.5074, "longitude": -0.1278, "label": "London"},
    },
    {
        "transcription": "Hostage situation with gunfire reported at border checkpoint",
        "report_type": "military",
        "location": {"latitude": 31.7683, "longitude": 35.2137, "label": "Jerusalem"},
    },
    {
        "transcription": "Minor vehicle collision, no severe injuries reported",
        "report_type": "civilian",
        "location": {"latitude": 48.8566, "longitude": 2.3522, "label": "Paris"},
    },
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Push mock crisis reports to backend.")
    parser.add_argument("--api-url", default="http://localhost:8000", help="Backend base URL")
    parser.add_argument("--count", type=int, default=8, help="Number of reports to submit")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between reports")
    args = parser.parse_args()

    endpoint = f"{args.api_url.rstrip('/')}/report"

    for index in range(args.count):
        payload = random.choice(SAMPLE_REPORTS)
        response = requests.post(endpoint, json=payload, timeout=10)
        response.raise_for_status()
        body = response.json()
        print(
            f"[{index + 1}/{args.count}] "
            f"{body['id']} | {body['priority_level']} | score={body['urgency_score']}"
        )
        time.sleep(args.delay)


if __name__ == "__main__":
    main()
