"""
Analytics Router.

Provides aggregated statistics endpoints for the Analytics dashboard page.
All computations are done server-side in PostgreSQL so the frontend never
has to download the full jobs list just to count things.

Endpoints:
  GET /analytics/overview            — KPIs: totals, avg score, funnel counts
  GET /analytics/score-distribution  — 10-bucket histogram data
  GET /analytics/trend               — daily job-count for last 30 days
  GET /analytics/budget-breakdown    — hourly vs fixed split + avg budgets
  GET /analytics/top-skills          — top N skills seen across all job postings
"""

from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, case, select, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import Job

router = APIRouter()


# ─── Overview ─────────────────────────────────────────────────────────────────

@router.get("/overview")
async def get_analytics_overview(db: AsyncSession = Depends(get_db)):
    """
    Return a single aggregated overview object with all key KPI stats.
    Powered by a single DB query using conditional aggregation.
    """
    result = await db.execute(
        select(
            func.count().label("total"),
            func.count(case((Job.status == "shortlisted", 1))).label("shortlisted"),
            func.count(case((Job.status == "applied", 1))).label("applied"),
            func.count(case((Job.status == "interviewing", 1))).label("interviewing"),
            func.count(case((Job.status == "hired", 1))).label("hired"),
            func.count(case((Job.status == "ignored", 1))).label("ignored"),
            func.avg(Job.match_score).label("avg_match_score"),
            func.max(Job.match_score).label("max_match_score"),
            func.count(case((Job.match_score >= 80, 1))).label("high_matches"),
            func.count(case((Job.match_score.between(60, 79), 1))).label("medium_matches"),
            func.count(case((Job.match_score < 60, 1))).label("low_matches"),
        ).select_from(Job)
    )
    row = result.one()

    return {
        "total_analyzed": row.total,
        "shortlisted": row.shortlisted,
        "applied": row.applied,
        "interviewing": row.interviewing,
        "hired": row.hired,
        "ignored": row.ignored,
        "avg_match_score": round(float(row.avg_match_score or 0), 1),
        "max_match_score": int(row.max_match_score or 0),
        "match_distribution": {
            "high": row.high_matches,
            "medium": row.medium_matches,
            "low": row.low_matches,
        },
    }


# ─── Score distribution histogram ─────────────────────────────────────────────

@router.get("/score-distribution")
async def get_score_distribution(db: AsyncSession = Depends(get_db)):
    """Return match score counts in 10-point buckets (0-9, 10-19, …, 90-100)."""
    result = await db.execute(
        select(Job.match_score).where(Job.match_score.isnot(None))
    )
    scores = [row[0] for row in result.all()]

    buckets = {f"{i*10}-{i*10+9}": 0 for i in range(10)}
    for score in scores:
        bucket_idx = min(int(score) // 10, 9)
        key = f"{bucket_idx*10}-{bucket_idx*10+9}"
        buckets[key] += 1

    return {"buckets": buckets, "total": len(scores)}


# ─── Trend (last 30 days) ─────────────────────────────────────────────────────

@router.get("/trend")
async def get_job_trend(
    days: int = Query(default=30, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
):
    """
    Return daily job counts for the last N days (default 30).
    Used for the sparkline / area chart on the Analytics page.
    Days with zero jobs are filled in so the chart has no gaps.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(
            cast(Job.detected_at, Date).label("day"),
            func.count().label("count"),
        )
        .where(Job.detected_at >= cutoff)
        .group_by(cast(Job.detected_at, Date))
        .order_by(cast(Job.detected_at, Date))
    )
    rows = result.all()

    # Build a full date range with zero-fill for missing days
    date_map: dict[str, int] = {str(r.day): r.count for r in rows}
    today = datetime.now(timezone.utc).date()
    trend = []
    for i in range(days - 1, -1, -1):
        d = str(today - timedelta(days=i))
        trend.append({"date": d, "count": date_map.get(d, 0)})

    return {"trend": trend, "days": days}


# ─── Budget breakdown ─────────────────────────────────────────────────────────

@router.get("/budget-breakdown")
async def get_budget_breakdown(db: AsyncSession = Depends(get_db)):
    """
    Return hourly vs fixed job split and average budget figures.
    Useful for understanding what budget ranges are most common.
    """
    result = await db.execute(
        select(
            func.count(case((Job.budget_type == "hourly", 1))).label("hourly_count"),
            func.count(case((Job.budget_type == "fixed", 1))).label("fixed_count"),
            func.avg(case((Job.budget_type == "hourly", Job.budget_min))).label("avg_hourly_min"),
            func.avg(case((Job.budget_type == "hourly", Job.budget_max))).label("avg_hourly_max"),
            func.avg(case((Job.budget_type == "fixed", Job.budget_min))).label("avg_fixed"),
            func.count().label("total"),
        ).select_from(Job)
    )
    row = result.one()

    total = row.total or 1
    return {
        "hourly": {
            "count": row.hourly_count,
            "pct": round(row.hourly_count / total * 100, 1),
            "avg_min": round(float(row.avg_hourly_min or 0), 2),
            "avg_max": round(float(row.avg_hourly_max or 0), 2),
        },
        "fixed": {
            "count": row.fixed_count,
            "pct": round(row.fixed_count / total * 100, 1),
            "avg": round(float(row.avg_fixed or 0), 2),
        },
    }


# ─── Top skills ───────────────────────────────────────────────────────────────

@router.get("/top-skills")
async def get_top_skills(
    limit: int = Query(default=12, ge=5, le=30),
    db: AsyncSession = Depends(get_db),
):
    """
    Count skill frequency across all job postings (from the JSONB required_skills
    column) and return the top N most-requested skills.
    """
    result = await db.execute(
        select(Job.required_skills).where(Job.required_skills.isnot(None))
    )
    # Each row is a list (JSONB array); flatten all into a Counter
    counter: Counter = Counter()
    for (skills,) in result.all():
        if isinstance(skills, list):
            counter.update(s.strip() for s in skills if s and isinstance(s, str))

    top = [{"skill": skill, "count": cnt} for skill, cnt in counter.most_common(limit)]
    return {"skills": top, "total_jobs_with_skills": len(counter)}
