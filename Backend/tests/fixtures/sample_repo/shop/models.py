from dataclasses import dataclass


@dataclass
class User:
    """A shop customer."""

    id: int
    name: str
    email: str

    def display_name(self) -> str:
        """Name shown in the UI."""
        return self.name.title()

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.display_name(), "email": self.email}
