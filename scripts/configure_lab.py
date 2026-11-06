"""Pause/resume one versioned Lab method without editing any forecast history."""
import argparse
import json
from pathlib import Path

METHODS = ["baseline-control-v1", "qualified-baseline-v1", "first-half-defense-v1", "bonus-exposure-v1", "enhanced-baseline-v1", "enhanced-baseline-v2"]


def configure(path: Path, method: str, action: str):
    if method not in METHODS or action not in ["enable", "disable"]:
        raise ValueError("Unknown Lab method or collection action")
    data = json.loads(path.read_text(encoding="utf-8"))
    matches = [row for row in data["methods"] if row["id"] == method]
    if len(matches) != 1:
        raise ValueError("Method must have exactly one shared configuration")
    matches[0]["enabled"] = action == "enable"
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--method", choices=METHODS, required=True)
    parser.add_argument("--action", choices=["enable", "disable"], required=True)
    parser.add_argument("--config", type=Path, default=Path("public/data/lab-config.json"))
    args = parser.parse_args()
    configure(args.config, args.method, args.action)
