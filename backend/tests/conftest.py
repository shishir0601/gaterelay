import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from database import Base, get_db
from main import app

# A fresh in-memory SQLite database per test function — StaticPool keeps the same
# in-memory DB alive across the multiple connections a single test's requests/fixtures
# open (an in-memory SQLite DB normally disappears the moment its one connection closes).
from sqlalchemy.pool import StaticPool

TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture()
def db_engine():
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db_engine):
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def register_and_login(client, email="user@example.com", name="Test User", password="password123") -> str:
    """Returns a bearer token for a freshly-registered user."""
    client.post("/auth/register", json={"name": name, "email": email, "password": password})
    res = client.post("/auth/login", json={"email": email, "password": password})
    return res.json()["access_token"]


@pytest.fixture()
def auth_headers(client):
    token = register_and_login(client)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def second_auth_headers(client):
    token = register_and_login(client, email="second@example.com", name="Second User")
    return {"Authorization": f"Bearer {token}"}
