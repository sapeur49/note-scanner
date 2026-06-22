"""Persistence layer for saved notes.

Uses SQLAlchemy Core with generic types so the same code runs against the
Railway MySQL instance in production (via DATABASE_URL / MYSQL_URL) and a local
SQLite file during development (when neither env var is set).
"""

import os
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Integer,
    JSON,
    Column,
    DateTime,
    MetaData,
    String,
    Table,
    Text,
    and_,
    create_engine,
    delete as sa_delete,
    func,
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
    Column("slug", String(255), nullable=True),
)

user_settings = Table(
    "user_settings",
    metadata,
    Column("user_id", String(255), primary_key=True),
    Column("story_list_title", String(512), nullable=True),
    Column("template", String(32), nullable=True),             # minimal|bold|magazine
    Column("logo_on", String(8), nullable=True),               # "true"|"false"
    Column("list_public", String(8), nullable=True),           # "true"|"false"
    Column("list_token", String(36), nullable=True),           # stable public UUID
    Column("show_notebook_filter", String(8), nullable=True),  # "true"|"false"
    Column("scan_prompt", _LongText, nullable=True),           # custom scan prompt; None = use default
)

notebooks = Table(
    "notebooks",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", String(255), nullable=False, index=True),
    Column("title", String(512), nullable=False),
    Column("created_at", DateTime, nullable=False),
    Column("slug", String(255), nullable=True),
    Column("access_code_hash", String(255), nullable=True),
)

note_notebooks = Table(
    "note_notebooks",
    metadata,
    Column("note_id", String(36), primary_key=True),
    Column("notebook_id", String(36), primary_key=True),
)

global_settings = Table(
    "global_settings",
    metadata,
    Column("key", String(64), primary_key=True),
    Column("value", Text, nullable=True),
)

scan_counts = Table(
    "scan_counts",
    metadata,
    Column("user_id", String(255), primary_key=True),
    Column("scan_date", String(10), primary_key=True),
    Column("count", Integer, nullable=False, default=0),
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
            if "slug" not in existing:
                conn.execute(text("ALTER TABLE notes ADD COLUMN slug VARCHAR(255) NULL"))
        if "user_settings" in inspector.get_table_names():
            us_existing = {c["name"] for c in inspector.get_columns("user_settings")}
            with engine.begin() as conn:
                if "show_notebook_filter" not in us_existing:
                    conn.execute(text("ALTER TABLE user_settings ADD COLUMN show_notebook_filter VARCHAR(8) NULL"))
                if "scan_prompt" not in us_existing:
                    conn.execute(text("ALTER TABLE user_settings ADD COLUMN scan_prompt TEXT NULL"))
        if "notebooks" in inspector.get_table_names():
            nb_existing = {c["name"] for c in inspector.get_columns("notebooks")}
            with engine.begin() as conn:
                if "slug" not in nb_existing:
                    conn.execute(text("ALTER TABLE notebooks ADD COLUMN slug VARCHAR(255) NULL"))
                if "access_code_hash" not in nb_existing:
                    conn.execute(text("ALTER TABLE notebooks ADD COLUMN access_code_hash VARCHAR(255) NULL"))
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


def _slugify(title: str) -> str:
    """Convert a title to a URL-safe slug (max 60 chars)."""
    s = title.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s[:60] or "note"


def _make_slug(base_slug: str, user_id: str, exclude_note_id: str = None) -> str:
    """Return `base_slug` if unused for this user, else `base_slug-N` (smallest N≥2)."""
    with engine.connect() as conn:
        stmt = select(notes.c.slug).where(
            notes.c.user_id == user_id,
            notes.c.slug.isnot(None),
        )
        if exclude_note_id:
            stmt = stmt.where(notes.c.id != exclude_note_id)
        existing = {r[0] for r in conn.execute(stmt).fetchall()}
    if base_slug not in existing:
        return base_slug
    i = 2
    while f"{base_slug}-{i}" in existing:
        i += 1
    return f"{base_slug}-{i}"


def _make_notebook_slug(base_slug: str, user_id: str, exclude_nb_id: str = None) -> str:
    """Return `base_slug` if unused among this user's notebooks, else append -N."""
    with engine.connect() as conn:
        stmt = select(notebooks.c.slug).where(
            notebooks.c.user_id == user_id,
            notebooks.c.slug.isnot(None),
        )
        if exclude_nb_id:
            stmt = stmt.where(notebooks.c.id != exclude_nb_id)
        existing = {r[0] for r in conn.execute(stmt).fetchall()}
    if base_slug not in existing:
        return base_slug
    i = 2
    while f"{base_slug}-{i}" in existing:
        i += 1
    return f"{base_slug}-{i}"


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


def list_notes(user_id: str, q: str = "", notebook_id: str = "") -> list:
    stmt = select(
        notes.c.id,
        notes.c.title,
        notes.c.summary,
        notes.c.scanned_at,
        notes.c.created_at,
        notes.c.share_token,
        notes.c.is_published,
        notes.c.visibility,
        notes.c.files,
    ).where(notes.c.user_id == user_id)

    if notebook_id:
        if notebook_id == "system:public":
            stmt = stmt.where(and_(notes.c.is_published == True, notes.c.visibility == "public"))
        elif notebook_id == "system:login_restricted":
            stmt = stmt.where(and_(notes.c.is_published == True, notes.c.visibility == "logged_in"))
        elif notebook_id == "system:me":
            stmt = stmt.where(and_(notes.c.is_published == True, notes.c.visibility == "me"))
        elif notebook_id == "system:unpublished":
            stmt = stmt.where(or_(notes.c.is_published == None, notes.c.is_published == False))
        else:
            stmt = stmt.where(
                notes.c.id.in_(
                    select(note_notebooks.c.note_id).where(note_notebooks.c.notebook_id == notebook_id)
                )
            )
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
                "visibility": r["visibility"] or "public",
                "first_image_position": first_image["position"] if first_image else None,
                "notebook_ids": [],
            }
        )

    # Attach notebook memberships in one batch query
    if out:
        note_ids = [n["id"] for n in out]
        nn_stmt = select(note_notebooks.c.note_id, note_notebooks.c.notebook_id).where(
            note_notebooks.c.note_id.in_(note_ids)
        )
        with engine.connect() as conn2:
            nn_rows = conn2.execute(nn_stmt).fetchall()
        note_nb_map: dict = {}
        for note_id, notebook_id in nn_rows:
            note_nb_map.setdefault(note_id, []).append(notebook_id)
        for n in out:
            n["notebook_ids"] = note_nb_map.get(n["id"], [])

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
    d["notebook_ids"] = get_note_notebook_ids(note_id)
    return d


_EDITABLE = ("title", "summary", "transcription", "additional_notes", "publish_options", "scanned_at", "visibility", "slug")


def update_note(user_id: str, note_id: str, fields: dict) -> int:
    values = {k: fields[k] for k in _EDITABLE if k in fields}
    if not values:
        return 0
    if "slug" in values:
        raw = (values["slug"] or "").strip()
        if raw:
            base = _slugify(raw)
            values["slug"] = _make_slug(base, user_id, exclude_note_id=note_id)
        else:
            del values["slug"]  # Don't overwrite existing slug with empty
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
    with engine.begin() as conn:
        conn.execute(sa_delete(note_notebooks).where(note_notebooks.c.note_id == note_id))
        result = conn.execute(
            sa_delete(notes).where(notes.c.id == note_id, notes.c.user_id == user_id)
        )
    return result.rowcount


def publish_note(user_id: str, note_id: str):
    """Generate/reuse share token, ensure slug, mark published. Returns dict or None if not found."""
    stmt = select(notes.c.share_token, notes.c.title, notes.c.slug).where(
        notes.c.id == note_id, notes.c.user_id == user_id
    )
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    if row is None:
        return None
    token = row["share_token"] or str(uuid.uuid4())
    slug = row["slug"]
    if not slug:
        base = _slugify(row["title"] or "note")
        slug = _make_slug(base, user_id, exclude_note_id=note_id)
    with engine.begin() as conn:
        conn.execute(
            sa_update(notes)
            .where(notes.c.id == note_id, notes.c.user_id == user_id)
            .values(share_token=token, is_published=True, slug=slug)
        )
    return {"share_token": token, "slug": slug}


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


def get_note_by_slug(slug: str):
    """Fetch a published note by slug (no user auth check)."""
    stmt = select(notes).where(
        notes.c.slug == slug,
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

_SETTINGS_FIELDS = ("story_list_title", "template", "logo_on", "list_public", "show_notebook_filter", "scan_prompt")


def get_settings(user_id: str) -> dict:
    stmt = select(user_settings).where(user_settings.c.user_id == user_id)
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    if not row:
        return {"user_id": user_id, "story_list_title": None, "template": None,
                "logo_on": None, "list_public": None, "list_token": None,
                "show_notebook_filter": None}
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


def list_published_notes(user_id: str, for_notebook: bool = False) -> list:
    """All published notes for a user.

    for_notebook=False (default): excludes notes with includeInList=false (main feed).
    for_notebook=True: excludes notes with includeInNotebooks=false (notebook view).
    """
    stmt = select(
        notes.c.id,
        notes.c.title,
        notes.c.summary,
        notes.c.scanned_at,
        notes.c.created_at,
        notes.c.share_token,
        notes.c.files,
        notes.c.publish_options,
        notes.c.visibility,
    ).where(
        notes.c.user_id == user_id,
        notes.c.is_published == True,
    ).order_by(notes.c.scanned_at.desc())

    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()

    out = []
    for r in rows:
        opts = r["publish_options"] or {}
        if for_notebook:
            if opts.get("includeInNotebooks") is False:
                continue
        else:
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
            "visibility": r["visibility"] or "public",
            "notebook_ids": [],
        })

    # Attach notebook memberships in one query
    if out:
        note_ids = [n["id"] for n in out]
        nn_stmt = select(note_notebooks.c.note_id, note_notebooks.c.notebook_id).where(
            note_notebooks.c.note_id.in_(note_ids)
        )
        with engine.connect() as conn2:
            nn_rows = conn2.execute(nn_stmt).fetchall()
        note_nb_map: dict = {}
        for note_id, notebook_id in nn_rows:
            note_nb_map.setdefault(note_id, []).append(notebook_id)
        for n in out:
            n["notebook_ids"] = note_nb_map.get(n["id"], [])

    return out


def list_published_notebooks(user_id: str) -> list:
    """Notebooks that contain at least one published note for the given user."""
    stmt = (
        select(notebooks.c.id, notebooks.c.title, notebooks.c.slug)
        .select_from(
            notebooks
            .join(note_notebooks, notebooks.c.id == note_notebooks.c.notebook_id)
            .join(notes, note_notebooks.c.note_id == notes.c.id)
        )
        .where(notebooks.c.user_id == user_id, notes.c.is_published == True)
        .distinct()
        .order_by(notebooks.c.title)
    )
    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [{"id": r["id"], "title": r["title"], "slug": r["slug"]} for r in rows]


def get_notebook_by_slug(user_id: str, slug: str):
    """Look up a notebook by slug for a given user."""
    stmt = select(notebooks.c.id, notebooks.c.title, notebooks.c.slug).where(
        notebooks.c.user_id == user_id,
        notebooks.c.slug == slug,
    )
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    return dict(row) if row else None


def get_notebook_by_global_slug(slug: str):
    """Look up a notebook by slug globally (any user). Returns {id, title, slug, user_id, access_code_hash} or None."""
    stmt = select(
        notebooks.c.id, notebooks.c.title, notebooks.c.slug, notebooks.c.user_id, notebooks.c.access_code_hash
    ).where(notebooks.c.slug == slug).limit(1)
    with engine.connect() as conn:
        row = conn.execute(stmt).mappings().first()
    return dict(row) if row else None


# ── Notebooks ─────────────────────────────────────────────────────────────────

def get_note_notebook_ids(note_id: str) -> list:
    stmt = select(note_notebooks.c.notebook_id).where(note_notebooks.c.note_id == note_id)
    with engine.connect() as conn:
        return [r[0] for r in conn.execute(stmt).fetchall()]


_SYSTEM_NOTEBOOKS = [
    {"id": "system:public",           "title": "Public",           "visibility": "public",    "published": True},
    {"id": "system:login_restricted", "title": "Login restricted", "visibility": "logged_in", "published": True},
    {"id": "system:me",               "title": "Only me",          "visibility": "me",        "published": True},
    {"id": "system:unpublished",      "title": "Unpublished",      "visibility": None,        "published": False},
]


def list_notebooks(user_id: str) -> list:
    stmt = (
        select(
            notebooks.c.id,
            notebooks.c.title,
            notebooks.c.created_at,
            notebooks.c.slug,
            notebooks.c.access_code_hash,
            func.count(note_notebooks.c.note_id).label("note_count"),
        )
        .select_from(
            notebooks.outerjoin(note_notebooks, notebooks.c.id == note_notebooks.c.notebook_id)
        )
        .where(notebooks.c.user_id == user_id)
        .group_by(notebooks.c.id, notebooks.c.title, notebooks.c.created_at, notebooks.c.slug, notebooks.c.access_code_hash)
        .order_by(notebooks.c.created_at)
    )
    with engine.connect() as conn:
        rows = conn.execute(stmt).mappings().all()
        result = [{"id": r["id"], "title": r["title"], "note_count": r["note_count"], "slug": r["slug"], "has_access_code": bool(r["access_code_hash"]), "is_system": False} for r in rows]

        # Append virtual system notebooks with live counts
        base = notes.c.user_id == user_id
        for sys_nb in _SYSTEM_NOTEBOOKS:
            if sys_nb["published"]:
                count_stmt = select(func.count()).select_from(notes).where(
                    and_(base, notes.c.is_published == True, notes.c.visibility == sys_nb["visibility"])
                )
            else:
                count_stmt = select(func.count()).select_from(notes).where(
                    and_(base, or_(notes.c.is_published == None, notes.c.is_published == False))
                )
            count = conn.execute(count_stmt).scalar() or 0
            result.append({"id": sys_nb["id"], "title": sys_nb["title"], "note_count": count, "is_system": True})

    return result


def create_notebook(user_id: str, title: str) -> dict:
    nb_id = str(uuid.uuid4())
    now = _utcnow()
    with engine.begin() as conn:
        conn.execute(insert(notebooks).values(id=nb_id, user_id=user_id, title=title, created_at=now, slug=None))
    return {"id": nb_id, "title": title, "note_count": 0, "slug": None, "is_system": False}


def update_notebook(user_id: str, notebook_id: str, title: str, slug=None) -> bool:
    """slug=None → auto-derive from title. slug="" → clear slug to NULL. slug=str → use that slug."""
    values: dict = {"title": title}
    if slug == "":
        # Explicitly clearing the public URL
        values["slug"] = None
    elif slug is not None:
        # User-supplied slug — slugify and deduplicate
        values["slug"] = _make_notebook_slug(_slugify(slug) or "notebook", user_id, exclude_nb_id=notebook_id)
    else:
        # Auto-update slug from new title
        values["slug"] = _make_notebook_slug(_slugify(title) or "notebook", user_id, exclude_nb_id=notebook_id)
    stmt = (
        sa_update(notebooks)
        .where(notebooks.c.id == notebook_id, notebooks.c.user_id == user_id)
        .values(**values)
    )
    with engine.begin() as conn:
        result = conn.execute(stmt)
    return result.rowcount > 0


def delete_notebook(user_id: str, notebook_id: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            select(notebooks.c.id).where(notebooks.c.id == notebook_id, notebooks.c.user_id == user_id)
        ).first()
    if not row:
        return False
    with engine.begin() as conn:
        conn.execute(sa_delete(note_notebooks).where(note_notebooks.c.notebook_id == notebook_id))
        conn.execute(sa_delete(notebooks).where(notebooks.c.id == notebook_id))
    return True


def set_notebook_access_code(user_id: str, notebook_id: str, code_hash) -> bool:
    """Store or clear an access code hash for a notebook. Returns True if found."""
    stmt = (
        sa_update(notebooks)
        .where(notebooks.c.id == notebook_id, notebooks.c.user_id == user_id)
        .values(access_code_hash=code_hash)
    )
    with engine.begin() as conn:
        result = conn.execute(stmt)
    return result.rowcount > 0


def set_note_notebooks(user_id: str, note_id: str, notebook_ids: list) -> bool:
    # Strip out any system notebook IDs — they are virtual and cannot be assigned manually
    notebook_ids = [nb_id for nb_id in notebook_ids if not nb_id.startswith("system:")]
    with engine.connect() as conn:
        row = conn.execute(
            select(notes.c.id).where(notes.c.id == note_id, notes.c.user_id == user_id)
        ).first()
    if not row:
        return False
    with engine.begin() as conn:
        conn.execute(sa_delete(note_notebooks).where(note_notebooks.c.note_id == note_id))
        if notebook_ids:
            conn.execute(
                insert(note_notebooks).values(
                    [{"note_id": note_id, "notebook_id": nb_id} for nb_id in notebook_ids]
                )
            )
    return True


def get_adjacent_published_notes(user_id: str, note_id: str) -> dict:
    """Return prev/next share tokens for a note within the user's published list (ordered by created_at desc)."""
    items = list_published_notes(user_id)
    idx = next((i for i, n in enumerate(items) if n["id"] == note_id), None)
    if idx is None:
        return {"prev_token": None, "next_token": None}
    prev_token = items[idx - 1]["share_token"] if idx > 0 else None
    next_token = items[idx + 1]["share_token"] if idx + 1 < len(items) else None
    return {"prev_token": prev_token, "next_token": next_token}


# ── Global settings & scan rate-limiting ─────────────────────────────────────

def get_global_setting(key: str, default=None):
    try:
        with engine.connect() as conn:
            row = conn.execute(
                select(global_settings.c.value).where(global_settings.c.key == key)
            ).first()
            return row[0] if row else default
    except Exception:
        return default


def set_global_setting(key: str, value: str) -> None:
    with engine.begin() as conn:
        existing = conn.execute(
            select(global_settings.c.key).where(global_settings.c.key == key)
        ).first()
        if existing:
            conn.execute(
                sa_update(global_settings).where(global_settings.c.key == key).values(value=value)
            )
        else:
            conn.execute(insert(global_settings).values(key=key, value=value))


_GLOBAL_SCAN_KEY = "__global__"


def get_scan_counts(user_id: str, today: str) -> tuple:
    """Returns (user_count, global_count) for the given date string (YYYY-MM-DD)."""
    with engine.connect() as conn:
        user_row = conn.execute(
            select(scan_counts.c.count).where(
                and_(scan_counts.c.user_id == user_id, scan_counts.c.scan_date == today)
            )
        ).first()
        global_row = conn.execute(
            select(scan_counts.c.count).where(
                and_(scan_counts.c.user_id == _GLOBAL_SCAN_KEY, scan_counts.c.scan_date == today)
            )
        ).first()
        return (user_row[0] if user_row else 0, global_row[0] if global_row else 0)


def increment_scan_count(user_id: str, today: str) -> None:
    """Atomically increment per-user and global scan counts for today."""
    with engine.begin() as conn:
        for uid in (user_id, _GLOBAL_SCAN_KEY):
            existing = conn.execute(
                select(scan_counts.c.count).where(
                    and_(scan_counts.c.user_id == uid, scan_counts.c.scan_date == today)
                )
            ).first()
            if existing:
                conn.execute(
                    sa_update(scan_counts)
                    .where(and_(scan_counts.c.user_id == uid, scan_counts.c.scan_date == today))
                    .values(count=existing[0] + 1)
                )
            else:
                conn.execute(
                    insert(scan_counts).values(user_id=uid, scan_date=today, count=1)
                )
