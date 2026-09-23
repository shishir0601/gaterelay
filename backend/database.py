"""
Database engine and session setup.

SQLite for a project this size is a deliberate choice, not a shortcut: it needs zero setup
(no separate DB server to run) and the whole database is one inspectable file. It does NOT,
by itself, make concurrent writes safe — see build_engine's BEGIN IMMEDIATE setup below for
a real race condition this needed fixing for, found by actually testing concurrent requests
rather than assuming SQLite's file-level locking would handle it automatically.
"""

import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./gaterelay.db")


def build_engine(database_url: str):
    """Factory, not just a module-level singleton, so the test suite's concurrency
    regression test (tests/test_matches.py) can build a second engine against a real
    temp *file* database with these exact same locking semantics — proving the fix against
    the same kind of separate-connection behavior production actually has, rather than the
    single shared in-memory connection the rest of the test suite uses for speed (see
    tests/conftest.py's StaticPool, which is fine for every other test but can't reproduce
    this specific race at all, since with only one underlying connection there's nothing
    for BEGIN IMMEDIATE to lock against)."""
    engine = create_engine(database_url, connect_args={"check_same_thread": False, "timeout": 5})

    # The two event listeners below close a real concurrency bug found during review:
    # SQLite's *default* transaction mode is "deferred" — a transaction doesn't actually
    # acquire a write lock until its first write statement runs, not when it starts. That
    # meant two concurrent accept-match requests could both read the same trip as ACTIVE,
    # both pass validation, and both commit a handoff for it — a single-capacity trip got
    # booked twice under real concurrent load (proven with an actual multi-threaded test
    # against the live server, not just reasoned about).
    #
    # This is SQLAlchemy's own documented workaround for that exact pysqlite behavior:
    # disable pysqlite's automatic (deferred) BEGIN, then issue "BEGIN IMMEDIATE" ourselves
    # on every transaction, which acquires the write lock immediately at the start instead
    # of lazily. With that in place, the second concurrent request's read genuinely happens
    # after the first request's write commits, not concurrently with it — it then correctly
    # sees the trip as already MATCHED and returns 409, instead of both succeeding.
    # `timeout=5` lets the second connection wait up to 5 seconds for the (near-instant)
    # first transaction to finish, rather than immediately raising "database is locked".
    @event.listens_for(engine, "connect")
    def _disable_pysqlite_implicit_begin(dbapi_connection, connection_record):
        dbapi_connection.isolation_level = None
        # SQLite does NOT enforce foreign key constraints by default -- ondelete="CASCADE"
        # declared on a Column is otherwise pure documentation, not an active guarantee.
        # This was a real, previously-unverified gap found during review: a user who was a
        # requester on an accepted match couldn't be deleted at all, because SQLAlchemy's
        # ORM-level cascade tried to nullify the (NOT NULL) handoffs.request_id column
        # instead of deleting the Handoff row with it. Turning this on, plus the
        # cascade="all, delete-orphan" added to Trip.handoffs/Request.handoffs in
        # models.py, makes deletes behave consistently and correctly however they happen —
        # through the ORM or through raw SQL.
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    @event.listens_for(engine, "begin")
    def _begin_immediate(conn):
        conn.exec_driver_sql("BEGIN IMMEDIATE")

    return engine


engine = build_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency: one session per request, always closed afterward."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
