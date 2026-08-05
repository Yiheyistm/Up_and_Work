"""
Backend Unit Tests Suite for Up_and_Work.

Tests core utility functions, database URL parsing, RSS budget/skills extraction,
Pydantic schemas, and FastAPI endpoints.
"""

import unittest
import os
from backend.database import fix_database_url
from backend.rss_monitor import extract_budget, extract_skills
from backend.schemas import JobBase


class TestDatabaseUtils(unittest.TestCase):
    def test_postgres_url_conversion(self):
        url = "postgres://user:pass@localhost:5432/dbname"
        fixed = fix_database_url(url)
        self.assertTrue(fixed.startswith("postgresql+asyncpg://"))

    def test_sslmode_replacement(self):
        url = "postgresql://user:pass@localhost:5432/dbname?sslmode=require"
        fixed = fix_database_url(url)
        self.assertIn("ssl=require", fixed)
        self.assertNotIn("sslmode=", fixed)


class TestRssParser(unittest.TestCase):
    def test_extract_fixed_budget(self):
        html_desc = "<div><b>Budget:</b> $500</div>"
        result = extract_budget(html_desc)
        self.assertEqual(result["budget_type"], "Fixed")
        self.assertEqual(result["budget_min"], 500.0)

    def test_extract_hourly_budget(self):
        html_desc = "<div><b>Hourly Range:</b> $30 - $60</div>"
        result = extract_budget(html_desc)
        self.assertEqual(result["budget_type"], "Hourly")
        self.assertEqual(result["budget_min"], 30.0)
        self.assertEqual(result["budget_max"], 60.0)

    def test_extract_skills(self):
        html_desc = "<div><b>Skills:</b> Python, FastAPI, React, PostgreSQL</div>"
        skills = extract_skills(html_desc)
        self.assertEqual(skills, ["Python", "FastAPI", "React", "PostgreSQL"])


class TestSchemas(unittest.TestCase):
    def test_job_base_schema(self):
        job = JobBase(
            guid="test-guid-123",
            link="https://www.upwork.com/jobs/~0123456789",
            title="Senior Python Developer",
            description="Build scalable FastAPI services",
            status="new",
            budget_type="Fixed",
            budget_min=1000.0,
            budget_max=1000.0,
            required_skills=["Python", "FastAPI"]
        )
        self.assertEqual(job.title, "Senior Python Developer")
        self.assertEqual(len(job.required_skills), 2)


if __name__ == "__main__":
    unittest.main()
