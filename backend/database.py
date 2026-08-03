"""
Database Configuration and Setup.

This module is responsible for setting up the async PostgreSQL database connection
using SQLAlchemy's asyncpg driver. It creates the async engine, configures the
session factory (AsyncSessionLocal), and provides the `get_db` dependency injection
function used by FastAPI routes to acquire and release database sessions.
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv

# Load env vars
load_dotenv()

def fix_database_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://") and not url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    if "sslmode=" in url:
        url = url.replace("sslmode=require", "ssl=require")
        url = url.replace("sslmode=prefer", "ssl=require")
        url = url.replace("sslmode=verify-full", "ssl=require")
        url = url.replace("sslmode=disable", "ssl=disable")
        url = url.replace("sslmode=", "ssl=")
    return url

RAW_DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+asyncpg://upwork_user:upwork_password@localhost:5433/upwork_jobs")
DATABASE_URL = fix_database_url(RAW_DATABASE_URL)

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
