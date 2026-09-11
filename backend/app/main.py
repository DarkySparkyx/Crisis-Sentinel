from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from enum import IntEnum


class Location(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    label: str | None = None


class ReportIn(BaseModel):
    transcription: str = Field(min_length=1)
    report_type: Literal["civilian", "military"]
    location: Location


class ReportOut(ReportIn):
    id: str
    created_at: datetime
    urgency_score: int
    priority_level: Literal["high", "medium", "low"]
    active: bool = True

class PriorityLevel(IntEnum):
    LOW = 0
    MEDIUM = 40
    HIGH = 70

    @classmethod
    def from_score(cls, score: int) -> PriorityLevel:
        if score >= cls.HIGH:
            return cls.HIGH
        if score >= cls.MEDIUM:
            return cls.MEDIUM
        return cls.LOW

app = FastAPI(title="Crisis Sentinel API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REPORTS: list[ReportOut] = []

KEYWORD_SCORES = {
    "explosion": 50,
    "fire": 40,
    "collapse": 35,
    "gunfire": 45,
    "hostage": 55,
    "bleeding": 30,
    "injured": 25,
    "evacuate": 20,
    "chemical": 45,
}


def _score_report(payload: ReportIn) -> int:
    score = 20 if payload.report_type == "military" else 10
    normalized = payload.transcription.lower()
    for keyword, points in KEYWORD_SCORES.items():
        if keyword in normalized:
            score += points
    if "multiple" in normalized or "many" in normalized:
        score += 15
    if "urgent" in normalized or "immediately" in normalized:
        score += 10
    return max(0, min(score, 100))




@app.post("/report", response_model=ReportOut)
def create_report(payload: ReportIn) -> ReportOut:
    score = _score_report(payload)
    report = ReportOut(
        id=str(uuid4()),
        created_at=datetime.now(timezone.utc),
        urgency_score=score,
        priority_level=PriorityLevel.from_score(score),
        **payload.model_dump(),
    )
    REPORTS.append(report)
    return report


@app.get("/reports", response_model=list[ReportOut])
def get_reports() -> list[ReportOut]:
    active_reports = [report for report in REPORTS if report.active]
    return sorted(active_reports, key=lambda report: report.urgency_score, reverse=True)
