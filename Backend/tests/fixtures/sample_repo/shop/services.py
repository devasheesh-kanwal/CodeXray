from shop import db
from shop.models import User
from .utils.helpers import parseHttpHeader


def register_user(user_id: int, name: str, email: str) -> User:
    """Create and store a user."""
    user = User(user_id, name, email)
    db.save_user(user)
    return user


def find_user(user_id: int) -> dict | None:
    user = db.get_user_by_id(user_id)
    if user is None:
        return None
    return user.to_dict()


def user_agent(raw_headers: str) -> str:
    return parseHttpHeader(raw_headers).get("user-agent", "")
