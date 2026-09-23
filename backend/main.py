from dotenv import load_dotenv

load_dotenv()  # picks up backend/.env if present — see .env.example. Loaded before any
# other import touches os.environ, so DATABASE_URL / JWT_SECRET_KEY / CORS_ORIGINS are
# available wherever those modules read them at import time.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import os

from database import Base, engine
import models  # noqa: F401 — importing registers the models on Base's metadata before create_all
from routes import auth, trips, requests as requests_routes, matches, handoffs

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Gaterelay API", version="1.0.0")

origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    # FastAPI's default 422 body is a deeply nested structure that's awkward for a frontend
    # to turn into a clean message — this flattens it to {"detail": "field: message"} so
    # the UI never has to show raw JSON to the user (Section 17/18).
    first_error = exc.errors()[0]
    field = ".".join(str(loc) for loc in first_error["loc"] if loc != "body")
    message = first_error["msg"]
    return JSONResponse(status_code=422, content={"detail": f"{field}: {message}" if field else message})


app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(trips.router, prefix="/trips", tags=["trips"])
app.include_router(requests_routes.router, prefix="/requests", tags=["requests"])
app.include_router(matches.router, prefix="/matches", tags=["matches"])
app.include_router(handoffs.router, prefix="/handoffs", tags=["handoffs"])


@app.get("/health")
def health():
    return {"status": "ok"}
