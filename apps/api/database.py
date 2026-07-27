import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Import settings - handle both package and direct execution
try:
    from .config import settings
except ImportError:
    from config import settings

# Configure engine with conservative pool settings to prevent Supabase connection exhaustion.
# Uses PgBouncer transaction mode (port 6543) — requires statement_cache_size=0.
_is_pgbouncer = "pgbouncer=true" in settings.database_url or ":6543" in settings.database_url

engine = create_engine(
    settings.database_url,
    pool_size=2,
    max_overflow=3,
    pool_recycle=300,
    pool_pre_ping=True,
    connect_args={"options": "-c statement_timeout=30000"} if not _is_pgbouncer else {},
    execution_options={"no_parameters": True} if _is_pgbouncer else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
