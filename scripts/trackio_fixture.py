# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Write a small trackio-shaped database for the experiment-plot tests.

    uv run scripts/trackio_fixture.py src/test/fixtures/trackio/demo.db

The layout copies trackio's current schema: one `metrics` row per log call
with the JSON as a BLOB, a `configs` row per run. Three runs log
`split/family/name` keys over 50 steps, with validation in separate partial
rows every fifth step, one NaN, and an image-valued key that is not a metric.
The output is deterministic, so the committed file only changes when this
script does.
"""

import json
import math
import sqlite3
import sys
from pathlib import Path

RUNS = {
    "exp_1": {"model": {"arch": "conv", "n_params": 1_200_000}, "lr": 0.001, "seed": 1},
    "exp_2": {"model": {"arch": "vit", "n_params": 5_400_000}, "lr": 0.001, "seed": 2},
    "exp_3": {"model": {"arch": "conv", "n_params": 2_500_000}, "lr": 0.0003, "seed": 3},
}
STEPS = 50


def rows_for(run: str, index: int):
    speed = [0.08, 0.12, 0.05][index]
    floor = [0.6, 0.4, 0.5][index]
    for step in range(STEPS):
        ts = f"2026-01-0{index + 1}T10:{step // 60:02d}:{step % 60:02d}.000000+00:00"
        ce = floor + 2.0 * math.exp(-speed * step) + 0.02 * math.sin(step + index)
        kl = 0.3 * math.exp(-0.05 * step) + 0.01 * index
        yield step, ts, {
            "train/loss/ce": round(ce, 6),
            "train/loss/kl_teacher_student": round(kl, 6),
            "train/lr": RUNS[run]["lr"],
        }
        if step % 5 == 4:
            val_ce = "NaN" if (run == "exp_2" and step == 9) else round(ce + 0.15, 6)
            acc = round(0.9 - 0.5 * math.exp(-speed * step) - 0.05 * index, 6)
            yield step, ts, {
                "val/loss/ce": val_ce,
                "val/acc/top1": acc,
                "val/samples": {"_type": "trackio.image", "file_path": "media/x.png"},
            }


def main(out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    conn = sqlite3.connect(out)
    conn.executescript(
        """
        CREATE TABLE metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            run_name TEXT NOT NULL,
            step INTEGER NOT NULL,
            metrics TEXT NOT NULL,
            log_id TEXT,
            space_id TEXT
        );
        CREATE INDEX idx_metrics_run_step ON metrics(run_id, step);
        CREATE TABLE configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            run_name TEXT NOT NULL,
            config TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(run_id)
        );
        """
    )
    for index, (run, config) in enumerate(RUNS.items()):
        run_id = f"id-{run}"
        for step, ts, metrics in rows_for(run, index):
            conn.execute(
                "INSERT INTO metrics (run_id, timestamp, run_name, step, metrics) VALUES (?, ?, ?, ?, ?)",
                (run_id, ts, run, step, json.dumps(metrics, sort_keys=True).encode()),
            )
        conn.execute(
            "INSERT INTO configs (run_id, run_name, config, created_at) VALUES (?, ?, ?, ?)",
            (run_id, run, json.dumps(config, sort_keys=True).encode(), f"2026-01-0{index + 1}T10:00:00+00:00"),
        )
    conn.commit()
    conn.execute("VACUUM")
    conn.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run scripts/trackio_fixture.py OUT.db")
    main(Path(sys.argv[1]))
