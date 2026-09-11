from fastapi.testclient import TestClient

from app.main import REPORTS, app


client = TestClient(app)


def setup_function() -> None:
    REPORTS.clear()


def test_report_creation_calculates_high_priority() -> None:
    response = client.post(
        "/report",
        json={
            "transcription": "Urgent explosion and fire reported with many injured civilians",
            "report_type": "civilian",
            "location": {"latitude": 37.77, "longitude": -122.42, "label": "Market St"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["priority_level"] == "high"
    assert payload["urgency_score"] >= 70


def test_reports_are_sorted_by_urgency_descending() -> None:
    client.post(
        "/report",
        json={
            "transcription": "Minor traffic incident",
            "report_type": "civilian",
            "location": {"latitude": 40.71, "longitude": -74.0},
        },
    )
    high = client.post(
        "/report",
        json={
            "transcription": "Hostage situation with gunfire, urgent response needed immediately",
            "report_type": "military",
            "location": {"latitude": 34.05, "longitude": -118.25},
        },
    ).json()

    response = client.get("/reports")
    assert response.status_code == 200
    reports = response.json()

    assert len(reports) == 2
    assert reports[0]["id"] == high["id"]
    assert reports[0]["urgency_score"] >= reports[1]["urgency_score"]
