import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Import settings - handle both package and direct execution
try:
    from .config import settings
except ImportError:
    from config import settings

# Detect PgBouncer transaction mode by port 6543.
# Do NOT add ?pgbouncer=true to the URL — psycopg2 rejects unknown DSN options.
_is_pgbouncer = ":6543" in settings.database_url

engine = create_engine(
    settings.database_url,
    pool_size=2,
    max_overflow=3,
    pool_recycle=300,
    pool_pre_ping=True,
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
