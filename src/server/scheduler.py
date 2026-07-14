"""Background scheduler for recurring server maintenance tasks."""

from datetime import datetime
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..database import get_database
from ..database.models import EventRotationHistoryModel, RotationReasonEnum
from ..events.activity_progress import clear_activity_progress
from ..events.event_system import event_rotation_manager

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def save_rotation_history(history_id: str, event_type: str, old_event_id: str, new_event_id: str, reason: str) -> None:
    """Persist event rotation history."""
    db = get_database()
    session = db.get_session()
    try:
        rotation_reason = RotationReasonEnum.MANUAL if reason == "manual" else RotationReasonEnum.AUTO
        history = EventRotationHistoryModel(
            history_id=history_id,
            event_type=event_type,
            old_event_id=old_event_id,
            new_event_id=new_event_id,
            rotation_reason=rotation_reason,
            rotated_at=datetime.utcnow(),
        )
        session.add(history)
        session.commit()
        logger.info("event rotation saved: %s %s -> %s (%s)", event_type, old_event_id, new_event_id, reason)
    except Exception:
        session.rollback()
        logger.error("failed to save event rotation history", exc_info=True)
    finally:
        session.close()


def check_and_rotate_events() -> None:
    """Rotate timed events when their configured window has ended."""
    try:
        result = event_rotation_manager.check_and_rotate_events(reason="auto")
        if result.get("team_monthly"):
            logger.info("team monthly event rotated")
        if result.get("server_quarterly"):
            logger.info("server quarterly event rotated")
    except Exception:
        logger.error("event rotation check failed", exc_info=True)


def check_world_boss_seasons() -> None:
    """Create current world boss season and settle stale seasons."""
    try:
        from .routes import run_world_boss_season_maintenance

        result = run_world_boss_season_maintenance()
        if result.get("closed_seasons"):
            logger.info("world boss seasons settled: %s", ", ".join(result["closed_seasons"]))
    except Exception:
        logger.error("world boss season maintenance failed", exc_info=True)


def init_scheduler() -> BackgroundScheduler:
    """Initialize recurring maintenance jobs."""
    global _scheduler

    if _scheduler is not None:
        return _scheduler

    event_rotation_manager.set_history_callback(save_rotation_history)
    event_rotation_manager.set_progress_clear_callback(clear_activity_progress)
    event_rotation_manager.check_and_rotate_events(reason="auto")

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        check_and_rotate_events,
        trigger=IntervalTrigger(minutes=30),
        id="event_rotation_check",
        name="Event rotation check",
        replace_existing=True,
    )
    _scheduler.add_job(
        check_world_boss_seasons,
        trigger=IntervalTrigger(minutes=30),
        id="world_boss_season_check",
        name="World boss season maintenance",
        replace_existing=True,
    )
    check_world_boss_seasons()
    logger.info("background scheduler initialized")
    return _scheduler


def start_scheduler() -> None:
    """Start the background scheduler."""
    global _scheduler

    if _scheduler is None:
        _scheduler = init_scheduler()

    if not _scheduler.running:
        _scheduler.start()
        logger.info("background scheduler started")
    else:
        logger.warning("background scheduler is already running")


def stop_scheduler() -> None:
    """Stop the background scheduler."""
    global _scheduler

    if _scheduler and _scheduler.running:
        _scheduler.shutdown()
        logger.info("background scheduler stopped")


def get_scheduler() -> BackgroundScheduler:
    """Return the scheduler instance, creating it if needed."""
    if _scheduler is None:
        return init_scheduler()
    return _scheduler
