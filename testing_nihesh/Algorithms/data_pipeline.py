"""Data pipeline for processing CSV files and generating reports."""
import csv
import json
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List


@dataclass
class Record:
    name: str
    age: int
    email: str
    score: float


def load_csv(path: str) -> List[Record]:
    records = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(Record(
                name=row["name"],
                age=int(row["age"]),
                email=row["email"],
                score=float(row["score"]),
            ))
    return records


def generate_report(records: List[Record]) -> dict:
    avg_score = sum(r.score for r in records) / len(records)
    return {
        "total_records": len(records),
        "average_score": round(avg_score, 2),
        "top_performers": [asdict(r) for r in records if r.score > 90],
    }


if __name__ == "__main__":
    data = load_csv("students.csv")
    report = generate_report(data)
    print(json.dumps(report, indent=2))
