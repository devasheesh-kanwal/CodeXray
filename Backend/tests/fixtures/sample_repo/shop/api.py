import functools

from shop.services import find_user, register_user


def logged(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        print(f"calling {func.__name__}")
        return func(*args, **kwargs)

    return wrapper


@logged
def get_user(user_id: int) -> dict:
    user = find_user(user_id)
    if user is None:
        return {"error": "not found"}
    return user


@logged
def create_user(user_id: int, name: str, email: str) -> dict:
    return register_user(user_id, name, email).to_dict()


if __name__ == "__main__":
    print(get_user(1))
