"""Persistence layer for saved notes.

Uses SQLAlchemy Core with generic types so the same code runs against the
Railway MySQL instance in production (via DATABASE_URL / MYSQL_URL) and a local
SQLite file during development (when neither env var is set).
"""

import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
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
    inspect as sa_inspect,
    or_,
    select,
    text,
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
    # [{position, kind: "image"|"pdf", filename, mime, original_name, exif?}]
    Column("files", JSON),
    Column("share_token", String(36), nullable=True),
    Column("publish_options", JSON, nullable=True),
    Column("is_published", Boolean, nullable=True, default=False),
    Column("visibility", String(32), nullable=True, default="public"),
)

user_settings = Table(
    "user_settings",
    metadata,
    Column("user_id", String(255), primary_key=True),
    Column("story_list_title", String(512), nullable=True),
    Column("template", String(32), nullable=True),    # minimal|bold|magazine
    Column("logo_on", String(8), nullable=True),      # "true"|"false"
    Column("list_public", String(8), nullable=True),  # "true"|"false"
    Column("list_token", String(36), nullable=True),  # stable public UUID
)


def init_db() -> None:
    metadata.create_all(engine)
    _migrate_schema()


def _migrate_schema() -> None:
    """Idempotent: add new columns to existing tables if absent."""
    try:
        inspector = sa_inspect(engine)
        if "notes" not in inspector.get_table_names():
            return  # create_all handles new tables
        existing = {c["name"] for c in inspector.get_columns("notes")}
        with engine.begin() as conn:
            if "share_token" not in existing:
                conn.execute(text("ALTER TABLE notes ADD COLUMN share_token VARCHAR(36) NULL"))
            if "publish_options" not in existing:
                conn.execute(text("ALTER TABLE notes ADD COLUMN publish_options JSON NULL"))
            if "is_published" not in existing:
                conn.execute(text("ALTER TABLE notes ADD COLUMN is_published INTEGER DEFAULT 0"))
                # Backfill: notes with a token were published before this column existed
                conn.execute(text("UPDATE notes SET is_published = 1 WHERE share_token IS NOT NULL"))
            if "visibility" not in existing:
                conn.execute(text("ALTER TABLE notes ADD COLUMN visibility VARCHAR(32) DEFAULT 'public'"))
    except Exception as e:
        print(f"[db] migration warning: {e}")


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
    if isinstance(dt, datetime):
        return dt.isoformat() + ("" if dt.tzinfo is not None else "+00:00")
    return dt


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
        notes.c.share_token,
        notes.c.is_published,
        notes.c.files,
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
        files = r["files"] or []
        first_image = next((f for f in files if f.get("kind") == "image"), None)
        out.append(
            {
                "id": r["id"],
                "title": r["title"] or "",
                "summary_snippet": snippet,
                "scanned_at": _iso(r["scanned_at"]),
                "created_at": _iso(r["created_at"]),
                "share_token": r["share_token"] if r.get("is_published") else None,
                "first_image_position": first_image["position"] if first_image else None,
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


_EDITABLE = ("title", "summary", "transcription", "additional_notes", "publish_options", "scanned_at", "visibility")


def update_note(user_id: str, note_id: str, fields: dict) -> int:
    values = {k: fields[k] for k in _EDITABLE if k in fields}
    if not values:
        return 0
    if "scanned_at" in values:
        parsed = _parse_dt(values["scanned_at"])
        if parsed:
            values["scanned_at"] = parsed
        else:
            values.pop("scanned_at")
    values["updated_at"] = _utcnow()
    stmt = (
        sa_update(notes)
        .where(notes.c.id == note_id, notes.c.user_id == user_id)
        .values(**values)
    )
    with engine.begin() as conn:
        result = conn.execute(stmt)
    return result.rowcount


def update_note_files(user_id: str, note_id: str, files: list) -> int:
    stmt = (
        sa_update(notes)
        .where(notes.c.id == note_id, notes.c.user_id == user_id)
        .values(files=files, updated_at=_utcnow())
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


def publish_note(user_id: str, note_id: str):
    """Generate/reuse share token and mark note as published. Returns token or None if not found."""
    stmt = select(notes.c.share_token).where(
        notes.c.id == note_id, notes.c.user_id == user_id
    )
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    if row is None:
        return None
    token = row["share_token"] or str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            sa_update(notes)
            .where(notes.c.id == note_id, notes.c.user_id == user_id)
            .values(share_token=token, is_published=True)
        )
    return token


def unpublish_note(user_id: str, note_id: str) -> bool:
    """Mark note as unpublished (token is preserved). Returns True if note was found."""
    stmt = (
        sa_update(notes)
        .where(notes.c.id == note_id, notes.c.user_id == user_id)
        .values(is_published=False)
    )
    with engine.begin() as conn:
        result = conn.execute(stmt)
    return result.rowcount > 0


def get_note_by_share_token(token: str):
    """Fetch a published note by share_token (no user auth check)."""
    stmt = select(notes).where(
        notes.c.share_token == token,
        notes.c.is_published == True,
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


# ── User settings ─────────────────────────────────────────────────────────────

_SETTINGS_FIELDS = ("story_list_title", "template", "logo_on", "list_public")


def get_settings(user_id: str) -> dict:
    stmt = select(user_settings).where(user_settings.c.user_id == user_id)
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    if not row:
        return {"user_id": user_id, "story_list_title": None, "template": None,
                "logo_on": None, "list_public": None, "list_token": None}
    return dict(row)


def upsert_settings(user_id: str, fields: dict) -> dict:
    values = {k: fields[k] for k in _SETTINGS_FIELDS if k in fields}
    with engine.connect() as conn:
        existing_row = conn.execute(
            select(user_settings.c.user_id, user_settings.c.list_token)
            .where(user_settings.c.user_id == user_id)
        ).mappings().first()
    if not (existing_row and existing_row.get("list_token")):
        values["list_token"] = str(uuid.uuid4())
    if existing_row:
        stmt = (
            sa_update(user_settings)
            .where(user_settings.c.user_id == user_id)
            .values(**values)
        )
    else:
        values["user_id"] = user_id
        stmt = insert(user_settings).values(**values)
    with engine.begin() as conn:
        conn.execute(stmt)
    return get_settings(user_id)


def get_settings_by_list_token(list_token: str) -> dict | None:
    stmt = select(user_settings).where(user_settings.c.list_token == list_token)
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    return dict(row) if row else None


def list_published_notes(user_id: str) -> list:
    """All published notes for a user, excluding those with includeInList=false."""
    stmt = select(
        notes.c.id,
        notes.c.title,
        notes.c.summary,
        notes.c.scanned_at,
        notes.c.created_at,
        notes.c.share_token,
        notes.c.files,
        notes.c.publish_options,
    ).where(
        notes.c.user_id == user_id,
        notes.c.is_published == True,
    ).order_by(notes.c.created_at.desc())

    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()

    out = []
    for r in rows:
        opts = r["publish_options"] or {}
        if opts.get("includeInList") is False:
            continue
        summary = r["summary"] or ""
        snippet = summary[:140] + ("…" if len(summary) > 140 else "")
        files = r["files"] or []
        excluded = set(int(p) for p in (opts.get("excludedImages") or []))
        image_positions = [f["position"] for f in files if f.get("kind") == "image" and f["position"] not in excluded]
        out.append({
            "id": r["id"],
            "title": r["title"] or "",
            "summary_snippet": snippet,
            "scanned_at": _iso(r["scanned_at"]),
            "created_at": _iso(r["created_at"]),
            "share_token": r["share_token"],
            "image_positions": image_positions,
        })
    return out


def get_adjacent_published_notes(user_id: str, note_id: str) -> dict:
    """Return prev/next share tokens for a note within the user's published list (ordered by created_at desc)."""
    items = list_published_notes(user_id)
    idx = next((i for i, n in enumerate(items) if n["id"] == note_id), None)
    if idx is None:
        return {"prev_token": None, "next_token": None}
    prev_token = items[idx - 1]["share_token"] if idx > 0 else None
    next_token = items[idx + 1]["share_token"] if idx + 1 < len(items) else None
    return {"prev_token": prev_token, "next_token": next_token}
