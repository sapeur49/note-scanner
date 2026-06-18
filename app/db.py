"""Persistence layer for saved notes.

Uses SQLAlchemy Core with generic types so the same code runs against the
Railway MySQL instance in production (via DATABASE_URL / MYSQL_URL) and a local
SQLite file during development (when neither env var is set).
"""

import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    delete as sa_delete,
    insert,
    or_,
    select,
    update as sa_update,
)
from sqlalchemy.dialects.mysql import MEDIUMTEXT


_SQLITE_FALLBACK = "sqlite:///./readwrite_local.db"


def _db_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("MYSQL_URL")
    if not url:
        return _SQLITE_FALLBACK
    # Guard against a bare value (e.g. DATABASE_URL set to a DB name like
    # "railway" instead of a full connection string). create_engine() would
    # raise at import and crash the whole app before main.py can catch it.
    if "://" not in url:
        print(
            f"[db] DATABASE_URL/MYSQL_URL is not a valid connection string "
            f"({url!r}); expected e.g. mysql://user:pass@host:port/db. "
            f"Falling back to SQLite — saved notes will NOT persist."
        )
        return _SQLITE_FALLBACK
    # Railway hands out mysql:// — SQLAlchemy needs an explicit driver.
    if url.startswith("mysql://"):
        url = url.replace("mysql://", "mysql+pymysql://", 1)
    return url


engine = create_engine(_db_url(), pool_pre_ping=True, future=True)
metadata = MetaData()

# Long free text uses MEDIUMTEXT on MySQL (16 MB) but plain Text elsewhere.
_LongText = Text().with_variant(MEDIUMTEXT, "mysql")

notes = Table(
    "notes",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", String(255), nullable=False, index=True),
    Column("title", String(512)),
    Column("summary", _LongText),
    Column("transcription", _LongText),
    Column("additional_notes", _LongText),
    Column("scanned_at", DateTime),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=False),
    # [{position, kind: "image"|"pdf", filename, mime, original_name}]
    Column("files", JSON),
)


def init_db() -> None:
    metadata.create_all(engine)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_dt(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except (ValueError, AttributeError):
        return None


def _iso(dt):
    return dt.isoformat() if isinstance(dt, datetime) else dt


def create_note(user_id: str, data: dict, files: list, note_id: str = None) -> str:
    note_id = note_id or str(uuid.uuid4())
    now = _utcnow()
    with engine.begin() as conn:
        conn.execute(
            insert(notes).values(
                id=note_id,
                user_id=user_id,
                title=data.get("title") or "",
                summary=data.get("summary") or "",
                transcription=data.get("transcription") or "",
                additional_notes=data.get("additional_notes") or None,
                scanned_at=_parse_dt(data.get("scanned_at")),
                created_at=now,
                updated_at=now,
                files=files,
            )
        )
    return note_id


def list_notes(user_id: str, q: str = "") -> list:
    stmt = select(
        notes.c.id,
        notes.c.title,
        notes.c.summary,
        notes.c.scanned_at,
        notes.c.created_at,
    ).where(notes.c.user_id == user_id)

    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                notes.c.title.like(like),
                notes.c.summary.like(like),
                notes.c.transcription.like(like),
            )
        )
    stmt = stmt.order_by(notes.c.created_at.desc())

    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()

    out = []
    for r in rows:
        summary = r["summary"] or ""
        snippet = summary[:140] + ("…" if len(summary) > 140 else "")
        out.append(
            {
                "id": r["id"],
                "title": r["title"] or "",
                "summary_snippet": snippet,
                "scanned_at": _iso(r["scanned_at"]),
                "created_at": _iso(r["created_at"]),
            }
        )
    return out


def get_note(user_id: str, note_id: str):
    stmt = select(notes).where(
        notes.c.id == note_id, notes.c.user_id == user_id
    )
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    if not row:
        return None
    d = dict(row)
    d["scanned_at"] = _iso(d.get("scanned_at"))
    d["created_at"] = _iso(d.get("created_at"))
    d["updated_at"] = _iso(d.get("updated_at"))
    d["files"] = d.get("files") or []
    return d


_EDITABLE = ("title", "summary", "transcription", "additional_notes")


def update_note(user_id: str, note_id: str, fields: dict) -> int:
    values = {k: fields[k] for k in _EDITABLE if k in fields}
    if not values:
        return 0
    values["updated_at"] = _utcnow()
    stmt = (
        sa_update(notes)
        .where(notes.c.id == note_id, notes.c.user_id == user_id)
        .values(**values)
    )
    with engine.begin() as conn:
        result = conn.execute(stmt)
    return result.rowcount


def delete_note(user_id: str, note_id: str) -> int:
    stmt = sa_delete(notes).where(
        notes.c.id == note_id, notes.c.user_id == user_id
    )
    with engine.begin() as conn:
        result = conn.execute(stmt)
    return result.rowcount
