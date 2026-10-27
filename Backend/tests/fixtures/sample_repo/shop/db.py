"""In-memory storage."""

from shop.models import User

USERS: dict[int, User] = {}


def get_user_by_id(user_id: int) -> User | None:
    """Look up one user."""
    return USERS.get(user_id)


def save_user(user: User) -> None:
    USERS[user.id] = user
